package com.demo.upimesh.service;

import com.demo.upimesh.crypto.HybridCryptoService;
import com.demo.upimesh.model.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;

/**
 * Orchestrates the full server-side pipeline for one inbound packet from a
 * bridge node:
 *
 *   1. Hash the ciphertext.
 *   2. Persistent DB dedupe check (findByPacketHash).
 *   3. In-memory idempotency claim.
 *   4. Decrypt with RSA-OAEP + AES-GCM.
 *   5. Check freshness (replay protection).
 *   6. Check spending limit (B7 upi.mesh.max-amount).
 *   7. Check sender existence and PIN hash (B6).
 *   8. Settle and map outcome correctly (SETTLED, REJECTED, DUPLICATE_DROPPED, INVALID).
 */
@Service
public class BridgeIngestionService {

    private static final Logger log = LoggerFactory.getLogger(BridgeIngestionService.class);

    @Autowired private HybridCryptoService crypto;
    @Autowired private IdempotencyService idempotency;
    @Autowired private SettlementService settlement;
    @Autowired private TransactionRepository txRepo;
    @Autowired private AccountRepository accountRepo;

    @Value("${upi.mesh.packet-max-age-seconds:86400}")
    private long maxAgeSeconds;

    @Value("${upi.mesh.max-amount:500.00}")
    private BigDecimal maxAmount;

    public IngestResult ingest(MeshPacket packet, String bridgeNodeId, int hopCount) {
        return ingest(packet, bridgeNodeId, hopCount, null, null);
    }

    public IngestResult ingest(MeshPacket packet, String bridgeNodeId, int hopCount,
                               Long gatewayReceivedAt, String gatewaySourceDevice) {
        try {
            String packetHash = crypto.hashCiphertext(packet.getCiphertext());

            // ---- 1. Database dedupe check (restart-safe B2 & B4) ----
            Optional<Transaction> existingTx = txRepo.findByPacketHash(packetHash);
            if (existingTx.isPresent()) {
                Transaction tx = existingTx.get();
                log.info("DUPLICATE packet {} found in DB — dropped", packetHash.substring(0, 12) + "...");
                return IngestResult.duplicate(packetHash, tx.getId(), tx.getStatus().name());
            }

            // ---- 2. In-memory idempotency gate ----
            if (!idempotency.claim(packetHash)) {
                log.info("DUPLICATE packet {} from bridge {} — dropped",
                        packetHash.substring(0, 12) + "...", bridgeNodeId);
                Optional<Transaction> tx = txRepo.findByPacketHash(packetHash);
                if (tx.isPresent()) {
                    return IngestResult.duplicate(packetHash, tx.get().getId(), tx.get().getStatus().name());
                }
                return IngestResult.duplicate(packetHash);
            }

            // ---- 3. Decrypt ----
            PaymentInstruction instruction;
            try {
                instruction = crypto.decrypt(packet.getCiphertext());
            } catch (Exception e) {
                log.warn("Decryption failed for packet {}: {}",
                        packetHash.substring(0, 12) + "...", e.getMessage());
                return IngestResult.invalid(packetHash, "decryption_failed");
            }

            // ---- 4. Freshness check (replay protection) ----
            long ageSeconds = (Instant.now().toEpochMilli() - instruction.getSignedAt()) / 1000;
            if (ageSeconds > maxAgeSeconds) {
                log.warn("Packet {} too old ({}s), rejected",
                        packetHash.substring(0, 12) + "...", ageSeconds);
                return IngestResult.invalid(packetHash, "stale_packet");
            }
            if (ageSeconds < -300) { // clock skew tolerance
                return IngestResult.invalid(packetHash, "future_dated");
            }

            // ---- 5. Offline spending cap (B7) ----
            if (instruction.getAmount() == null || instruction.getAmount().signum() <= 0) {
                return IngestResult.invalid(packetHash, "invalid_amount");
            }
            if (instruction.getAmount().compareTo(maxAmount) > 0) {
                log.warn("Amount ₹{} exceeds offline spending limit ₹{}", instruction.getAmount(), maxAmount);
                return IngestResult.invalid(packetHash, "amount_exceeds_limit");
            }

            // ---- 6. Account lookup and PIN proof check (B5 & B6) ----
            Optional<Account> senderOpt = accountRepo.findById(instruction.getSenderVpa());
            if (senderOpt.isEmpty()) {
                return IngestResult.invalid(packetHash, "unknown_sender");
            }
            Account sender = senderOpt.get();
            if (sender.getPinHash() != null && !sender.getPinHash().equalsIgnoreCase(instruction.getPinHash())) {
                log.warn("Bad PIN hash for sender {}", sender.getVpa());
                return IngestResult.invalid(packetHash, "bad_pin");
            }

            if (!accountRepo.existsById(instruction.getReceiverVpa())) {
                return IngestResult.invalid(packetHash, "unknown_receiver");
            }

            // ---- 7. Settle ----
            Transaction tx;
            try {
                tx = settlement.settle(instruction, packetHash, bridgeNodeId, hopCount,
                        gatewayReceivedAt, gatewaySourceDevice);
            } catch (DataIntegrityViolationException dive) {
                log.warn("Data integrity violation on save (concurrent duplicate): {}", dive.getMessage());
                Optional<Transaction> saved = txRepo.findByPacketHash(packetHash);
                if (saved.isPresent()) {
                    return IngestResult.duplicate(packetHash, saved.get().getId(), saved.get().getStatus().name());
                }
                return IngestResult.duplicate(packetHash);
            } catch (IllegalArgumentException iae) {
                String msg = iae.getMessage();
                if (msg != null && msg.startsWith("unknown_sender")) return IngestResult.invalid(packetHash, "unknown_sender");
                if (msg != null && msg.startsWith("unknown_receiver")) return IngestResult.invalid(packetHash, "unknown_receiver");
                if (msg != null && msg.startsWith("invalid_amount")) return IngestResult.invalid(packetHash, "invalid_amount");
                return IngestResult.invalid(packetHash, "internal_error: " + msg);
            }

            if (tx.getStatus() == Transaction.Status.REJECTED) {
                return IngestResult.rejected(packetHash, tx.getReason() == null ? "insufficient_funds" : tx.getReason(), tx.getId());
            }

            return IngestResult.settled(packetHash, tx);

        } catch (Exception e) {
            log.error("Ingestion error: {}", e.getMessage(), e);
            return IngestResult.invalid("?", "internal_error: " + e.getMessage());
        }
    }

    public record IngestResult(String outcome, String packetHash, String reason, Long transactionId, String originalOutcome) {
        // 4-argument delegating constructor for backward compatibility
        public IngestResult(String outcome, String packetHash, String reason, Long transactionId) {
            this(outcome, packetHash, reason, transactionId, null);
        }

        public static IngestResult settled(String hash, Transaction tx) {
            return new IngestResult("SETTLED", hash, null, tx.getId(), null);
        }

        public static IngestResult rejected(String hash, String reason, Long transactionId) {
            return new IngestResult("REJECTED", hash, reason, transactionId, null);
        }

        public static IngestResult duplicate(String hash) {
            return new IngestResult("DUPLICATE_DROPPED", hash, null, null, null);
        }

        public static IngestResult duplicate(String hash, Long transactionId, String originalOutcome) {
            return new IngestResult("DUPLICATE_DROPPED", hash, null, transactionId, originalOutcome);
        }

        public static IngestResult invalid(String hash, String reason) {
            return new IngestResult("INVALID", hash, reason, null, null);
        }
    }
}
