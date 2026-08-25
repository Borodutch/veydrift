import {readFileSync} from "node:fs";
import {join} from "node:path";

const artifactPath = join("out", "VeydriftGame.sol", "VeydriftGame.json");
const expectedPath = join("storage-layout", "VeydriftGame.v1.json");

const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const expected = JSON.parse(readFileSync(expectedPath, "utf8"));

const layout = artifact.storageLayout;
if (!layout?.storage || !layout?.types) {
  throw new Error(`Missing storageLayout in ${artifactPath}. Run forge build --extra-output storageLayout.`);
}

const normalizeType = (typeId) => {
  const type = layout.types[typeId];
  if (!type) return typeId.replace(/\)\d+_/g, ")_");

  if (type.label.startsWith("struct ")) {
    return type.label.replace(/^struct [A-Za-z0-9_]+\./, "");
  }

  if (type.label.startsWith("mapping(")) {
    return type.label.replace(/struct [A-Za-z0-9_]+\./g, "struct ");
  }

  return type.label;
};

const current = {
  storage: layout.storage.map((entry) => ({
    label: entry.label,
    slot: entry.slot,
    offset: entry.offset,
    type: normalizeType(entry.type),
  })),
  structs: {},
};

for (const type of Object.values(layout.types)) {
  if (!type.label?.startsWith("struct ") || !type.members) continue;

  const structName = type.label.replace(/^struct [A-Za-z0-9_]+\./, "");
  current.structs[structName] = type.members.map((member) => ({
    label: member.label,
    slot: member.slot,
    offset: member.offset,
    type: normalizeType(member.type),
  }));
}

const sortValue = (value) => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
};

const stableStringify = (value) => JSON.stringify(sortValue(value), null, 2);
const currentJson = stableStringify(current);
const expectedJson = stableStringify(expected);

const reviewedStorageAppend = [
  {
    label: "riftExtractions",
    slot: "55",
    offset: 0,
    type: "mapping(uint256 => mapping(enum Resource => struct RiftExtraction))",
  },
  {
    label: "_riftLockedResources",
    slot: "56",
    offset: 0,
    type: "mapping(uint256 => struct Resources)",
  },
  {
    label: "_inviteeProductionBoostExpiresAt",
    slot: "57",
    offset: 0,
    type: "mapping(address => uint64)",
  },
  {
    label: "_battleResolutionProgress",
    slot: "58",
    offset: 0,
    type: "mapping(uint256 => struct BattleResolutionProgress)",
  },
  {
    label: "_missionOriginMoonGeneration",
    slot: "59",
    offset: 0,
    type: "mapping(uint256 => uint64)",
  },
  {
    label: "_missionTargetMoonGeneration",
    slot: "60",
    offset: 0,
    type: "mapping(uint256 => uint64)",
  },
  {
    label: "_moonAttackParityActivatedAt",
    slot: "61",
    offset: 0,
    type: "uint64",
  },
  {
    label: "_missionOriginMoonGenerationRecorded",
    slot: "62",
    offset: 0,
    type: "mapping(uint256 => bool)",
  },
  {
    label: "_missionTargetMoonGenerationRecorded",
    slot: "63",
    offset: 0,
    type: "mapping(uint256 => bool)",
  },
  {
    label: "_planetTemperatureGenerationVersion",
    slot: "64",
    offset: 0,
    type: "uint8",
  },
];
const riftExtractionStruct = [
  {label: "active", slot: "0", offset: 0, type: "bool"},
  {label: "amount", slot: "0", offset: 1, type: "uint128"},
  {label: "startedAt", slot: "0", offset: 17, type: "uint64"},
  {label: "unlocksAt", slot: "1", offset: 0, type: "uint64"},
];
const battleResolutionProgressStruct = [
  {label: "seed", slot: "0", offset: 0, type: "uint256"},
  {label: "attackerLosses", slot: "1", offset: 0, type: "Resources"},
  {label: "defenderLosses", slot: "3", offset: 0, type: "Resources"},
  {label: "defenderDefenseDestroyed", slot: "5", offset: 0, type: "uint256"},
  {label: "rounds", slot: "6", offset: 0, type: "uint8"},
];
const currentV1Prefix = {
  storage: current.storage.slice(0, expected.storage.length),
  structs: Object.fromEntries(
    Object.keys(expected.structs).map((name) => [name, current.structs[name]])
  ),
};
const hasReviewedStorageAppend = (
  stableStringify(currentV1Prefix) === expectedJson
  && stableStringify(current.storage.slice(expected.storage.length)) === stableStringify(reviewedStorageAppend)
  && stableStringify(current.structs.RiftExtraction) === stableStringify(riftExtractionStruct)
  && stableStringify(current.structs.BattleResolutionProgress) === stableStringify(battleResolutionProgressStruct)
);

if (currentJson !== expectedJson && !hasReviewedStorageAppend) {
  console.error("VeydriftGame storage layout differs from storage-layout/VeydriftGame.v1.json");
  console.error("It must preserve the v1 layout or exactly match the reviewed append.");
  process.exit(1);
}

console.log(
  currentJson === expectedJson
    ? "VeydriftGame storage layout matches storage-layout/VeydriftGame.v1.json"
    : "VeydriftGame storage layout preserves v1 and exactly matches the reviewed storage append"
);

for (const contractName of ["VeydriftMetal", "VeydriftCrystal", "VeydriftDeuterium"]) {
  const tokenArtifactPath = join("out", "VeydriftResourceToken.sol", `${contractName}.json`);
  const tokenArtifact = JSON.parse(readFileSync(tokenArtifactPath, "utf8"));
  const tokenStorage = tokenArtifact.storageLayout?.storage;

  if (!Array.isArray(tokenStorage)) {
    throw new Error(
      `Missing storageLayout in ${tokenArtifactPath}. Run forge build --extra-output storageLayout.`
    );
  }

  if (tokenStorage.length !== 0) {
    console.error(`${contractName} introduced custom storage. Review upgrade compatibility before updating the guard.`);
    process.exit(1);
  }
}

console.log("Resource token storage layouts have no custom storage entries");

const randomnessArtifactPath = join("out", "RandomnessEngine.sol", "RandomnessEngine.json");
const randomnessArtifact = JSON.parse(readFileSync(randomnessArtifactPath, "utf8"));
const randomnessStorage = randomnessArtifact.storageLayout?.storage;
if (!Array.isArray(randomnessStorage)) {
  throw new Error(
    `Missing storageLayout in ${randomnessArtifactPath}. Run forge build --extra-output storageLayout.`
  );
}

// Slots 0-5 are the live v1 proxy layout. Later recovery state must remain strictly appended
// after the already-deployed FIFO inventory.
const expectedRandomnessStorage = [
  ["nextRequestId", "0", 0],
  ["fulfiller", "1", 0],
  ["precommitRequired", "1", 20],
  ["pendingCommitment", "2", 0],
  ["pendingCommitmentBlock", "3", 0],
  ["authorizedRequesters", "4", 0],
  ["_requests", "5", 0],
  ["_queuedCommitments", "6", 0],
  ["_queuedCommitmentBlocks", "7", 0],
  ["_queuedCommitmentHead", "8", 0],
  ["_queuedCommitmentTail", "9", 0],
  ["_recoveryCommitmentBlocks", "10", 0],
];
const actualRandomnessStorage = randomnessStorage.map(({label, slot, offset}) => [label, slot, offset]);
if (JSON.stringify(actualRandomnessStorage) !== JSON.stringify(expectedRandomnessStorage)) {
  console.error("RandomnessEngine storage layout is not the reviewed v1-prefix + FIFO append layout");
  process.exit(1);
}

console.log("RandomnessEngine storage layout preserves the live v1 prefix and appended recovery state");
