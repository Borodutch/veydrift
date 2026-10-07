import { maximumBatchSupplyResource } from "./batchSupplyPlanner";

export type SupplyMaxRequest = {
  options: Parameters<typeof maximumBatchSupplyResource>[0];
  resource: Parameters<typeof maximumBatchSupplyResource>[1];
};
export type SupplyMaxResponse = { maximum: number } | { error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SupplyMaxRequest>) => void) | null;
  postMessage: (response: SupplyMaxResponse) => void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ maximum: maximumBatchSupplyResource(data.options, data.resource) });
  } catch {
    scope.postMessage({ error: "Could not calculate Max. Please retry or enter an amount." });
  }
};
