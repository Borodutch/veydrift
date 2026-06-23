import { buildingContractIds, type BuildingKey } from "./playableMvp";
import type { QueueStateResponse } from "./walletFlow";

export type BuildingActionState =
  | { status: "idle" }
  | { status: "pending"; label: string; buildingKey?: BuildingKey | undefined }
  | { status: "success"; label: string; buildingKey?: BuildingKey | undefined }
  | { status: "error"; label: string; buildingKey?: BuildingKey | undefined; autoDismiss?: boolean | undefined };

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

export function infrastructureDisplayActionNoticeFor({
  action,
  finishUnavailableReason,
}: {
  action: BuildingActionState;
  finishUnavailableReason?: string | undefined;
}): InfrastructureActionNotice | undefined {
  // Finish-unavailable reasons already drive disabled finish controls and load warnings.
  if (action.status === "error" && finishUnavailableReason && action.label === finishUnavailableReason) {
    return undefined;
  }

  return infrastructureActionNoticeFor(action);
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

export type StartedBuildingQueueExpectation = {
  itemId: number;
  targetLevel?: number | undefined;
};

export function isStartedBuildingQueueSyncingLabel(label: string): boolean {
  return /indexed building queue state is still syncing/i.test(label);
}

export function isStartedBuildingQueueSynced(
  activeBuildingQueue: QueueStateResponse | null | undefined,
  expectation: StartedBuildingQueueExpectation | undefined,
): boolean {
  return Boolean(
    expectation
      && activeBuildingQueue?.active
      && activeBuildingQueue.itemId === expectation.itemId
      && (
        expectation.targetLevel === undefined
          || (activeBuildingQueue.targetLevel ?? 0) >= expectation.targetLevel
      ),
  );
}

export function recoveredStartedBuildingAction({
  action,
  activeBuildingQueue,
  expectation,
}: {
  action: BuildingActionState;
  activeBuildingQueue: QueueStateResponse | null | undefined;
  expectation: StartedBuildingQueueExpectation | undefined;
}): BuildingActionState {
  if (
    action.status !== "error"
      || !isStartedBuildingQueueSyncingLabel(action.label)
      || !isStartedBuildingQueueSynced(activeBuildingQueue, expectation)
  ) {
    return action;
  }

  const recoveredBuildingKey = buildingKeyForContractId(expectation?.itemId);
  if (action.buildingKey && recoveredBuildingKey && action.buildingKey !== recoveredBuildingKey) {
    return action;
  }

  return {
    status: "success",
    buildingKey: recoveredBuildingKey ?? action.buildingKey,
    label: "Building upgrade started.",
  };
}
