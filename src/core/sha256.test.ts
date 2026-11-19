import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { fingerprint, sha256Hex } from './sha256';

describe('sha256', () => {
  it('matches NIST vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });
  it('matches node crypto for many lengths and unicode', () => {
    for (let n = 0; n < 200; n += 7) {
      const s = 'xé中'.repeat(n);
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'));
    }
  });
  it('makes readable fingerprints', () => {
    expect(fingerprint('ba7816bf8f01cfea414140de5dae2223')).toBe('BA78-16BF-8F01-CFEA-4141');
  });
});
