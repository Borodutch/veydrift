import { buildingContractIds, type BuildingKey } from "./playableMvp";

export type BuildingActionState =
  | { status: "idle" }
  | { status: "pending"; label: string; buildingKey?: BuildingKey | undefined }
  | { status: "success"; label: string; buildingKey?: BuildingKey | undefined }
  | { status: "error"; label: string; buildingKey?: BuildingKey | undefined };

export type InfrastructureActionNotice = {
  buildingKey?: BuildingKey | undefined;
  label: string;
  tone: "error" | "success" | "pending";
};

export function infrastructureActionNoticeFor(
  action: BuildingActionState,
): InfrastructureActionNotice | undefined {
  if (action.status === "idle" || action.status === "pending") {
    return undefined;
  }

  return {
    ...(action.buildingKey ? { buildingKey: action.buildingKey } : {}),
    label: action.label,
    tone: action.status === "error" ? "error" : "success",
  };
}

export function actionNoticeForBuilding(
  actionNotice: InfrastructureActionNotice | undefined,
  buildingKey: BuildingKey,
): InfrastructureActionNotice | undefined {
  if (actionNotice?.buildingKey && actionNotice.buildingKey !== buildingKey) {
    return undefined;
  }

  return actionNotice;
}

export function buildingKeyForContractId(itemId: number | string | undefined): BuildingKey | undefined {
  if (itemId === undefined) return undefined;
  const numericItemId = typeof itemId === "string" ? Number(itemId) : itemId;
  if (!Number.isFinite(numericItemId)) return undefined;

  for (const [key, contractId] of Object.entries(buildingContractIds) as Array<[BuildingKey, number]>) {
    if (contractId === numericItemId) return key;
  }

  return undefined;
}
