import type {
  ChainRiftState,
  ManagedPlanetResponse,
  OnChainResources,
  OrbitBodyKind,
  ResourceSnapshotMetadata,
  WalletSettlementResponse,
} from "./walletFlow";

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
};

export type CanonicalPlanetResourceStore = Record<string, CanonicalPlanetResourceSnapshot>;

export type PromoteCanonicalResourceOptions = {
  confirmedTransaction?: boolean;
};

export function canonicalPlanetResourceKey(
  wallet: string,
  planetId: string,
  bodyKind: OrbitBodyKind = "planet",
): string {
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
    wallet,
  }: {
    bodyKind?: OrbitBodyKind;
    planetId?: string | null | undefined;
    wallet?: string | null | undefined;
  } = {},
): CanonicalPlanetResourceSnapshot | undefined {
  if (!state) return undefined;
  const snapshot = state.resourceSnapshot ?? null;
  const resolvedWallet = state.wallet ?? wallet;
  const resolvedPlanetId = snapshot?.planetId
    ?? state.planetId
    ?? state.parentPlanetId
    ?? planetId
    ?? state.homePlanetId;
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

export function shouldPromoteCanonicalPlanetResources(
  current: CanonicalPlanetResourceSnapshot,
  next: CanonicalPlanetResourceSnapshot,
  options: PromoteCanonicalResourceOptions = {},
): boolean {
  if (
    canonicalPlanetResourceKey(current.wallet, current.planetId, current.bodyKind)
    !== canonicalPlanetResourceKey(next.wallet, next.planetId, next.bodyKind)
  ) {
    return true;
  }

  const blockOrder = compareOptionalInteger(next.blockNumber, current.blockNumber);
  if (blockOrder !== undefined && blockOrder !== 0) return blockOrder > 0;
  if (blockOrder === undefined && current.blockNumber != null) return false;

  const logOrder = compareOptionalInteger(next.logIndex, current.logIndex);
  if (logOrder !== undefined && logOrder !== 0) return logOrder > 0;
  if (logOrder === undefined && current.logIndex != null) return false;

  const settledOrder = compareOptionalInteger(next.lastSettledAt, current.lastSettledAt);
  if (settledOrder !== undefined && settledOrder !== 0) return settledOrder > 0;
  if (settledOrder === undefined && current.lastSettledAt != null) return false;

  if (options.confirmedTransaction) return true;

  // A resource snapshot can retain the same block/settle metadata while the backend
  // advances its production-accrued `resourcesAsOfNow`. Such a refresh is safe only
  // when every balance is monotonic. A decrease without newer index metadata is an
  // older response and must not resurrect or fabricate a pre-transaction balance.
  return resourcesAtLeast(next.resources, current.resources)
    && resourcesAtLeast(next.resourcesAsOfNow, current.resourcesAsOfNow);
}

export function resourceStateWithCanonicalPlanetResources<
  T extends BackendResourceState | null | undefined,
>(
  state: T,
  snapshot: CanonicalPlanetResourceSnapshot | undefined,
): T {
  if (!state || !snapshot) return state;
  return {
    ...state,
    resources: snapshot.resources,
    resourcesAsOfNow: snapshot.resourcesAsOfNow,
    resourceSnapshot: snapshot.resourceSnapshot,
    ...(state.planetLastSettledAt === undefined
      ? {}
      : { planetLastSettledAt: snapshot.lastSettledAt ?? state.planetLastSettledAt }),
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

export function walletPlanetsWithCanonicalPlanetResources(
  planets: readonly ManagedPlanetResponse[],
  store: CanonicalPlanetResourceStore,
  wallet: string | null | undefined,
): ManagedPlanetResponse[] {
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

export function riftStateWithCanonicalPlanetResources(
  state: ChainRiftState | null,
  snapshot: CanonicalPlanetResourceSnapshot | undefined,
): ChainRiftState | null {
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

function resourcesAtLeast(next: OnChainResources, current: OnChainResources): boolean {
  return resourceAmount(next.metal) >= resourceAmount(current.metal)
    && resourceAmount(next.crystal) >= resourceAmount(current.crystal)
    && resourceAmount(next.deuterium) >= resourceAmount(current.deuterium);
}

function resourceAmount(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return -1n;
  }
}

function compareOptionalInteger(
  left: string | number | bigint | null,
  right: string | number | bigint | null,
): number | undefined {
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

function sameCanonicalPlanetResources(
  left: CanonicalPlanetResourceSnapshot,
  right: CanonicalPlanetResourceSnapshot,
): boolean {
  return left.blockNumber === right.blockNumber
    && left.logIndex === right.logIndex
    && left.lastSettledAt === right.lastSettledAt
    && left.transactionHash === right.transactionHash
    && sameResources(left.resources, right.resources)
    && sameResources(left.resourcesAsOfNow, right.resourcesAsOfNow);
}

function sameResources(left: OnChainResources, right: OnChainResources): boolean {
  return left.metal === right.metal
    && left.crystal === right.crystal
    && left.deuterium === right.deuterium;
}
