import type { ChainRiftState, ManagedPlanetResponse, OnChainResources, OrbitBodyKind, ResourceSnapshotMetadata, WalletSettlementResponse } from "./walletFlow";

export type BackendResourceState = {
  wallet?: string | null | undefined;
  homePlanetId?: string | null | undefined;
  parentPlanetId?: string | null | undefined;
  planetId?: string | null | undefined;
  planetLastSettledAt?: string | null | undefined;
  resources?: OnChainResources | null | undefined;
  resourcesAsOfNow?: OnChainResources | null | undefined;
  resourceSnapshot?: ResourceSnapshotMetadata | null | undefined;
};

export type CanonicalPlanetResourceSnapshot = {
  bodyKind: OrbitBodyKind;
  wallet: string;
  planetId: string;
  resources: OnChainResources;
  resourcesAsOfNow: OnChainResources;
  resourceSnapshot: ResourceSnapshotMetadata | null;
  blockNumber: string | number | bigint | null;
  logIndex: string | number | bigint | null;
  lastSettledAt: string | null;
  transactionHash: string | null;
  /** Detail endpoints outrank roster/settlement projections when metadata ties. */
  sourcePriority: number;
  /**
   * Monotonic per-body read generation assigned by BackendDataStore when a
   * detail request starts. It prevents an older cross-endpoint response from
   * resurrecting a balance after a newer detail request already won.
   */
  requestGeneration?: number | undefined;
};

export type CanonicalPlanetResourceStore = Record<string, CanonicalPlanetResourceSnapshot>;

export type PromoteCanonicalResourceOptions = {
  confirmedTransaction?: boolean;
};

export function canonicalPlanetResourceKey(wallet: string, planetId: string, bodyKind: OrbitBodyKind = "planet"): string {
  return `${wallet.toLowerCase()}:${bodyKind}:${planetId}`;
}

export function canonicalPlanetResourceSnapshotFor(
  store: CanonicalPlanetResourceStore,
  wallet: string | null | undefined,
  planetId: string | null | undefined,
  bodyKind: OrbitBodyKind = "planet",
): CanonicalPlanetResourceSnapshot | undefined {
  if (!wallet || !planetId) return undefined;
  return store[canonicalPlanetResourceKey(wallet, planetId, bodyKind)];
}

export function backendResourceSnapshot(
  state: BackendResourceState | null | undefined,
  {
    bodyKind = "planet",
    planetId,
    sourcePriority = 30,
    requestGeneration,
    wallet,
  }: {
    bodyKind?: OrbitBodyKind;
    planetId?: string | null | undefined;
    sourcePriority?: number | undefined;
    requestGeneration?: number | undefined;
    wallet?: string | null | undefined;
  } = {},
): CanonicalPlanetResourceSnapshot | undefined {
  if (!state) return undefined;
  const snapshot = state.resourceSnapshot ?? null;
  const resolvedWallet = state.wallet ?? wallet;
  const explicitPlanetId = snapshot?.planetId ?? state.planetId ?? state.parentPlanetId;
  // A number of aggregate responses include the wallet's homePlanetId even
  // when their resource payload is not explicitly identified. Never attach
  // such a payload to a different requested planet: that can make the top
  // bar (and consequently a Max mission) borrow the home planet's balance.
  // Missing identity is safer than cross-planet inventory.
  if (!explicitPlanetId && planetId && state.homePlanetId && state.homePlanetId !== planetId) {
    return undefined;
  }
  const resolvedPlanetId = explicitPlanetId ?? planetId ?? state.homePlanetId;
  const resources = snapshot?.resources ?? state.resources;
  const resourcesAsOfNow = state.resourcesAsOfNow ?? resources;
  if (!resolvedWallet || !resolvedPlanetId || !completeResources(resources) || !completeResources(resourcesAsOfNow)) {
    return undefined;
  }

  return {
    bodyKind,
    wallet: resolvedWallet,
    planetId: resolvedPlanetId,
    resources,
    resourcesAsOfNow,
    resourceSnapshot: snapshot,
    blockNumber: snapshot?.blockNumber ?? null,
    logIndex: snapshot?.logIndex ?? null,
    lastSettledAt: snapshot?.lastSettledAt ?? state.planetLastSettledAt ?? null,
    transactionHash: snapshot?.transactionHash ?? null,
    sourcePriority,
    ...(requestGeneration === undefined ? {} : { requestGeneration }),
  };
}

export function promoteCanonicalPlanetResources(
  store: CanonicalPlanetResourceStore,
  next: CanonicalPlanetResourceSnapshot | undefined,
  options: PromoteCanonicalResourceOptions = {},
): CanonicalPlanetResourceStore {
  if (!next) return store;
  const key = canonicalPlanetResourceKey(next.wallet, next.planetId, next.bodyKind);
  const current = store[key];
  if (current && !shouldPromoteCanonicalPlanetResources(current, next, options)) return store;
  if (current && sameCanonicalPlanetResources(current, next)) return store;
  return { ...store, [key]: next };
}

export function shouldPromoteCanonicalPlanetResources(current: CanonicalPlanetResourceSnapshot, next: CanonicalPlanetResourceSnapshot, options: PromoteCanonicalResourceOptions = {}): boolean {
  if (canonicalPlanetResourceKey(current.wallet, current.planetId, current.bodyKind) !== canonicalPlanetResourceKey(next.wallet, next.planetId, next.bodyKind)) {
    return true;
  }

  // Reject only an explicitly older backend identity. A fresh detail response
  // is allowed to omit optional index metadata; otherwise an old rich roster
  // response could permanently retain an overestimated pre-spend balance.
  const blockOrder = compareOptionalInteger(next.blockNumber, current.blockNumber);
  if (blockOrder !== undefined && blockOrder !== 0) return blockOrder > 0;

  const logOrder = compareOptionalInteger(next.logIndex, current.logIndex);
  if (logOrder !== undefined && logOrder !== 0) return logOrder > 0;

  const settledOrder = compareOptionalInteger(next.lastSettledAt, current.lastSettledAt);
  if (settledOrder !== undefined && settledOrder !== 0) return settledOrder > 0;

  const requestOrder = compareOptionalInteger(next.requestGeneration ?? null, current.requestGeneration ?? null);
  if (requestOrder !== undefined && requestOrder !== 0) return requestOrder > 0;

  if (options.confirmedTransaction) return true;

  // A backend response is authoritative for its own query generation. When
  // metadata ties (or a transient indexer response omits it), a detail query
  // may legitimately report a lower balance after a spend. Preserve detail
  // responses over roster/settlement projections, but do not reject a fresh
  // same-priority response merely because its balance fell.
  return next.sourcePriority >= current.sourcePriority;
}

export function resourceStateWithCanonicalPlanetResources<T extends BackendResourceState | null | undefined>(state: T, snapshot: CanonicalPlanetResourceSnapshot | undefined): T {
  if (!state || !snapshot) return state;
  return {
    ...state,
    resources: snapshot.resources,
    resourcesAsOfNow: snapshot.resourcesAsOfNow,
    resourceSnapshot: snapshot.resourceSnapshot,
    ...(state.planetLastSettledAt === undefined
      ? {}
      : {
          planetLastSettledAt: snapshot.lastSettledAt ?? state.planetLastSettledAt,
        }),
  } as T;
}

export function walletSettlementWithCanonicalPlanetResources(
  settlement: WalletSettlementResponse | undefined,
  store: CanonicalPlanetResourceStore,
  wallet: string | null | undefined,
): WalletSettlementResponse | undefined {
  if (!settlement?.planet) return settlement;
  const snapshot = canonicalPlanetResourceSnapshotFor(store, wallet ?? settlement.wallet, settlement.planet.planetId);
  if (!snapshot) return settlement;
  return {
    ...settlement,
    planet: {
      ...settlement.planet,
      lastSettledAt: snapshot.lastSettledAt ?? settlement.planet.lastSettledAt,
      resources: snapshot.resources,
      resourcesAsOfNow: snapshot.resourcesAsOfNow,
      resourceSnapshot: snapshot.resourceSnapshot,
    },
  };
}

export function walletPlanetsWithCanonicalPlanetResources(planets: readonly ManagedPlanetResponse[], store: CanonicalPlanetResourceStore, wallet: string | null | undefined): ManagedPlanetResponse[] {
  if (!wallet) return [...planets];
  return planets.map((planet) => {
    const planetSnapshot = canonicalPlanetResourceSnapshotFor(store, wallet, planet.planetId);
    const moonSnapshot = canonicalPlanetResourceSnapshotFor(store, wallet, planet.planetId, "moon");
    if (!planetSnapshot && !moonSnapshot) return planet;
    return {
      ...planet,
      ...(planetSnapshot
        ? {
            lastSettledAt: planetSnapshot.lastSettledAt ?? planet.lastSettledAt,
            resources: planetSnapshot.resources,
            resourcesAsOfNow: planetSnapshot.resourcesAsOfNow,
            resourceSnapshot: planetSnapshot.resourceSnapshot,
          }
        : {}),
      ...(planet.moon && moonSnapshot
        ? {
            moon: {
              ...planet.moon,
              resources: moonSnapshot.resources,
              resourcesAsOfNow: moonSnapshot.resourcesAsOfNow,
              resourceSnapshot: moonSnapshot.resourceSnapshot,
            },
          }
        : {}),
    };
  });
}

export function riftStateWithCanonicalPlanetResources(state: ChainRiftState | null, snapshot: CanonicalPlanetResourceSnapshot | undefined): ChainRiftState | null {
  if (!state || !snapshot) return state;
  return {
    ...state,
    resources: state.resources.map((resource) => ({
      ...resource,
      inGameBalance: snapshot.resourcesAsOfNow[resource.key],
    })),
  };
}

function completeResources(resources: OnChainResources | null | undefined): resources is OnChainResources {
  return resources?.metal != null && resources.crystal != null && resources.deuterium != null;
}

function compareOptionalInteger(left: string | number | bigint | null, right: string | number | bigint | null): number | undefined {
  const leftValue = optionalInteger(left);
  const rightValue = optionalInteger(right);
  if (leftValue === undefined || rightValue === undefined) return undefined;
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
}

function optionalInteger(value: string | number | bigint | null): bigint | undefined {
  if (value === null || value === "") return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function sameCanonicalPlanetResources(left: CanonicalPlanetResourceSnapshot, right: CanonicalPlanetResourceSnapshot): boolean {
  return (
    left.blockNumber === right.blockNumber &&
    left.logIndex === right.logIndex &&
    left.lastSettledAt === right.lastSettledAt &&
    left.transactionHash === right.transactionHash &&
    left.sourcePriority === right.sourcePriority &&
    sameResources(left.resources, right.resources) &&
    sameResources(left.resourcesAsOfNow, right.resourcesAsOfNow)
  );
}

function sameResources(left: OnChainResources, right: OnChainResources): boolean {
  return left.metal === right.metal && left.crystal === right.crystal && left.deuterium === right.deuterium;
}
