import { expect, test } from "bun:test";
import { uniform } from "../../../packages/battle-oracle/oracle";
import { deterministicBattleSampleWord } from "./battlePreview";
import { refereeRandom } from "./refereeRandom";

test("refereeRandom is the oracle's exact draw stream, bit for bit", () => {
  // Target counts, rapidfire factors, the 2^23 explosion bound and the arithmetic edges of each path.
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
