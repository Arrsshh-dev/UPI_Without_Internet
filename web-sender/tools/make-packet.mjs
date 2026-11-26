#!/usr/bin/env node
/**
 * Cross-language compatibility proof:
 * Imports the exact src/lib/packet.js and src/config.js used by the browser app
 * and outputs a MeshPacket JSON string that POST /api/bridge/ingest settles.
 *
 * Usage:
 *   node tools/make-packet.mjs [senderVpa] [receiverVpa] [amount] [pin]
 */
import { SERVER_PUBLIC_KEY_B64 } from '../src/config.js';
import { createEncryptedPacket } from '../src/lib/packet.js';

const [, , senderVpa = 'alice@demo', receiverVpa = 'bob@demo', amount = '100.00', pin = '1234'] =
  process.argv;

const result = await createEncryptedPacket({
  senderVpa,
  receiverVpa,
  amount,
  pin,
  publicKeyB64: SERVER_PUBLIC_KEY_B64,
});

process.stdout.write(result.packetJson + '\n');
