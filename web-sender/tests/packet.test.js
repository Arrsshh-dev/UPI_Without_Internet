import { describe, expect, it } from 'vitest';
import { SERVER_PUBLIC_KEY_B64 } from '../src/config.js';
import { base64ToBytes, createEncryptedPacket } from '../src/lib/packet.js';

describe('packet', () => {
  it('produces valid MeshPacket with >= 284-byte wire ciphertext', async () => {
    const result = await createEncryptedPacket({
      senderVpa: 'alice@demo',
      receiverVpa: 'bob@demo',
      amount: '500.00',
      pin: '1234',
      publicKeyB64: SERVER_PUBLIC_KEY_B64,
    });

    expect(result.packet.packetId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(result.packet.ttl).toBe(5);
    expect(typeof result.packet.createdAt).toBe('number');
    expect(result.packetJsonSha256).toHaveLength(64);
    expect(result.ciphertextSha256).toHaveLength(64);

    const wireBytes = base64ToBytes(result.packet.ciphertext);
    // 256B RSA-OAEP wrapped key + 12B IV + 16B GCM tag + plaintext
    expect(wireBytes.length).toBeGreaterThan(284);
  });
});
