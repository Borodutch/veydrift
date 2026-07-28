import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, keccak256 } from "viem";

const path = process.argv[2] ?? "manifests/vey-741-base-fork-dry-run.json";
const manifest = JSON.parse(readFileSync(path, "utf8"));
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message) => {
  throw new Error(`Invalid VEYDRIFT Uniswap launch manifest: ${message}`);
};
const eq = (actual, expected, field) => {
  if (actual !== expected) fail(`${field}: expected ${expected}, received ${actual}`);
};
const required = (field) => {
  const value = manifest[field];
  if (value === undefined || value === null || value === "") fail(`${field} is required`);
  return value;
};
const uint = (field) => {
  const value = required(field);
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) fail(`${field} must be a decimal string`);
  return BigInt(value);
};
const number = (field) => {
  const value = required(field);
  if (!Number.isSafeInteger(value)) fail(`${field} must be a safe integer`);
  return value;
};
const address = (field) => {
  const value = required(field);
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) fail(`${field} must be an address`);
  return value.toLowerCase();
};
const hash = (field) => {
  const value = required(field);
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) fail(`${field} must be bytes32`);
  return value.toLowerCase();
};
const observedOutflow = (prefix) => {
  const before = uint(`${prefix}BeforeWei`);
  const after = uint(`${prefix}AfterWei`);
  const outflow = uint(`${prefix}OutflowWei`);
  if (after > before) fail(`${prefix} increased instead of producing an outflow`);
  eq(before - after, outflow, `${prefix} observed outflow`);
  return outflow;
};
const observedInflow = (prefix) => {
  const before = uint(`${prefix}BeforeWei`);
  const after = uint(`${prefix}AfterWei`);
  const inflow = uint(`${prefix}InflowWei`);
  if (after < before) fail(`${prefix} decreased instead of receiving an inflow`);
  eq(after - before, inflow, `${prefix} observed inflow`);
  return inflow;
};
const sorted = (left, right) => left < right ? [left, right] : [right, left];
const poolId = (prefix) => keccak256(encodeAbiParameters(
  [
    { type: "address" },
    { type: "address" },
    { type: "uint24" },
    { type: "int24" },
    { type: "address" },
  ],
  [
    address(`${prefix}Currency0`),
    address(`${prefix}Currency1`),
    BigInt(number(`${prefix}Fee`)),
    BigInt(number(`${prefix}TickSpacing`)),
    address(`${prefix}Hook`),
  ],
));
const fullRange = (prefix) => {
  const tickSpacing = number(`${prefix}TickSpacing`);
  if (tickSpacing <= 0) fail(`${prefix}TickSpacing must be positive`);
  const expectedLower = Math.trunc(-887_272 / tickSpacing) * tickSpacing;
  const expectedUpper = Math.trunc(887_272 / tickSpacing) * tickSpacing;
  eq(number(`${prefix}TickLower`), expectedLower, `${prefix}TickLower`);
  eq(number(`${prefix}TickUpper`), expectedUpper, `${prefix}TickUpper`);
};
const zero = "0x0000000000000000000000000000000000000000";
const zeroHash = `0x${"0".repeat(64)}`;

eq(manifest.schema, "veydrift.uniswap-launch-manifest.v2", "schema");
eq(manifest.task, "VEY-KANEO-741", "task");
eq(manifest.environment, "base-mainnet-fork", "environment");
eq(manifest.broadcast, false, "broadcast");
eq(manifest.statusPassed, true, "statusPassed");
if (!/^[0-9a-f]{40}$/.test(required("sourceCommit"))) fail("sourceCommit must be a full lowercase commit SHA");
const sourceCommit = execFileSync(
  "git",
  ["log", "-1", "--format=%H", "--", ".", ":(exclude)manifests/vey-741-base-fork-dry-run.json"],
  { cwd: packageRoot, encoding: "utf8" },
).trim();
if (!/^[0-9a-f]{40}$/.test(sourceCommit)) fail("could not derive the current non-manifest source commit");
eq(manifest.sourceCommit, sourceCommit, "sourceCommit");
if (process.env.VEYDRIFT_SOURCE_COMMIT) eq(process.env.VEYDRIFT_SOURCE_COMMIT, sourceCommit, "VEYDRIFT_SOURCE_COMMIT");
eq(manifest.compilerVersion, "0.8.28", "compilerVersion");
eq(hash("compilerSettingsHash"), "0x3b1b21744b923b65a0a22a2373d2aecd494b9ff8824328b868465c4097885145", "compilerSettingsHash");
eq(number("chainId"), 8453, "chainId");
eq(manifest.chainName, "Base", "chainName");
eq(number("forkBlockNumber"), 48_937_745, "forkBlockNumber");
eq(hash("forkBlockHash"), "0x2c24db6fbd731f5bf6690544e6d77aabfefc8e9fbf76b166f3668b0bc0246051", "forkBlockHash");
eq(number("forkBlockTimestamp"), 1_784_664_837, "forkBlockTimestamp");

const deployments = {
  officialWeth: ["0x4200000000000000000000000000000000000006", "0x8a3a1f6a9f9dce633117adee5b458245835a8645a8c8726a26382a4622508b1c"],
  officialCcaFactory: ["0x000000001f26a0044baa66024e7b6599c61963f8", "0xa1d2a90564f4f63580b25de42efaff92505c254b00fc666f65ab38126cce5cfa"],
  officialLbpStrategy: ["0x34385dd739fe5464892bf0ba4cc42492804da000", "0x74723f633d30e7ea54ebb2ad6a605965010ced6185cde8ac9dce8504c55787a5"],
  officialPoolManager: ["0x498581ff718922c3f8e6a244956af099b2652b2b", "0x83b2af6e9f3158defc2811cbcb0db71ecf8b2ba2abea39c39e370ac5c6f43eb6"],
  officialPositionManager: ["0x7c5f5a4bbd8fd63184577525326123b519429bdc", "0x243f9e091ddf11c7c04e28059fdbbf1bab82b72d414fafb8e096c097aaeb622a"],
  officialStateView: ["0xa3c0c9b65bad0b08107aa264b0f3db444b867a71", "0xbbd5859677ef5491143133e8ed2b8faa0272f6fc2cbae94c53e79cc8c0538545"],
  officialPermit2: ["0x000000000022d473030f116ddee9f6b43ac78ba3", "0xa67739abc3ede9dbdc0491636c67d6a14ac07fab9030c3f509b1eb7b11dff8ed"],
};
for (const [prefix, [expectedAddress, expectedCodehash]] of Object.entries(deployments)) {
  eq(address(`${prefix}Address`), expectedAddress, `${prefix}Address`);
  eq(hash(`${prefix}Codehash`), expectedCodehash, `${prefix}Codehash`);
  eq(hash(`${prefix}ExpectedCodehash`), expectedCodehash, `${prefix}ExpectedCodehash`);
}

const token = address("tokenAddress");
eq(hash("tokenRuntimeCodehash"), "0xdf4fbbefacd0d5d02161449b51d2eff6596d6a352da37c2ab11d16937fec337c", "tokenRuntimeCodehash");
eq(uint("tokenTotalSupplyWei"), 1_000_000_000n * 10n ** 18n, "tokenTotalSupplyWei");
const lock = address("positionLockAddress");
address("positionLockBeneficiary");
address("launchAuthority");
address("mainLauncherAddress");
address("resourceLauncherAddress");
if (number("positionLockUnlockAt") <= number("forkBlockTimestamp")) fail("position lock must be active at the pinned fork block");

const allocationFields = ["allocationLaunchBootstrapWei", "allocationResourcePoolsWei", "allocationDevelopmentWei", "allocationContributorsWei", "allocationEcosystemWei"];
const allocationSum = allocationFields.reduce((sum, field) => sum + uint(field), 0n);
eq(allocationSum, uint("allocationTotalWei"), "complete 1B allocation");
eq(uint("allocationCcaWei") + uint("allocationV4MainWei"), uint("allocationLaunchBootstrapWei"), "250M/250M bootstrap split");
eq(uint("allocationCcaWei"), 250_000_000n * 10n ** 18n, "allocationCcaWei");
eq(uint("allocationV4MainWei"), 250_000_000n * 10n ** 18n, "allocationV4MainWei");
eq(uint("allocationResourcePoolsWei"), 150_000_000n * 10n ** 18n, "allocationResourcePoolsWei");

address("auctionAddress");
eq(address("auctionToken"), token, "auctionToken");
eq(address("auctionCurrency"), deployments.officialWeth[0], "auctionCurrency");
address("auctionTokensRecipient");
eq(address("auctionFundsRecipient"), deployments.officialLbpStrategy[0], "auctionFundsRecipient");
eq(uint("auctionSupplyWei"), uint("allocationCcaWei"), "auctionSupplyWei");
eq(number("auctionEndBlock") - number("auctionStartBlock"), 86_400, "auction duration");
eq(number("auctionDurationBlocks"), 86_400, "auctionDurationBlocks");
eq(number("auctionDurationHoursTarget"), 48, "auctionDurationHoursTarget");
if (number("auctionClaimBlock") < number("auctionEndBlock")) fail("claim block precedes auction end");
if (number("auctionMigrationBlock") <= number("auctionEndBlock")) fail("migration block must follow auction end");
eq(address("auctionValidationHook"), zero, "auctionValidationHook");
eq(uint("auctionSupplyWei"), 250_000_000n * 10n ** 18n, "auctionSupplyWei");
eq(uint("auctionRequiredWethWei"), 27n * 10n ** 18n, "auctionRequiredWethWei");
eq(uint("auctionTestBidWethWei"), 54n * 10n ** 18n, "auctionTestBidWethWei");
if (uint("auctionClearingPriceQ96") <= uint("auctionFloorPriceQ96")) fail("clearing price did not exceed floor");
eq(manifest.auctionGraduated, true, "auctionGraduated");
eq(manifest.migrationAttempted, true, "migrationAttempted");
eq(manifest.migrationSucceeded, true, "migrationSucceeded");
hash("launchConfigurationHash");
hash("migrationParametersHash");
const reconciliationEvidenceHash = hash("reconciliationEvidenceHash");
if (reconciliationEvidenceHash === zeroHash) fail("reconciliation evidence hash is zero");
eq(reconciliationEvidenceHash, hash("mainMigrationEvidenceHash"), "reconciliation evidence binding");

const [mainCurrency0, mainCurrency1] = sorted(token, deployments.officialWeth[0]);
eq(address("mainCurrency0"), mainCurrency0, "mainCurrency0");
eq(address("mainCurrency1"), mainCurrency1, "mainCurrency1");
eq(number("mainFee"), 3000, "mainFee");
eq(number("mainTickSpacing"), 60, "mainTickSpacing");
const mainHook = address("mainHook");
if (![zero, deployments.officialLbpStrategy[0]].includes(mainHook)) fail("mainHook is not an approved topology");
eq(hash("mainPoolId"), poolId("main"), "mainPoolId");
fullRange("main");
if (uint("mainSqrtPriceX96") === 0n) fail("main pool is uninitialized");
eq(address("mainPositionOwner"), lock, "mainPositionOwner");
if (uint("mainPositionTokenId") === 0n || uint("mainPositionLiquidity") === 0n) fail("main canonical position is empty");
const mainVeydriftOutflow = observedOutflow("mainVeydriftStrategy");
const mainWethOutflow = observedOutflow("mainWethAuction");
const mainVeydriftDestinationInflow = observedInflow("mainVeydriftPoolManager")
  + observedInflow("mainVeydriftPositionManager")
  + observedInflow("mainVeydriftRecoveryRecipient");
const mainWethDestinationInflow = observedInflow("mainWethPoolManager")
  + observedInflow("mainWethPositionManager")
  + observedInflow("mainWethRecoveryRecipient")
  + observedInflow("mainWethStrategy");
eq(mainVeydriftOutflow, uint("allocationV4MainWei"), "observed main VEYDRIFT outflow");
eq(mainWethOutflow, uint("auctionTestBidWethWei"), "observed main WETH outflow");
eq(mainVeydriftOutflow, mainVeydriftDestinationInflow, "main VEYDRIFT flow conservation");
eq(mainWethOutflow, mainWethDestinationInflow, "main WETH flow conservation");
if (uint("mainVeydriftPoolManagerInflowWei") === 0n || uint("mainWethPoolManagerInflowWei") === 0n) {
  fail("main pool received no observed VEYDRIFT/WETH");
}
eq(uint("mainVeydriftPositionManagerInflowWei"), 0n, "main PositionManager VEYDRIFT residual");
eq(uint("mainWethPositionManagerInflowWei"), 0n, "main PositionManager WETH residual");
eq(uint("mainVeydriftReservedWei"), mainVeydriftOutflow, "mainVeydriftReservedWei observed delta");
eq(uint("mainWethBidInputWei"), mainWethOutflow, "mainWethBidInputWei observed delta");
eq(uint("veydriftPositionManagerDonationBefore"), 7n * 10n ** 18n, "veydrift donation before");
eq(uint("veydriftPositionManagerDonationAfter"), uint("veydriftPositionManagerDonationBefore"), "veydrift donation isolation");

const resourceRaw = [333_333_000n, 222_222_000n, 133_333_000n];
const resourceDonations = [11n, 13n, 17n];
const canonicalPositionIds = [uint("mainPositionTokenId")];
for (let i = 0; i < 3; i += 1) {
  const prefix = `resource${i}`;
  const resourceToken = address(`${prefix}Token`);
  eq(resourceToken, address(`reserve${i}TokenProxy`), `${prefix} live reserve token`);
  hash(`${prefix}TokenCodehash`);
  eq(uint(`${prefix}TokenTotalSupplyRaw`), 10_000_000_000n * 10n ** 6n, `${prefix}TokenTotalSupplyRaw`);
  const [currency0, currency1] = sorted(token, resourceToken);
  eq(address(`${prefix}Currency0`), currency0, `${prefix}Currency0`);
  eq(address(`${prefix}Currency1`), currency1, `${prefix}Currency1`);
  eq(number(`${prefix}Fee`), 3000, `${prefix}Fee`);
  eq(number(`${prefix}TickSpacing`), 60, `${prefix}TickSpacing`);
  eq(address(`${prefix}Hook`), zero, `${prefix}Hook`);
  eq(hash(`${prefix}PoolId`), poolId(prefix), `${prefix}PoolId`);
  fullRange(prefix);
  if (uint(`${prefix}ConfiguredSqrtPriceX96`) === 0n || uint(`${prefix}SqrtPriceX96`) === 0n) fail(`${prefix} price is zero`);
  eq(address(`${prefix}PositionOwner`), lock, `${prefix}PositionOwner`);
  if (uint(`${prefix}PositionLiquidity`) === 0n) fail(`${prefix} liquidity is zero`);
  const amount0Max = uint(`${prefix}Amount0Max`);
  const amount1Max = uint(`${prefix}Amount1Max`);
  const expected0 = currency0 === token ? 50_000_000n * 10n ** 18n : resourceRaw[i];
  const expected1 = currency1 === token ? 50_000_000n * 10n ** 18n : resourceRaw[i];
  eq(amount0Max, expected0, `${prefix}Amount0Max`);
  eq(amount1Max, expected1, `${prefix}Amount1Max`);
  for (const side of [0, 1]) {
    const max = uint(`${prefix}Amount${side}Max`);
    const min = uint(`${prefix}Amount${side}Min`);
    const used = uint(`${prefix}Amount${side}Used`);
    const dust = uint(`${prefix}Amount${side}Dust`);
    if (min * 100n < max * 99n) fail(`${prefix} amount${side} minimum is below 99%`);
    if (used < min || used > max) fail(`${prefix} amount${side} used is outside approved bounds`);
    eq(used + dust, max, `${prefix} amount${side} use+dust`);
  }
  eq(uint(`${prefix}PositionManagerDonationBefore`), resourceDonations[i], `${prefix} donation before`);
  eq(uint(`${prefix}PositionManagerDonationAfter`), resourceDonations[i], `${prefix} donation isolation`);
  canonicalPositionIds.push(uint(`${prefix}PositionTokenId`));
}
if (new Set(canonicalPositionIds.map(String)).size !== 4) fail("canonical position IDs are not distinct");

for (let i = 0; i < 3; i += 1) {
  const prefix = `reserve${i}`;
  address(`${prefix}TokenProxy`);
  address(`${prefix}TokenImplementation`);
  hash(`${prefix}TokenImplementationCodehash`);
  const liability = uint(`${prefix}LiabilityRaw`);
  const before = uint(`${prefix}BalanceBeforeRaw`);
  const release = uint(`${prefix}ReleaseRaw`);
  const margin = uint(`${prefix}ApprovedMarginRaw`);
  const after = uint(`${prefix}BalanceAfterRaw`);
  eq(release, resourceRaw[i], `${prefix}ReleaseRaw`);
  eq(before - release, after, `${prefix} exact release delta`);
  if (after < liability + margin) fail(`${prefix} reserve backing is insufficient`);
}

eq(number("approvalTupleCount"), 14, "approvalTupleCount");
for (let i = 0; i < 14; i += 1) {
  address(`approval${i}Token`);
  address(`approval${i}Owner`);
  address(`approval${i}Spender`);
  eq(uint(`approval${i}Value`), 0n, `approval${i}Value`);
}
eq(uint("mainLauncherResidualTokenWei"), 0n, "mainLauncherResidualTokenWei");
eq(uint("resourceLauncherResidualTokenWei"), 0n, "resourceLauncherResidualTokenWei");
eq(number("positionLockCanonicalPositionCount"), 4, "positionLockCanonicalPositionCount");
eq(number("positionLockObservedPositionCount"), 7, "positionLockObservedPositionCount");
for (const field of ["aerodromeSeededByDryRun", "resourceWethSeededByDryRun", "resourceStableSeededByDryRun", "duplicateVenueSeededByDryRun"]) {
  eq(manifest[field], false, field);
}
if (!required("generationCommand").includes("VeydriftUniswapLaunchMainnetFork.t.sol")) fail("generationCommand does not identify the producing fork test");
eq(manifest.testResult, "1 passed; 0 failed", "testResult");

console.log(`VEYDRIFT Uniswap dry-run manifest is chain-derived and internally consistent: ${path}`);
