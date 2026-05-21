import {
  readSettlementState,
  type Eip1193Provider,
  type SettlementConfig,
  type SettlementState,
} from "./walletFlow";

const POST_SETTLEMENT_READ_ATTEMPTS = 8;
const POST_SETTLEMENT_READ_INTERVAL_MS = 2_000;

type PostSettlementReadOptions = {
  attempts?: number;
  delay?: (ms: number) => Promise<void>;
  intervalMs?: number;
  readSettlementState?: (
    provider: Eip1193Provider,
    account: string,
    settlementConfig: SettlementConfig,
  ) => Promise<SettlementState>;
};

export async function waitForSettledPlanet(
  provider: Eip1193Provider,
  account: string,
  settlementConfig: SettlementConfig,
  options: PostSettlementReadOptions = {},
) {
  const attempts = options.attempts ?? POST_SETTLEMENT_READ_ATTEMPTS;
  const intervalMs = options.intervalMs ?? POST_SETTLEMENT_READ_INTERVAL_MS;
  const read = options.readSettlementState ?? readSettlementState;
  const wait = options.delay ?? delay;
  let lastSettlement = await read(provider, account, settlementConfig);

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    if (lastSettlement.kind === "settled") {
      return lastSettlement;
    }

    if (attempt === attempts) {
      break;
    }

    await wait(intervalMs);
    lastSettlement = await read(provider, account, settlementConfig);
  }

  throw new Error("Settlement is confirmed, but the planet is still syncing. Retry once the chain read catches up.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
