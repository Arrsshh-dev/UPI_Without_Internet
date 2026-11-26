# UPI Without Internet — Test Fixtures

This directory holds reproducible `MeshPacket` JSON fixtures for testing all tracks (`upi-ble-relay`, `web-sender`, backend ingest):

- `packet-alice-bob-500.json`: Valid payment packet from `alice@demo` to `bob@demo` for ₹500.00.
- `packet-tampered.json`: Exact copy of `packet-alice-bob-500.json` with a single ciphertext character altered to verify decryption failure.

## Note on Server RSA Key & Lifetime

1. **Server Key Binding:**
   The `ciphertext` in `packet-alice-bob-500.json` is encrypted using the server's persisted RSA public key (`./keys/server-public.x509`).
   If the server key is wiped or regenerated, pre-generated fixtures will fail decryption (`INVALID / decryption_failed`).

2. **Packet Expiry (Freshness Window):**
   The backend enforces `upi.mesh.packet-max-age-seconds` (default 86400, 24 hours).
   For demo days or multi-day testing, configure:
   ```properties
   upi.mesh.packet-max-age-seconds=604800
   ```
   so fixtures do not expire overnight.

## Generating Fresh Fixtures

When the backend is running (`java -jar` or `mvn spring-boot:run`):
```bash
curl -X POST http://localhost:8080/api/demo/packet \
  -H "Content-Type: application/json" \
  -d '{"senderVpa":"alice@demo","receiverVpa":"bob@demo","amount":500.00,"pin":"1234"}' \
  -o fixtures/packet-alice-bob-500.json
```

## Expected Ingestion Outcomes

```bash
# First ingestion -> SETTLED
curl -X POST http://localhost:8080/api/bridge/ingest \
  -H "Content-Type: application/json" \
  -d @fixtures/packet-alice-bob-500.json

# Resubmission -> DUPLICATE_DROPPED
curl -X POST http://localhost:8080/api/bridge/ingest \
  -H "Content-Type: application/json" \
  -d @fixtures/packet-alice-bob-500.json

# Tampered ciphertext -> INVALID (reason: decryption_failed)
curl -X POST http://localhost:8080/api/bridge/ingest \
  -H "Content-Type: application/json" \
  -d @fixtures/packet-tampered.json
```
