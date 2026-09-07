import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, toBytes } from "viem";

import { receiptActivatesImplementation } from "./veydrift-upgrade-receipt.mjs";

const proxy = "0x1111111111111111111111111111111111111111";
const implementation = "0x2222222222222222222222222222222222222222";
const upgradedTopic = keccak256(toBytes("Upgraded(address)"));
const implementationTopic = `0x${"0".repeat(24)}${implementation.slice(2)}`;

test("accepts only the proxy's Upgraded event for the expected implementation", () => {
  assert.equal(receiptActivatesImplementation({
    logs: [{ address: proxy, topics: [upgradedTopic, implementationTopic] }]
  }, proxy, implementation), true);
});

test("rejects an unrelated receipt, emitter, or implementation", () => {
  assert.equal(receiptActivatesImplementation({ logs: [] }, proxy, implementation), false);
  assert.equal(receiptActivatesImplementation({
    logs: [{ address: implementation, topics: [upgradedTopic, implementationTopic] }]
  }, proxy, implementation), false);
  assert.equal(receiptActivatesImplementation({
    logs: [{ address: proxy, topics: [upgradedTopic, `0x${"0".repeat(24)}${"3".repeat(40)}`] }]
  }, proxy, implementation), false);
});
