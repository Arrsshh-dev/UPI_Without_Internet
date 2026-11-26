/**
 * BLE frame chunker & reassembler matching PRD 6.2 and upi-ble-relay/relay/reassembly.py.
 *
 * Frame format (UTF-8): "<seq>/<total>|<payload>"
 */
import { CHUNK_PAYLOAD_SIZE } from '../config.js';

export function chunkString(text, chunkSize = CHUNK_PAYLOAD_SIZE) {
  if (!text || typeof text !== 'string') {
    throw new Error('Cannot chunk an empty string.');
  }
  if (chunkSize < 1) {
    throw new Error('Chunk size must be positive.');
  }

  const total = Math.ceil(text.length / chunkSize);
  const frames = [];
  for (let seq = 0; seq < total; seq++) {
    const start = seq * chunkSize;
    const payload = text.slice(start, start + chunkSize);
    frames.push(`${seq}/${total}|${payload}`);
  }
  return frames;
}

/**
 * Pure frame parser & reassembler (mirrors relay/reassembly.py rules for tests).
 */
export class FrameReassembler {
  constructor() {
    this.buf = null;
  }

  processFrame(frame) {
    const pipeIdx = frame.indexOf('|');
    if (pipeIdx < 0) return { status: 'ERR', message: 'ERR:bad_frame_format' };

    const header = frame.slice(0, pipeIdx);
    const payload = frame.slice(pipeIdx + 1);
    const slashIdx = header.indexOf('/');
    if (slashIdx < 0) return { status: 'ERR', message: 'ERR:bad_frame_format' };

    const seq = Number(header.slice(0, slashIdx));
    const total = Number(header.slice(slashIdx + 1));
    if (!Number.isInteger(seq) || !Number.isInteger(total) || total < 1 || seq < 0 || seq >= total) {
      return { status: 'ERR', message: 'ERR:bad_frame_format' };
    }

    if (seq === 0) {
      this.buf = { total, chunks: new Map() };
    }

    if (!this.buf) {
      return { status: 'ERR', message: 'ERR:no_active_transfer' };
    }

    if (total !== this.buf.total) {
      return { status: 'ERR', message: 'ERR:out_of_order' };
    }

    if (!this.buf.chunks.has(seq) && seq > this.buf.chunks.size) {
      return { status: 'ERR', message: 'ERR:out_of_order' };
    }

    if (this.buf.chunks.has(seq)) {
      if (this.buf.chunks.get(seq) !== payload) {
        return { status: 'ERR', message: 'ERR:chunk_mismatch' };
      }
    } else {
      this.buf.chunks.set(seq, payload);
    }

    if (this.buf.chunks.size < this.buf.total) {
      return { status: 'PARTIAL', message: `PARTIAL:${this.buf.chunks.size}/${this.buf.total}` };
    }

    let joined = '';
    for (let i = 0; i < this.buf.total; i++) {
      joined += this.buf.chunks.get(i);
    }
    this.buf = null;

    return { status: 'COMPLETE', text: joined };
  }
}
