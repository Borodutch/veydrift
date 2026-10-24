import { expect, test } from "bun:test";
import { uniform } from "../../../packages/battle-oracle/oracle";
import { deterministicBattleSampleWord } from "./battlePreview";
import { digestDraw, refereeRandom } from "./refereeRandom";

test("refereeRandom is the oracle's exact draw stream, bit for bit", () => {
  // Target counts, rapidfire factors, the 2^23 explosion bound and the remainder paths' arithmetic edges
  // (rejection needs a constructed digest: see below).
  const bounds = [1, 2, 3, 7, 10, 100, 201, 2_005, 999_983, 2 ** 21 - 1, 2 ** 21, 2 ** 21 + 1, 2 ** 23, 2 ** 30, 2 ** 31, 2 ** 33 + 5, 2 ** 37];
  for (let s = 0; s < 6; s++) {
    const seed = deterministicBattleSampleWord(s);
    // Counters cross the 2^32 boundary, where the counter's high word starts to change.
    for (const start of [0, 2 ** 32 - 3, 2 ** 40 + 3]) {
      const state = { seed, counter: BigInt(start) };
      const draw = refereeRandom(seed, start);
      for (let i = 0; i < 400; i++) {
        const bound = bounds[(i * 7 + s) % bounds.length]!;
        expect(draw(bound)).toBe(Number(uniform(state, bound)));
      }
    }
  }
  expect(() => refereeRandom(deterministicBattleSampleWord(0))(0)).toThrow("invalid draw bound");
});

test("rejection sampling discards exactly the words at or above 2^256 - (2^256 mod bound)", () => {
  // Random seeds never reach a digest this close to 2^256, so construct the edge words directly.
  const U256 = 1n << 256n;
  const digestOf = (word: bigint) => Int32Array.from({ length: 8 }, (_, i) => Number((word >> BigInt(224 - 32 * i)) & 0xffff_ffffn) | 0);
  for (const bound of [3, 7, 1_000, 999_983, 2 ** 21 + 1, 2 ** 33 + 5]) {
    const tail = U256 % BigInt(bound);
    for (const word of [U256 - tail - 2n, U256 - tail - 1n, U256 - tail, U256 - 1n, U256 - (1n << 211n)]) {
      expect(digestDraw(digestOf(word), bound)).toBe(word >= U256 - tail ? -1 : Number(word % BigInt(bound)));
    }
  }
  // Power-of-two bounds divide 2^256: nothing is ever rejected.
  expect(digestDraw(digestOf(U256 - 1n), 2 ** 23)).toBe(2 ** 23 - 1);
});
