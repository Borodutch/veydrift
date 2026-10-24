// BROWSER_TEST_SHARD=k/n keeps every n-th test (or scenario block), in declaration order, so CI
// can spread one slow browser file over parallel runners. Unset, everything runs.
const [index, count] = (process.env.BROWSER_TEST_SHARD || "1/1").split("/").map(Number);
if (!(index >= 1 && index <= count)) throw new Error(`BROWSER_TEST_SHARD must look like 2/3, got ${process.env.BROWSER_TEST_SHARD}`);
let next = 0;
export const inShard = () => next++ % count === index - 1;
