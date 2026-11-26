import { describe, expect, it } from 'vitest';
import { FrameReassembler, chunkString } from '../src/lib/chunker.js';

describe('chunker', () => {
  it('round-trips a 780-character string', () => {
    const input = 'A'.repeat(140) + 'B'.repeat(280) + 'C'.repeat(360);
    expect(input.length).toBe(780);

    const frames = chunkString(input, 140);
    expect(frames.length).toBe(6);

    const reassembler = new FrameReassembler();
    let finalResult = null;
    for (const frame of frames) {
      finalResult = reassembler.processFrame(frame);
    }

    expect(finalResult.status).toBe('COMPLETE');
    expect(finalResult.text).toBe(input);
  });

  it('rejects out-of-order frames', () => {
    const input = 'X'.repeat(400);
    const frames = chunkString(input, 140);
    expect(frames.length).toBe(3);

    const reassembler = new FrameReassembler();
    const first = reassembler.processFrame(frames[0]);
    expect(first.status).toBe('PARTIAL');

    const skipped = reassembler.processFrame(frames[2]);
    expect(skipped.status).toBe('ERR');
    expect(skipped.message).toBe('ERR:out_of_order');
  });
});
