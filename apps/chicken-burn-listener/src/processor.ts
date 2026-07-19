import type { ChickenBurnEvent } from "./events";
import { MoonGrantAlreadyProcessedError, type MoonGrantClient } from "./grant";
import type { JsonStateStore } from "./store";

export type ListenerLogger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, error?: unknown) => void;
};

export const consoleLogger: ListenerLogger = {
  info: (message, meta) => console.log(message, meta ?? ""),
  warn: (message, meta) => console.warn(message, meta ?? ""),
  error: (message, error) => console.error(message, error ?? "")
};

export type ProcessorSnapshot = {
  processedCount: number;
  duplicateCount: number;
  grantFailureCount: number;
  lastProcessedBurnId: string | null;
  lastGrantTxHash: string | null;
  lastError: string | null;
};

export class ChickenBurnProcessor {
  private processedCount = 0;
  private duplicateCount = 0;
  private grantFailureCount = 0;
  private lastProcessedBurnId: string | null = null;
  private lastGrantTxHash: string | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly store: JsonStateStore,
    private readonly grantClient: MoonGrantClient,
    private readonly logger: ListenerLogger = consoleLogger
  ) {}

  snapshot(): ProcessorSnapshot {
    return {
      processedCount: this.processedCount,
      duplicateCount: this.duplicateCount,
      grantFailureCount: this.grantFailureCount,
      lastProcessedBurnId: this.lastProcessedBurnId,
      lastGrantTxHash: this.lastGrantTxHash,
      lastError: this.lastError
    };
  }

  async processBurn(event: ChickenBurnEvent): Promise<void> {
    if (this.store.hasProcessed(event.burnId)) {
      this.duplicateCount += 1;
      return;
    }

    try {
      const txHash = await this.grantClient.grantMoon(event);
      await this.store.markProcessed(event.burnId);
      this.processedCount += 1;
      this.lastProcessedBurnId = event.burnId;
      this.lastGrantTxHash = txHash;
      this.lastError = null;
      this.logger.info("[chicken-burn] granted moon", {
        burnId: event.burnId,
        sourceTxHash: event.sourceTxHash,
        tokenId: event.tokenId,
        planetId: event.planetId,
        ...(event.coordinates ? { coordinates: event.coordinates } : {}),
        grantTxHash: txHash
      });
    } catch (error) {
      if (error instanceof MoonGrantAlreadyProcessedError) {
        await this.store.markProcessed(event.burnId);
        this.duplicateCount += 1;
        this.lastProcessedBurnId = event.burnId;
        this.lastError = null;
        this.logger.warn("[chicken-burn] burn already granted on-chain", {
          burnId: event.burnId,
          sourceTxHash: event.sourceTxHash
        });
        return;
      }
      this.grantFailureCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.logger.error("[chicken-burn] moon grant failed", error);
      throw error;
    }
  }
}
