import {
  createPublicClient,
  fallback,
  http,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";

export type WalletMessageVerifier = (input: {
  address: Address;
  message: string;
  signature: Hex;
}) => Promise<boolean>;

export type WalletDelegateResolver = (main: Address) => Promise<Address | null>;

export const walletMessageSignatureMaxBytes = 16_384;
export const walletMessageVerificationGas = 300_000n;
const defaultMaximumConcurrentSmartWalletVerifications = 4;
const defaultMaximumSmartWalletVerificationsPerWallet = 20;
const defaultMaximumSmartWalletVerificationsTotal = 120;
const defaultSmartWalletVerificationWindowMs = 60_000;

export type WalletMessageVerifierLimits = {
  maximumConcurrent?: number;
  maximumPerWallet?: number;
  maximumTotal?: number;
  windowMs?: number;
};

export class WalletMessageVerificationUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("Wallet signature verification is temporarily unavailable. Please retry.", options);
    this.name = "WalletMessageVerificationUnavailableError";
  }
}

function validSignatureSize(signature: Hex): boolean {
  return signature.length >= 4
    && signature.length % 2 === 0
    && (signature.length - 2) / 2 <= walletMessageSignatureMaxBytes;
}

export const verifyEoaWalletMessage: WalletMessageVerifier = async (input) => {
  if (!validSignatureSize(input.signature)) return false;
  try {
    return await verifyMessage(input);
  } catch {
    return false;
  }
};

export function createWalletMessageVerifier(
  smartWalletVerifier: WalletMessageVerifier,
  limits: WalletMessageVerifierLimits = {},
): WalletMessageVerifier {
  const maximumConcurrent = limits.maximumConcurrent
    ?? defaultMaximumConcurrentSmartWalletVerifications;
  const maximumPerWallet = limits.maximumPerWallet
    ?? defaultMaximumSmartWalletVerificationsPerWallet;
  const maximumTotal = limits.maximumTotal
    ?? defaultMaximumSmartWalletVerificationsTotal;
  const windowMs = limits.windowMs ?? defaultSmartWalletVerificationWindowMs;
  let activeSmartWalletVerifications = 0;
  let totalWindow = { count: 0, resetAt: 0 };
  const walletWindows = new Map<Address, { count: number; resetAt: number }>();
  return async (input) => {
    if (!validSignatureSize(input.signature)) return false;
    if (await verifyEoaWalletMessage(input)) return true;
    if (activeSmartWalletVerifications >= maximumConcurrent) {
      throw new WalletMessageVerificationUnavailableError();
    }
    const now = Date.now();
    if (totalWindow.resetAt <= now) totalWindow = { count: 0, resetAt: now + windowMs };
    const walletKey = input.address.toLowerCase() as Address;
    const walletWindow = walletWindows.get(walletKey);
    const currentWalletWindow = !walletWindow || walletWindow.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : walletWindow;
    if (totalWindow.count >= maximumTotal || currentWalletWindow.count >= maximumPerWallet) {
      throw new WalletMessageVerificationUnavailableError();
    }
    totalWindow.count += 1;
    currentWalletWindow.count += 1;
    walletWindows.set(walletKey, currentWalletWindow);
    if (walletWindows.size > maximumTotal) {
      for (const [key, value] of walletWindows) {
        if (value.resetAt <= now) walletWindows.delete(key);
      }
    }
    activeSmartWalletVerifications += 1;
    try {
      return await smartWalletVerifier(input);
    } catch (error) {
      if (error instanceof WalletMessageVerificationUnavailableError) throw error;
      throw new WalletMessageVerificationUnavailableError({ cause: error });
    } finally {
      activeSmartWalletVerifications -= 1;
    }
  };
}

export function createDelegationAwareWalletMessageVerifier(
  verifyWalletMessage: WalletMessageVerifier,
  resolveDelegate: WalletDelegateResolver,
): WalletMessageVerifier {
  return async (input) => {
    // Check both EOA identities locally before invoking the bounded RPC-backed
    // smart-wallet verifier. A normal burner delegate must not consume the
    // main wallet's ERC-1271 rate limit on every signed metadata action.
    if (await verifyEoaWalletMessage(input)) return true;
    let delegate: Address | null;
    try {
      delegate = await resolveDelegate(input.address);
    } catch (error) {
      throw new WalletMessageVerificationUnavailableError({ cause: error });
    }
    if (delegate && await verifyEoaWalletMessage({ ...input, address: delegate })) return true;
    if (await verifyWalletMessage(input)) return true;
    return delegate ? verifyWalletMessage({ ...input, address: delegate }) : false;
  };
}

export function createRpcWalletMessageVerifier(rpcUrls: readonly string[]): WalletMessageVerifier {
  const transports = rpcUrls.map((url) => http(url, { retryCount: 1, timeout: 10_000 }));
  if (transports.length === 0) return verifyEoaWalletMessage;
  const client = createPublicClient({
    transport: transports.length === 1 ? transports[0]! : fallback(transports),
  });
  return createWalletMessageVerifier((input) => client.verifyMessage({
    ...input,
    gas: walletMessageVerificationGas,
  } as Parameters<typeof client.verifyMessage>[0]));
}
