import { dirname } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

export type ListenerState = {
  lastScannedBlock: string;
  processedBurnIds: string[];
};

export class JsonStateStore {
  private state: ListenerState = { lastScannedBlock: "0", processedBurnIds: [] };
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<ListenerState>;
      this.state = {
        lastScannedBlock: normalizeBlock(parsed.lastScannedBlock),
        processedBurnIds: Array.isArray(parsed.processedBurnIds)
          ? [...new Set(parsed.processedBurnIds.filter((item): item is string => typeof item === "string"))]
          : []
      };
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") {
        throw error;
      }
    }
    this.loaded = true;
  }

  hasProcessed(burnId: string): boolean {
    return this.state.processedBurnIds.includes(burnId);
  }

  async markProcessed(burnId: string): Promise<void> {
    if (!this.hasProcessed(burnId)) {
      this.state.processedBurnIds.push(burnId);
      await this.save();
    }
  }

  lastScannedBlock(): bigint {
    return BigInt(this.state.lastScannedBlock);
  }

  async setLastScannedBlock(block: bigint): Promise<void> {
    if (block > this.lastScannedBlock()) {
      this.state.lastScannedBlock = block.toString();
      await this.save();
    }
  }

  snapshot(): ListenerState {
    return {
      lastScannedBlock: this.state.lastScannedBlock,
      processedBurnIds: [...this.state.processedBurnIds]
    };
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    await rename(tmp, this.filePath);
  }
}

function normalizeBlock(value: unknown): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return "0";
  }
  return value;
}
