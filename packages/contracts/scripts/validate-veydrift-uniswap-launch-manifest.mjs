import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "manifests/vey-741-base-fork-dry-run.json";
const manifest = JSON.parse(readFileSync(path, "utf8"));
const fail = (message) => {
  throw new Error(`Invalid VEYDRIFT Uniswap launch manifest: ${message}`);
};
const eq = (actual, expected, field) => {
  if (actual !== expected) fail(`${field}: expected ${expected}, received ${actual}`);
};
const sum = (...values) => values.reduce((total, value) => total + BigInt(value), 0n);
const zero = "0x0000000000000000000000000000000000000000";

eq(manifest.schema, "veydrift.uniswap-launch-manifest.v1", "schema");
eq(manifest.task, "VEY-KANEO-741", "task");
eq(manifest.environment, "base-mainnet-fork", "environment");
eq(manifest.broadcast, false, "broadcast");
eq(manifest.status, "passed", "status");
eq(manifest.chain.chainId, 8453, "chain.chainId");

const allocation = manifest.allocationWei;
eq(
  sum(allocation.launchBootstrap, allocation.resourcePools, allocation.development, allocation.contributors, allocation.ecosystem),
  BigInt(allocation.total),
  "complete 1B allocation"
);
eq(sum(allocation.cca, allocation.v4Main), BigInt(allocation.launchBootstrap), "250M/250M bootstrap split");
eq(allocation.cca, "250000000000000000000000000", "allocationWei.cca");
eq(allocation.v4Main, "250000000000000000000000000", "allocationWei.v4Main");

eq(manifest.auction.currency.toLowerCase(), manifest.officialDeployments.weth.address.toLowerCase(), "auction.currency");
eq(manifest.auction.durationBlocks, 1800, "auction.durationBlocks");
eq(manifest.auction.durationMinutes, 60, "auction.durationMinutes");
eq(manifest.auction.validationHook, zero, "auction.validationHook");
eq(manifest.auction.finalized, true, "auction.finalized");
eq(manifest.auction.graduated, true, "auction.graduated");

const expectedResources = ["333333000", "222222000", "133333000"];
eq(manifest.resourcePools.length, 3, "resourcePools.length");
manifest.resourcePools.forEach((pool, index) => {
  eq(pool.resourceRaw, expectedResources[index], `resourcePools[${index}].resourceRaw`);
  eq(pool.veydriftWei, "50000000000000000000000000", `resourcePools[${index}].veydriftWei`);
  eq(pool.venue, "Uniswap v4", `resourcePools[${index}].venue`);
  eq(pool.range, "full", `resourcePools[${index}].range`);
  eq(pool.hook, zero, `resourcePools[${index}].hook`);
  if (pool.minInputUsageMps < 9_900_000) fail(`resourcePools[${index}] safety margin exceeds 1%`);
});

eq(manifest.flows.residualLauncherBalances, "0", "flows.residualLauncherBalances");
eq(manifest.flows.residualAllowances, "0", "flows.residualAllowances");
eq(manifest.topology.canonicalPools.length, 4, "topology.canonicalPools.length");
for (const forbidden of ["aerodromeSeeded", "resourceWethSeeded", "resourceStableSeeded", "duplicateVenueSeeded"]) {
  eq(manifest.topology[forbidden], false, `topology.${forbidden}`);
}
eq(manifest.reserveBacking.liabilitiesPlusApprovedMarginsRequired, true, "reserveBacking requirement");
eq(manifest.reserveBacking.mintUsed, false, "reserveBacking.mintUsed");
eq(manifest.evidence.result, "1 passed; 0 failed", "evidence.result");

for (const [name, deployment] of Object.entries(manifest.officialDeployments)) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(deployment.address)) fail(`${name}.address`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(deployment.codehash)) fail(`${name}.codehash`);
}

console.log(`VEYDRIFT Uniswap dry-run manifest is internally consistent: ${path}`);
