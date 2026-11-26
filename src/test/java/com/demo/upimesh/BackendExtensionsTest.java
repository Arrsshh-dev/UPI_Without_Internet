package com.demo.upimesh;

import com.demo.upimesh.crypto.HybridCryptoService;
import com.demo.upimesh.crypto.ServerKeyHolder;
import com.demo.upimesh.model.Account;
import com.demo.upimesh.model.AccountRepository;
import com.demo.upimesh.model.MeshPacket;
import com.demo.upimesh.model.PaymentInstruction;
import com.demo.upimesh.model.Transaction;
import com.demo.upimesh.model.TransactionRepository;
import com.demo.upimesh.service.BridgeIngestionService;
import com.demo.upimesh.service.DemoService;
import com.demo.upimesh.service.IdempotencyService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class BackendExtensionsTest {

    @Autowired private DemoService demoService;
    @Autowired private BridgeIngestionService bridge;
    @Autowired private IdempotencyService idempotency;
    @Autowired private AccountRepository accountRepo;
    @Autowired private TransactionRepository txRepo;
    @Autowired private HybridCryptoService crypto;
    @Autowired private ServerKeyHolder serverKey;

    @BeforeEach
    void setup() {
        idempotency.clear();
    }

    // B1: ServerKeyHolder persistence across instances
    @Test
    void keyPersistenceLoadsSameKeyAcrossInstances(@TempDir Path tempDir) throws Exception {
        ServerKeyHolder holder1 = new ServerKeyHolder(tempDir.toString());
        holder1.init();
        String pub1 = holder1.getPublicKeyBase64();

        ServerKeyHolder holder2 = new ServerKeyHolder(tempDir.toString());
        holder2.init();
        String pub2 = holder2.getPublicKeyBase64();

        assertEquals(pub1, pub2, "Two consecutive holder initializations against same dir must load identical public key");
    }

    // B2 & B4: Restart-safe duplicate via database lookup carrying original outcome
    @Test
    void duplicateFromDatabaseCarriesOriginalOutcomeAndTxId() throws Exception {
        MeshPacket packet = demoService.createPacket(
                "alice@demo", "bob@demo", new BigDecimal("50.00"), "1234", 5);

        BridgeIngestionService.IngestResult r1 = bridge.ingest(packet, "bridge-1", 1);
        assertEquals("SETTLED", r1.outcome());
        assertNotNull(r1.transactionId());

        // Simulate application restart by wiping in-memory idempotency cache
        idempotency.clear();

        // Resubmit: must be caught by DB lookup before in-memory claim
        BridgeIngestionService.IngestResult r2 = bridge.ingest(packet, "bridge-2", 2);
        assertEquals("DUPLICATE_DROPPED", r2.outcome());
        assertEquals(r1.transactionId(), r2.transactionId(), "Duplicate must return original transaction ID");
        assertEquals("SETTLED", r2.originalOutcome(), "Duplicate must return original outcome");
    }

    // B3: Rejected outcome on insufficient funds
    @Test
    void insufficientFundsReturnsRejectedWithReason() throws Exception {
        // dave@demo starts with 500, try to send 800 (under 1000 limit, but > dave's balance)
        // dave balance is 500. Let's make an instruction directly for 500.00 if balance is 500, or reduce dave first
        Account dave = accountRepo.findById("dave@demo").orElseThrow();
        dave.setBalance(new BigDecimal("100.00"));
        accountRepo.save(dave);

        // dave sends 300 (exceeds 100 balance, but under 500 max cap)
        MeshPacket packet = demoService.createPacket(
                "dave@demo", "bob@demo", new BigDecimal("300.00"), "1234", 5);

        BridgeIngestionService.IngestResult r = bridge.ingest(packet, "bridge-dave", 1);
        assertEquals("REJECTED", r.outcome());
        assertEquals("insufficient_funds", r.reason());
        assertNotNull(r.transactionId());

        Transaction tx = txRepo.findById(r.transactionId()).orElseThrow();
        assertEquals(Transaction.Status.REJECTED, tx.getStatus());
        assertEquals("insufficient_funds", tx.getReason());
    }

    // B5: Clean invalid reasons for unknown VPAs
    @Test
    void unknownSenderReturnsCleanInvalidReason() throws Exception {
        PaymentInstruction pi = new PaymentInstruction(
                "unknown@demo", "bob@demo", new BigDecimal("50.00"),
                demoService.sha256Hex("1234"), UUID.randomUUID().toString(), Instant.now().toEpochMilli());
        String ct = crypto.encrypt(pi, serverKey.getPublicKey());
        MeshPacket packet = new MeshPacket();
        packet.setPacketId(UUID.randomUUID().toString());
        packet.setCreatedAt(Instant.now().toEpochMilli());
        packet.setTtl(5);
        packet.setCiphertext(ct);

        BridgeIngestionService.IngestResult r = bridge.ingest(packet, "bridge-unknown", 1);
        assertEquals("INVALID", r.outcome());
        assertEquals("unknown_sender", r.reason());
    }

    // B6: Bad PIN returns INVALID / bad_pin and ledger remains unchanged
    @Test
    void badPinReturnsBadPinReasonAndNoBalanceChange() throws Exception {
        BigDecimal aliceBefore = accountRepo.findById("alice@demo").orElseThrow().getBalance();

        // Correct PIN is 1234, pass wrong PIN 9999
        MeshPacket packet = demoService.createPacket(
                "alice@demo", "bob@demo", new BigDecimal("50.00"), "9999", 5);

        BridgeIngestionService.IngestResult r = bridge.ingest(packet, "bridge-pin", 1);
        assertEquals("INVALID", r.outcome());
        assertEquals("bad_pin", r.reason());

        BigDecimal aliceAfter = accountRepo.findById("alice@demo").orElseThrow().getBalance();
        assertEquals(aliceBefore, aliceAfter, "Alice balance must not change on bad PIN");
    }

    // B7: Amount exceeding spending cap returns INVALID / amount_exceeds_limit
    @Test
    void amountExceedingCapReturnsAmountExceedsLimit() throws Exception {
        // max cap in test properties is 500.00; send 501.00
        MeshPacket packet = demoService.createPacket(
                "alice@demo", "bob@demo", new BigDecimal("501.00"), "1234", 5);

        BridgeIngestionService.IngestResult r = bridge.ingest(packet, "bridge-cap", 1);
        assertEquals("INVALID", r.outcome());
        assertEquals("amount_exceeds_limit", r.reason());
    }

    // B8: Gateway receipt headers are stored on Transaction
    @Test
    void gatewayHeadersStoredOnTransaction() throws Exception {
        long gatewayRx = Instant.now().toEpochMilli() - 15000;
        String sourceDev = "iphone-alice-ble";

        MeshPacket packet = demoService.createPacket(
                "carol@demo", "bob@demo", new BigDecimal("75.00"), "1234", 5);

        BridgeIngestionService.IngestResult r = bridge.ingest(
                packet, "pi-gateway-01", 2, gatewayRx, sourceDev);

        assertEquals("SETTLED", r.outcome());
        Transaction tx = txRepo.findById(r.transactionId()).orElseThrow();
        assertNotNull(tx.getGatewayReceivedAt());
        assertEquals(gatewayRx, tx.getGatewayReceivedAt().toEpochMilli());
        assertEquals(sourceDev, tx.getGatewaySourceDevice());
    }
}
