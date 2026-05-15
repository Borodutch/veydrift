export type ResourceKey = "alloy" | "energy" | "data" | "crew";

export type Cost = Partial<Record<ResourceKey, number>>;

export type QueueType = "building" | "research";

export type QueueItem = {
  id: string;
  targetId: string;
  type: QueueType;
  startedAt: number;
  completesAt: number;
};

export type GameState = {
  version: 1;
  resources: Record<ResourceKey, number>;
  buildings: Record<string, number>;
  research: Record<string, number>;
  queue: QueueItem[];
};

export type BuildingDefinition = {
  id: string;
  name: string;
  role: string;
  maxLevel: number;
  baseSeconds: number;
  cost: Cost;
  effect: string;
  requires?: Requirement[];
};

export type ResearchDefinition = {
  id: string;
  name: string;
  lane: string;
  maxLevel: number;
  baseSeconds: number;
  cost: Cost;
  unlock: string;
  requires?: Requirement[];
};

export type Requirement = {
  targetId: string;
  type: QueueType;
  level: number;
};

export type StartResult =
  | { ok: true; state: GameState; item: QueueItem }
  | { ok: false; reason: ActionReason };

export type ActionReason =
  | "available"
  | "building-slots-full"
  | "insufficient-resources"
  | "locked"
  | "maxed"
  | "pending"
  | "research-slots-full";

export const STORAGE_KEY = "veydrift-management-state";

export const resourceLabels: Record<ResourceKey, string> = {
  alloy: "Alloy",
  energy: "Energy",
  data: "Data",
  crew: "Crew"
};

export const buildingDefinitions: BuildingDefinition[] = [
  {
    id: "alloy-mine",
    name: "Alloy Mine",
    role: "Resource",
    maxLevel: 5,
    baseSeconds: 12,
    cost: { alloy: 160, energy: 60, crew: 12 },
    effect: "Raises base alloy production and unlocks extraction tech."
  },
  {
    id: "solar-array",
    name: "Solar Array",
    role: "Power",
    maxLevel: 5,
    baseSeconds: 10,
    cost: { alloy: 120, crew: 10 },
    effect: "Adds energy surplus for building and research orders."
  },
  {
    id: "storage-vault",
    name: "Storage Vault",
    role: "Logistics",
    maxLevel: 4,
    baseSeconds: 14,
    cost: { alloy: 260, energy: 90, crew: 18 },
    effect: "Expands resource caps and protects idle output."
  },
  {
    id: "research-lab",
    name: "Research Lab",
    role: "Science",
    maxLevel: 3,
    baseSeconds: 16,
    cost: { alloy: 220, energy: 120, crew: 24 },
    effect: "Enables advanced industry and extraction research."
  },
  {
    id: "command-nexus",
    name: "Command Nexus",
    role: "Command",
    maxLevel: 3,
    baseSeconds: 20,
    cost: { alloy: 600, energy: 300, crew: 80 },
    effect: "Adds parallel order capacity and sector routing."
  }
];

export const researchDefinitions: ResearchDefinition[] = [
  {
    id: "orbital-cartography",
    name: "Orbital Cartography",
    lane: "Exploration",
    maxLevel: 3,
    baseSeconds: 12,
    cost: { data: 60, energy: 80 },
    unlock: "Reveals hidden sectors and orbit transfer windows."
  },
  {
    id: "base-relay-security",
    name: "Base Relay Security",
    lane: "Network",
    maxLevel: 2,
    baseSeconds: 14,
    cost: { data: 80, energy: 120 },
    unlock: "Improves relay verification for settlement state."
  },
  {
    id: "adaptive-foundries",
    name: "Adaptive Foundries",
    lane: "Industry",
    maxLevel: 3,
    baseSeconds: 16,
    cost: { alloy: 200, data: 180 },
    unlock: "Adds refinery automation bonuses.",
    requires: [{ type: "building", targetId: "research-lab", level: 1 }]
  },
  {
    id: "deep-core-extraction",
    name: "Deep Core Extraction",
    lane: "Extraction",
    maxLevel: 2,
    baseSeconds: 22,
    cost: { alloy: 420, energy: 260, data: 220 },
    unlock: "Unlocks richer underground deposits.",
    requires: [
      { type: "building", targetId: "alloy-mine", level: 3 },
      { type: "research", targetId: "orbital-cartography", level: 2 }
    ]
  }
];

export function createInitialGameState(): GameState {
  return {
    version: 1,
    resources: {
      alloy: 640,
      energy: 410,
      data: 240,
      crew: 130
    },
    buildings: {
      "alloy-mine": 1,
      "solar-array": 1,
      "storage-vault": 0,
      "research-lab": 0,
      "command-nexus": 1
    },
    research: {
      "orbital-cartography": 0,
      "base-relay-security": 0,
      "adaptive-foundries": 0,
      "deep-core-extraction": 0
    },
    queue: []
  };
}

export function loadGameState(serialized: string | null): GameState {
  if (!serialized) {
    return createInitialGameState();
  }

  try {
    const parsed = JSON.parse(serialized) as Partial<GameState>;

    if (parsed.version !== 1 || !parsed.resources || !parsed.buildings || !parsed.research) {
      return createInitialGameState();
    }

    return {
      ...createInitialGameState(),
      resources: { ...createInitialGameState().resources, ...parsed.resources },
      buildings: { ...createInitialGameState().buildings, ...parsed.buildings },
      research: { ...createInitialGameState().research, ...parsed.research },
      queue: Array.isArray(parsed.queue) ? parsed.queue : []
    };
  } catch {
    return createInitialGameState();
  }
}

export function advanceState(state: GameState, now: number): GameState {
  const completed = state.queue.filter((item) => item.completesAt <= now);

  if (completed.length === 0) {
    return state;
  }

  const next: GameState = {
    ...state,
    buildings: { ...state.buildings },
    research: { ...state.research },
    queue: state.queue.filter((item) => item.completesAt > now)
  };

  for (const item of completed) {
    if (item.type === "building") {
      next.buildings[item.targetId] = (next.buildings[item.targetId] ?? 0) + 1;
    } else {
      next.research[item.targetId] = (next.research[item.targetId] ?? 0) + 1;
    }
  }

  return next;
}

export function startBuilding(
  state: GameState,
  targetId: string,
  now: number
): StartResult {
  const definition = buildingDefinitions.find((item) => item.id === targetId);

  if (!definition) {
    return { ok: false, reason: "locked" };
  }

  const reason = getActionReason(state, definition, "building");

  if (reason !== "available") {
    return { ok: false, reason };
  }

  const item = createQueueItem("building", definition.id, definition.baseSeconds, now);

  return {
    ok: true,
    item,
    state: spendResources({
      ...state,
      queue: [...state.queue, item]
    }, definition.cost)
  };
}

export function startResearch(
  state: GameState,
  targetId: string,
  now: number
): StartResult {
  const definition = researchDefinitions.find((item) => item.id === targetId);

  if (!definition) {
    return { ok: false, reason: "locked" };
  }

  const reason = getActionReason(state, definition, "research");

  if (reason !== "available") {
    return { ok: false, reason };
  }

  const item = createQueueItem("research", definition.id, definition.baseSeconds, now);

  return {
    ok: true,
    item,
    state: spendResources({
      ...state,
      queue: [...state.queue, item]
    }, definition.cost)
  };
}

export function getActionReason(
  state: GameState,
  definition: BuildingDefinition | ResearchDefinition,
  type: QueueType
): ActionReason {
  const levels = type === "building" ? state.buildings : state.research;
  const level = levels[definition.id] ?? 0;

  if (level >= definition.maxLevel) {
    return "maxed";
  }

  if (state.queue.some((item) => item.type === type && item.targetId === definition.id)) {
    return "pending";
  }

  if (definition.requires?.some((requirement) => !requirementMet(state, requirement))) {
    return "locked";
  }

  if (type === "building" && state.queue.filter((item) => item.type === "building").length >= 2) {
    return "building-slots-full";
  }

  if (type === "research" && state.queue.filter((item) => item.type === "research").length >= 1) {
    return "research-slots-full";
  }

  if (!hasResources(state, definition.cost)) {
    return "insufficient-resources";
  }

  return "available";
}

export function formatCost(cost: Cost): string {
  return (Object.entries(cost) as Array<[ResourceKey, number]>)
    .map(([resource, amount]) => `${amount} ${resourceLabels[resource].toLowerCase()}`)
    .join(", ");
}

export function formatTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  if (minutes === 0) {
    return `${remainder}s`;
  }

  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

export function queueProgress(item: QueueItem, now: number): number {
  const duration = item.completesAt - item.startedAt;

  if (duration <= 0) {
    return 100;
  }

  return Math.min(100, Math.max(0, ((now - item.startedAt) / duration) * 100));
}

function requirementMet(state: GameState, requirement: Requirement): boolean {
  const levels = requirement.type === "building" ? state.buildings : state.research;

  return (levels[requirement.targetId] ?? 0) >= requirement.level;
}

function hasResources(state: GameState, cost: Cost): boolean {
  return (Object.entries(cost) as Array<[ResourceKey, number]>).every(
    ([resource, amount]) => state.resources[resource] >= amount
  );
}

function spendResources(state: GameState, cost: Cost): GameState {
  const resources = { ...state.resources };

  for (const [resource, amount] of Object.entries(cost) as Array<[ResourceKey, number]>) {
    resources[resource] -= amount;
  }

  return { ...state, resources };
}

function createQueueItem(
  type: QueueType,
  targetId: string,
  seconds: number,
  now: number
): QueueItem {
  return {
    id: `${type}-${targetId}-${now}`,
    targetId,
    type,
    startedAt: now,
    completesAt: now + seconds * 1000
  };
}
