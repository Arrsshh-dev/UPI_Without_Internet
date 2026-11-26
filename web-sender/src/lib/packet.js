/**
 * Framework-free hybrid encryption for Offline Pay.
 * Works in both modern browsers (window.crypto) and Node 18+ (globalThis.crypto).
 *
 * Wire format (must match HybridCryptoService.java):
 *   Base64([256B RSA-OAEP(SHA-256) wrapped AES-256 key][12B GCM IV][ciphertext + 16B tag])
 */

function getSubtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('WebCrypto API (crypto.subtle) is not available in this context.');
  }
  return c;
}

export function base64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export async function sha256Hex(text) {
  const c = getSubtle();
  const data = new TextEncoder().encode(text);
  const digest = await c.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

export async function importServerPublicKey(spkiB64) {
  const c = getSubtle();
  const der = base64ToBytes(spkiB64.trim());
  return c.subtle.importKey(
    'spki',
    der.buffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );
}

/**
 * Create an encrypted MeshPacket matching DemoService.createPacket + HybridCryptoService.encrypt.
 */
export async function createEncryptedPacket({
  senderVpa,
  receiverVpa,
  amount,
  pin,
  publicKeyB64,
  ttl = 5,
}) {
  const c = getSubtle();
  const numericAmount = typeof amount === 'number' ? amount : Number.parseFloat(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('Amount must be a positive number.');
  }

  const now = Date.now();
  const pinHash = await sha256Hex(String(pin));
  const instruction = {
    senderVpa,
    receiverVpa,
    amount: Number(numericAmount.toFixed(2)),
    pinHash,
    nonce: c.randomUUID(),
    signedAt: now,
  };

  // 1. Generate ephemeral AES-256 key
  const aesKey = await c.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt']
  );

  // 2. Encrypt JSON instruction with AES-256-GCM (12-byte IV, 128-bit tag)
  const iv = c.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(instruction));
  const aesOutput = new Uint8Array(
    await c.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aesKey, plaintext)
  );

  // 3. Wrap raw 32-byte AES key with RSA-OAEP (SHA-256) -> 256 bytes for RSA-2048
  const rawAesKey = await c.subtle.exportKey('raw', aesKey);
  const rsaKey = await importServerPublicKey(publicKeyB64);
  const wrappedKey = new Uint8Array(
    await c.subtle.encrypt({ name: 'RSA-OAEP' }, rsaKey, rawAesKey)
  );

  // 4. Concatenate [256B wrappedKey][12B IV][ciphertext + 16B tag]
  const combined = new Uint8Array(wrappedKey.length + iv.length + aesOutput.length);
  combined.set(wrappedKey, 0);
  combined.set(iv, wrappedKey.length);
  combined.set(aesOutput, wrappedKey.length + iv.length);

  const packet = {
    packetId: c.randomUUID(),
    ttl,
    createdAt: now,
    ciphertext: bytesToBase64(combined),
  };

  const packetJson = JSON.stringify(packet);
  const [packetJsonSha256, ciphertextSha256] = await Promise.all([
    sha256Hex(packetJson),
    sha256Hex(packet.ciphertext),
  ]);

  return {
    packet,
    packetJson,
    packetJsonSha256,
    ciphertextSha256,
    byteLength: new TextEncoder().encode(packetJson).length,
  };
}
