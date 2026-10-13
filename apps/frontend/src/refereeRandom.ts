import { hexToBytes, stringToBytes, type Hex } from "viem";
import { RULES } from "../../../packages/battle-oracle/oracle";

/**
 * The referee's exact draw stream (packages/battle-oracle `uniform`): SHA-256(domain || seed32 ||
 * counter32 BE) mod bound, rejection sampled, the counter starting at 0 and advancing once per hash.
 * Bit for bit the same draws, several times faster: the 97-byte message is two SHA-256 blocks and the
 * first (domain and 31 seed bytes) never changes, so its midstate is computed once per seed and each
 * draw compresses only the second block, without allocating.
 */
export function refereeRandom(seed: Hex, counter = 0): (bound: number) => number {
  const message = new Uint8Array(DOMAIN.length + 32);
  message.set(DOMAIN);
  message.set(hexToBytes(seed, { size: 32 }), DOMAIN.length);
  const midstate = Int32Array.from(INITIAL);
  const view = new DataView(message.buffer);
  for (let i = 0; i < 16; i++) BLOCK[i] = view.getInt32(i * 4);
  compress(midstate, BLOCK, midstate);
  const lastSeedByte = message[64]!;
  const digest = new Int32Array(8);
  return (bound) => {
    if (!Number.isSafeInteger(bound) || bound < 1 || bound > SMALL_BOUND) throw new Error("invalid draw bound");
    const tail = tailOf(bound);
    for (;;) {
      if (counter >= Number.MAX_SAFE_INTEGER) throw new Error("random stream exhausted; battle incomplete");
      const low = counter % 2 ** 32, high = (counter - low) / 2 ** 32;
      counter++;
      // Second block: seed byte 31, the 32-byte big-endian counter (only its low 8 bytes are ever
      // nonzero here), the 0x80 terminator and the 776-bit message length.
      BLOCK.fill(0);
      BLOCK[0] = lastSeedByte << 24;
      BLOCK[6] = high >>> 8;
      BLOCK[7] = ((high & 0xff) << 24) | (low >>> 8);
      BLOCK[8] = ((low & 0xff) << 24) | 0x80_0000;
      BLOCK[15] = MESSAGE_BITS;
      compress(midstate, BLOCK, digest);
      const value = digestDraw(digest, bound, tail);
      if (value >= 0) return value;
    }
  };
}

/** One digest (eight big-endian words) as a draw in [0, bound), or -1 when rejection sampling
 * discards it (word >= 2^256 - tail, tail = 2^256 mod bound). */
export function digestDraw(digest: Int32Array, bound: number, tail = tailOf(bound)): number {
  // A word >= 2^256 - tail (tail < 2^37) needs its top 26 bytes all 0xff.
  if (tail !== 0n && digest[0] === -1 && digest[1] === -1 && digest[2] === -1 && digest[3] === -1
    && digest[4] === -1 && digest[5] === -1 && digest[6]! >>> 16 === 0xffff && digestWord(digest) >= U256 - tail) return -1;
  if (bound <= 2 ** 30 && (bound & (bound - 1)) === 0) return (digest[7]! >>> 0) % bound;
  let remainder = 0;
  if (bound <= 2 ** 21) {
    for (let i = 0; i < 8; i++) remainder = (remainder * 2 ** 32 + (digest[i]! >>> 0)) % bound;
  } else {
    for (let i = 0; i < 8; i++) {
      const word = digest[i]! >>> 0;
      remainder = (remainder * 65_536 + (word >>> 16)) % bound;
      remainder = (remainder * 65_536 + (word & 0xffff)) % bound;
    }
  }
  return remainder;
}

const U256 = 1n << 256n;
const DOMAIN = stringToBytes(RULES + ":random:");
// The fast path assumes two blocks with a fixed first one; a rules rename that changes this must
// revisit the block layout.
if (DOMAIN.length !== 33) throw new Error("referee draw domain changed");
const MESSAGE_BITS = (DOMAIN.length + 64) * 8;
// Narrower than the oracle's 2^45 small-bound range so remainders times 2^16 stay exact in double
// precision; the engine never draws above its target pool (at most REFEREE_FORECAST_MAX_UNITS, 1M).
const SMALL_BOUND = 2 ** 37;
const BLOCK = new Int32Array(16);
let tails = new Map<number, bigint>();
function tailOf(bound: number): bigint {
  let tail = tails.get(bound);
  if (tail === undefined) {
    if (tails.size > 4096) tails = new Map();
    tail = U256 % BigInt(bound);
    tails.set(bound, tail);
  }
  return tail;
}
function digestWord(digest: Int32Array): bigint {
  let word = 0n;
  for (let i = 0; i < 8; i++) word = (word << 32n) | BigInt(digest[i]! >>> 0);
  return word;
}

const INITIAL = new Int32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);
const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const W = new Int32Array(64);

/** One SHA-256 compression of `block` (16 big-endian words) onto `state`, written to `out`. */
function compress(state: Int32Array, block: Int32Array, out: Int32Array): void {
  for (let i = 0; i < 16; i++) W[i] = block[i]!;
  for (let i = 16; i < 64; i++) {
    const w15 = W[i - 15]!, w2 = W[i - 2]!;
    const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
    const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
    W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) | 0;
  }
  let a = state[0]!, b = state[1]!, c = state[2]!, d = state[3]!;
  let e = state[4]!, f = state[5]!, g = state[6]!, h = state[7]!;
  for (let i = 0; i < 64; i++) {
    const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + s1 + ((e & f) ^ (~e & g)) + K[i]! + W[i]!) | 0;
    const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0;
    d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  out[0] = (state[0]! + a) | 0; out[1] = (state[1]! + b) | 0; out[2] = (state[2]! + c) | 0; out[3] = (state[3]! + d) | 0;
  out[4] = (state[4]! + e) | 0; out[5] = (state[5]! + f) | 0; out[6] = (state[6]! + g) | 0; out[7] = (state[7]! + h) | 0;
}
