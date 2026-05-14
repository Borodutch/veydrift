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

if (currentJson !== expectedJson) {
  console.error("VeydriftGame storage layout differs from storage-layout/VeydriftGame.v1.json");
  console.error("Regenerate only after reviewing UUPS upgrade compatibility.");
  process.exit(1);
}

console.log("VeydriftGame storage layout matches storage-layout/VeydriftGame.v1.json");
