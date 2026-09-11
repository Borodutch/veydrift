

export type MissionCargoDraft = {
  metal: string;
  crystal: string;
  deuterium: string;
};

export function emptyMissionCargoDraft(): MissionCargoDraft {
  return { metal: "0", crystal: "0", deuterium: "0" };
}

export function normalizeMissionCargoDraft(
  cargo: Partial<MissionCargoDraft> | undefined,
): MissionCargoDraft {
  return {
    metal: String(resourceDraftNumber(cargo?.metal)),
    crystal: String(resourceDraftNumber(cargo?.crystal)),
    deuterium: String(resourceDraftNumber(cargo?.deuterium)),
  };
}

export function resourceDraftNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}
