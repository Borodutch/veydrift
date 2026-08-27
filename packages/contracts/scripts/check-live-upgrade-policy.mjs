import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const upgradeGameSource = await readFile(new URL("../script/UpgradeGame.s.sol", import.meta.url), "utf8");
const upgradeMoonSource = await readFile(new URL("../script/UpgradeMoonSystem.s.sol", import.meta.url), "utf8");

function stripComments(source) {
  let result = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "code" && current === "/" && next === "/") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (state === "code" && current === "/" && next === "*") {
      state = "block-comment";
      index += 1;
      continue;
    }
    if (state === "line-comment") {
      if (current === "\n") {
        result += current;
        state = "code";
      }
      continue;
    }
    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (state === "code" && (current === '"' || current === "'")) {
      state = current === '"' ? "double-string" : "single-string";
      result += current;
      continue;
    }
    if (state === "double-string" || state === "single-string") {
      result += current;
      if (current === "\\") {
        index += 1;
        result += source[index] ?? "";
      } else if (
        (state === "double-string" && current === '"')
        || (state === "single-string" && current === "'")
      ) {
        state = "code";
      }
      continue;
    }
    result += current;
  }
  return result;
}

const upgradeGameCode = stripComments(upgradeGameSource);
const upgradeMoonCode = stripComments(upgradeMoonSource);
const sources = [upgradeGameCode, upgradeMoonCode];

for (const forbidden of [
  /AUTO_PAUSE_GAME/,
  /ALLOW_UNPAUSED_MOON_UPGRADE/,
  /GAME_MUST_BE_PAUSED/,
  /GAME_PAUSE_FAILED/,
  /\bsetGamePaused\b/,
  /\bgamePaused\b/,
  /\b(?:pause|unpause)\b/i,
]) {
  for (const source of sources) {
    assert.equal(
      forbidden.test(source),
      false,
      `Upgrade scripts must not halt gameplay: matched ${forbidden}`,
    );
  }
}

function assertSingleCall(source, callPattern, label) {
  assert.equal(source.match(callPattern)?.length, 1, `${label} must have exactly one upgrade call`);
}

function assertBefore(source, first, second, label) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `${label}: missing ${first}`);
  assert.notEqual(secondIndex, -1, `${label}: missing ${second}`);
  assert.ok(firstIndex < secondIndex, `${label}: ${first} must run before ${second}`);
}

assertBefore(
  upgradeGameCode,
  "VeydriftLiveUpgradePolicy.requireGameUpgradeReady(proxy)",
  "vm.startBroadcast(privateKey)",
  "Game upgrade",
);
assertBefore(
  upgradeMoonCode,
  "VeydriftLiveUpgradePolicy.requireMoonUpgradeReady(address(game))",
  "vm.startBroadcast(privateKey)",
  "Moon upgrade",
);
assertSingleCall(
  upgradeGameCode,
  /ProxyAdmin\(proxyAdmin\)\s*\.upgradeAndCall\s*\(/g,
  "Game upgrade",
);
assertSingleCall(
  upgradeMoonCode,
  /proxied\.upgradeToAndCall\s*\(/g,
  "Moon upgrade",
);
assert.match(
  upgradeGameCode,
  /upgradeAndCall\s*\(\s*ITransparentUpgradeableProxy\(proxy\),\s*newImplementation,\s*bytes\(""\)\s*\)/s,
);
assert.match(upgradeMoonCode, /upgradeToAndCall\s*\(\s*newImplementation,\s*""\s*\)/s);
assert.doesNotMatch(upgradeGameCode, /initializeMoonAttackParity|migratePlanetTemperatures/);

console.log("Live upgrade policy check passed.");
