import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  encodeFunctionData,
  formatEther,
  formatUnits,
  parseEther,
  type Address,
} from "viem";
import {
  BASE_MAINNET,
  ensureBaseMainnetNetwork,
  getAvailableWalletProviderDetails,
  requestAccounts,
  type Eip1193Provider,
} from "./walletFlow";
import { playableApiUrl } from "./runtimeConfig";
import { executeCcaBidSequence, readCcaAuctionBoundary } from "./ccaBidFlow";
import {
  ccaBidPriceError,
  fdvToPriceQ96,
  minimumFdvWeiAboveClearingPriceQ96,
} from "./ccaBidPrice";
import { signalFarcasterReadyOnce } from "./farcasterReady";

const AUCTION = "0x7Ce8e4cC7563a9711A3D52d48439F6dfA4C1B67F" as Address;
const WETH = "0x4200000000000000000000000000000000000006" as Address;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;
const UNISWAP_AUCTION_URL = `https://app.uniswap.org/explore/auctions/base/${AUCTION}`;
const Q96 = 1n << 96n;
const E18 = 10n ** 18n;
const NO_CHECKPOINT = (1n << 64n) - 1n;
const VEY_SUPPLY = 1_000_000_000n;
const DEFAULT_ETH_USD = 1_917.467;
const DEFAULT_FLOOR_PRICE_Q96 = 8_556_641_551_540_548_460_102n;
const AUCTION_START_BLOCK = 49_238_242n;
const AUCTION_END_BLOCK = 49_324_642n;

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const wethAbi = [
  ...erc20Abi,
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
] as const;

const permit2Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

const auctionAbi = [
  {
    type: "function",
    name: "submitBid",
    stateMutability: "payable",
    inputs: [
      { name: "maxPriceQ96", type: "uint256" },
      { name: "amount", type: "uint128" },
      { name: "owner", type: "address" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "bidId", type: "uint256" }],
  },
  {
    type: "function",
    name: "exitBid",
    stateMutability: "nonpayable",
    inputs: [{ name: "bidId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "exitPartiallyFilledBid",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bidId", type: "uint256" },
      { name: "lastFullyFilledCheckpointBlock", type: "uint64" },
      { name: "outbidBlock", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimTokens",
    stateMutability: "nonpayable",
    inputs: [{ name: "bidId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "bids",
    stateMutability: "view",
    inputs: [{ name: "bidId", type: "uint256" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "startBlock", type: "uint64" },
        { name: "startCumulativeMps", type: "uint24" },
        { name: "exitedBlock", type: "uint64" },
        { name: "maxPrice", type: "uint256" },
        { name: "owner", type: "address" },
        { name: "amountQ96", type: "uint256" },
        { name: "tokensFilled", type: "uint256" },
      ],
    }],
  },
  {
    type: "function",
    name: "checkpoints",
    stateMutability: "view",
    inputs: [{ name: "blockNumber", type: "uint64" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "clearingPrice", type: "uint256" },
        { name: "currencyRaisedAtClearingPriceQ96X7", type: "uint256" },
        { name: "cumulativeMpsPerPrice", type: "uint256" },
        { name: "cumulativeMps", type: "uint24" },
        { name: "prev", type: "uint64" },
        { name: "next", type: "uint64" },
      ],
    }],
  },
] as const;

type FundingCurrency = "eth" | "weth";
type AuctionState = {
  bidVolume: bigint;
  clearingPriceQ96: bigint;
  currentBlock: bigint;
  endBlock: bigint;
  ethUsdReference: number;
  finalized: boolean;
  floorPriceQ96: bigint;
  graduated: boolean;
  recentBids: CcaSubmittedBid[];
  startBlock: bigint;
  totalBids: number;
  walletBids: CcaSubmittedBid[];
};

export type CcaSubmittedBid = {
  amountWei: string;
  bidId: string;
  blockNumber: string;
  maxPriceQ96: string;
  owner: string;
  transactionHash: string;
};

type CcaBidSettlement = {
  exited: boolean;
  startBlock: bigint;
  tokensFilled: bigint;
};

type CcaApiPayload = {
  bidVolumeWei: string;
  clearingPriceQ96: string;
  currentBlock: string;
  endBlock: string;
  ethUsdReference?: number;
  finalized?: boolean;
  floorPriceQ96: string;
  graduated: boolean;
  recentBids?: CcaSubmittedBid[];
  startBlock: string;
  totalBids?: number;
  walletBids?: CcaSubmittedBid[];
};

type EthereumWindow = Window & { ethereum?: Eip1193Provider };

const launchSnapshot: AuctionState = {
  bidVolume: 0n,
  clearingPriceQ96: DEFAULT_FLOOR_PRICE_Q96,
  currentBlock: AUCTION_START_BLOCK,
  endBlock: AUCTION_END_BLOCK,
  ethUsdReference: DEFAULT_ETH_USD,
  finalized: false,
  floorPriceQ96: DEFAULT_FLOOR_PRICE_Q96,
  graduated: false,
  recentBids: [],
  startBlock: AUCTION_START_BLOCK,
  totalBids: 0,
  walletBids: [],
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function revealCcaBidReview(
  review: Pick<HTMLElement, "focus" | "scrollIntoView"> | null,
) {
  if (!review) return;
  review.focus({ preventScroll: true });
  review.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function providerFromWindow() {
  return (window as EthereumWindow).ethereum;
}

function formatCompactWeth(value: bigint) {
  const numeric = Number(formatEther(value));
  if (!Number.isFinite(numeric)) return "—";
  return numeric.toLocaleString(undefined, numeric >= 1
    ? { maximumFractionDigits: 3 }
    : { maximumSignificantDigits: 5 });
}

function formatUsd(value: number) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1 ? 2 : 6,
  }).format(value);
}

function priceFromQ96(value: bigint) {
  const price = Number(formatUnits((value * E18) / Q96, 18));
  return Number.isFinite(price)
    ? price.toLocaleString(undefined, { maximumSignificantDigits: 7, useGrouping: false })
    : "—";
}

function fdvFromQ96(value: bigint) {
  const fdv = (Number(value) / Number(Q96)) * Number(VEY_SUPPLY);
  return Number.isFinite(fdv) ? fdv : 0;
}

function formatVey(value: bigint) {
  const numeric = Number(formatUnits(value, 18));
  if (!Number.isFinite(numeric)) return "—";
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function availableEthForBid(balance: bigint) {
  // Keep a small native-ETH reserve for the wrap, Permit2 approval, and CCA
  // transactions. Users must never strand themselves at the last submit step.
  const gasReserve = balance / 100n;
  return balance > gasReserve ? balance - gasReserve : 0n;
}

function canFullyExitBid(auction: AuctionState, bid: CcaSubmittedBid) {
  return auction.finalized
    && (!auction.graduated || BigInt(bid.maxPriceQ96) > auction.clearingPriceQ96);
}

async function readCall(provider: Eip1193Provider, to: Address, data: string) {
  return provider.request<string>({ method: "eth_call", params: [{ to, data }, "latest"] });
}

function resultWord(result: string, index: number) {
  const start = 2 + index * 64;
  const word = result.slice(start, start + 64);
  if (word.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(word)) {
    throw new Error("The auction returned incomplete settlement data.");
  }
  return BigInt(`0x${word}`);
}

async function readBidSettlement(provider: Eip1193Provider, bidId: string): Promise<CcaBidSettlement> {
  const result = await readCall(provider, AUCTION, encodeFunctionData({
    abi: auctionAbi,
    functionName: "bids",
    args: [BigInt(bidId)],
  }));
  return {
    startBlock: resultWord(result, 0),
    exited: resultWord(result, 2) !== 0n,
    tokensFilled: resultWord(result, 6),
  };
}

async function partialExitHints(provider: Eip1193Provider, bid: CcaSubmittedBid, startBlock: bigint) {
  const maxPrice = BigInt(bid.maxPriceQ96);
  let blockNumber = startBlock;
  for (let steps = 0; steps < 512; steps += 1) {
    const checkpointResult = await readCall(provider, AUCTION, encodeFunctionData({
      abi: auctionAbi,
      functionName: "checkpoints",
      args: [blockNumber],
    }));
    const clearingPrice = resultWord(checkpointResult, 0);
    const nextBlock = resultWord(checkpointResult, 5);
    if (clearingPrice >= maxPrice || nextBlock === NO_CHECKPOINT) break;
    const nextResult = await readCall(provider, AUCTION, encodeFunctionData({
      abi: auctionAbi,
      functionName: "checkpoints",
      args: [nextBlock],
    }));
    const nextPrice = resultWord(nextResult, 0);
    if (nextPrice >= maxPrice) {
      if (nextPrice > maxPrice) return { lastFullyFilledCheckpointBlock: blockNumber, outbidBlock: nextBlock };
      let outbidBlock = nextBlock;
      for (let equalSteps = steps; equalSteps < 512; equalSteps += 1) {
        const equalResult = await readCall(provider, AUCTION, encodeFunctionData({
          abi: auctionAbi,
          functionName: "checkpoints",
          args: [outbidBlock],
        }));
        const followingBlock = resultWord(equalResult, 5);
        if (followingBlock === NO_CHECKPOINT) return { lastFullyFilledCheckpointBlock: blockNumber, outbidBlock: 0n };
        const followingResult = await readCall(provider, AUCTION, encodeFunctionData({
          abi: auctionAbi,
          functionName: "checkpoints",
          args: [followingBlock],
        }));
        if (resultWord(followingResult, 0) > maxPrice) {
          return { lastFullyFilledCheckpointBlock: blockNumber, outbidBlock: followingBlock };
        }
        outbidBlock = followingBlock;
      }
    }
    blockNumber = nextBlock;
  }
  throw new Error("The final checkpoint is not ready for this partial bid yet. No transaction was sent.");
}

async function fetchAuctionState(owner?: Address | null) {
  const query = owner ? `?owner=${encodeURIComponent(owner)}` : "";
  const response = await fetch(`${playableApiUrl}/cca${query}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Auction API returned ${response.status}.`);
  const state = await response.json() as CcaApiPayload;
  const totalBids = state.totalBids;
  return {
    bidVolume: BigInt(state.bidVolumeWei),
    clearingPriceQ96: BigInt(state.clearingPriceQ96),
    currentBlock: BigInt(state.currentBlock),
    endBlock: BigInt(state.endBlock),
    ethUsdReference: Number.isFinite(state.ethUsdReference) ? Number(state.ethUsdReference) : DEFAULT_ETH_USD,
    finalized: state.finalized === true,
    floorPriceQ96: BigInt(state.floorPriceQ96),
    graduated: state.graduated,
    recentBids: state.recentBids ?? [],
    startBlock: BigInt(state.startBlock),
    totalBids: typeof totalBids === "number" && Number.isSafeInteger(totalBids) && totalBids >= 0 ? totalBids : state.recentBids?.length ?? 0,
    walletBids: state.walletBids ?? [],
  } satisfies AuctionState;
}

async function waitForReceipt(provider: Eip1193Provider, hash: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const receipt = await provider.request<{ status?: string | null } | null>({
      method: "eth_getTransactionReceipt",
      params: [hash],
    });
    if (receipt) {
      if (receipt.status === "0x0") throw new Error("Transaction reverted on Base.");
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
  }
  throw new Error("Transaction submitted but not confirmed yet. Check your wallet before retrying.");
}

async function sendTransaction(provider: Eip1193Provider, from: Address, to: Address, data: string, value?: bigint) {
  const hash = await provider.request<string>({
    method: "eth_sendTransaction",
    params: [{
      from,
      to,
      data,
      ...(value === undefined ? {} : { value: `0x${value.toString(16)}` }),
    }],
  });
  await waitForReceipt(provider, hash);
  return hash;
}

export function CcaApp() {
  const [account, setAccount] = useState<Address | null>(null);
  const [amount, setAmount] = useState("1");
  const [auction, setAuction] = useState<AuctionState>(launchSnapshot);
  const [ethBalance, setEthBalance] = useState<bigint | null>(null);
  const [fundingCurrency, setFundingCurrency] = useState<FundingCurrency>("eth");
  const [maxFdv, setMaxFdv] = useState("109");
  const maxFdvIsAutomatic = useRef(true);
  const [message, setMessage] = useState("Loading live Base auction data.");
  const reviewRef = useRef<HTMLDivElement>(null);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [exitingBidId, setExitingBidId] = useState<string | null>(null);
  const [claimingBidId, setClaimingBidId] = useState<string | null>(null);
  const [bidSettlements, setBidSettlements] = useState<Record<string, CcaBidSettlement>>({});
  const [walletProvider, setWalletProvider] = useState<Eip1193Provider>();
  const [wethBalance, setWethBalance] = useState<bigint | null>(null);

  const refresh = useCallback(async (activeProvider = walletProvider ?? providerFromWindow(), activeAccount = account) => {
    try {
      const nextAuction = await fetchAuctionState(activeAccount);
      setAuction(nextAuction);
      if (activeProvider && activeAccount) {
        const [nativeBalance, wrappedBalance] = await Promise.all([
          activeProvider.request<string>({ method: "eth_getBalance", params: [activeAccount, "latest"] }),
          readCall(activeProvider, WETH, encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [activeAccount] })),
        ]);
        setEthBalance(BigInt(nativeBalance));
        setWethBalance(BigInt(wrappedBalance));
        if (nextAuction.currentBlock >= nextAuction.endBlock) {
          const settlements = await Promise.all(nextAuction.walletBids.map(async (bid) => [
            bid.bidId,
            await readBidSettlement(activeProvider, bid.bidId),
          ] as const));
          setBidSettlements(Object.fromEntries(settlements));
        } else {
          setBidSettlements({});
        }
      }
      setMessage(activeAccount ? "Live Base auction data." : "Live Base auction data. Connect a wallet to bid.");
    } catch {
      setMessage("Live auction data is temporarily unavailable. Wallet actions remain disabled until it reconnects.");
    }
  }, [account, walletProvider]);

  useEffect(() => {
    document.title = "$VEYDRIFT CCA | Bid on Base";
    void refresh();
    const timer = window.setInterval(() => void refresh(), 12_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!walletProvider) return;
    const handleAccountsChanged = (...args: unknown[]) => {
      const [nextAccount] = Array.isArray(args[0]) ? args[0] as string[] : [];
      setReviewing(false);
      setEthBalance(null);
      setWethBalance(null);
      if (!nextAccount) {
        setAccount(null);
        setMessage("Wallet disconnected. Connect a wallet to see your confirmed bids and place a new one.");
        return;
      }
      const normalized = nextAccount as Address;
      setAccount(normalized);
      void refresh(walletProvider, normalized);
    };

    walletProvider.on?.("accountsChanged", handleAccountsChanged);
    return () => walletProvider.removeListener?.("accountsChanged", handleAccountsChanged);
  }, [refresh, walletProvider]);

  useEffect(() => {
    if (reviewing) revealCcaBidReview(reviewRef.current);
  }, [reviewing]);

  const connect = useCallback(async () => {
    await signalFarcasterReadyOnce();
    const available = await getAvailableWalletProviderDetails(
      window as typeof window & { ethereum?: Eip1193Provider },
      undefined,
      { preferFarcasterProvider: true },
    );
    const provider = available?.provider;
    if (!provider) {
      setMessage("No Base wallet found. Open this page in a wallet browser or a Farcaster Mini App host with wallet support.");
      return;
    }
    try {
      await ensureBaseMainnetNetwork(provider);
      const [connected] = await requestAccounts(provider);
      const normalized = connected as Address;
      setWalletProvider(provider);
      setAccount(normalized);
      await refresh(provider, normalized);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet connection was not completed.");
    }
  }, [refresh]);

  const floorFdv = useMemo(() => fdvFromQ96(auction.floorPriceQ96), [auction.floorPriceQ96]);
  const clearingFdv = useMemo(() => fdvFromQ96(auction.clearingPriceQ96 || auction.floorPriceQ96), [auction.clearingPriceQ96, auction.floorPriceQ96]);
  const minimumBidFdv = useMemo(
    () => Math.max(
      Math.ceil(floorFdv),
      Number((minimumFdvWeiAboveClearingPriceQ96(auction.clearingPriceQ96) + E18 - 1n) / E18),
    ),
    [auction.clearingPriceQ96, floorFdv],
  );
  useEffect(() => {
    if (maxFdvIsAutomatic.current) setMaxFdv(String(minimumBidFdv));
  }, [minimumBidFdv]);
  const sliderMaxFdv = useMemo(() => Math.max(minimumBidFdv, Math.ceil(floorFdv * 25), 2_700), [floorFdv, minimumBidFdv]);
  const maxPriceQ96 = useMemo(() => {
    try {
      return fdvToPriceQ96(maxFdv || "0");
    } catch {
      return 0n;
    }
  }, [maxFdv]);
  const amountWei = useMemo(() => {
    try {
      return parseEther(amount || "0");
    } catch {
      return 0n;
    }
  }, [amount]);
  const priceError = ccaBidPriceError(maxPriceQ96, auction.clearingPriceQ96);
  const maxPrice = priceFromQ96(maxPriceQ96 || auction.floorPriceQ96);
  const estimatedReceive = maxPriceQ96 > 0n ? (amountWei * Q96) / maxPriceQ96 : 0n;
  const activeBalance = fundingCurrency === "eth" ? ethBalance : wethBalance;
  const spendableBalance = useMemo(() => {
    if (activeBalance === null) return null;
    return fundingCurrency === "eth" ? availableEthForBid(activeBalance) : activeBalance;
  }, [activeBalance, fundingCurrency]);
  const fundingError = useMemo(() => {
    if (!account || amountWei === 0n) return null;
    if (spendableBalance === null) return "Checking your wallet balance before a bid can be submitted.";
    if (amountWei <= spendableBalance) return null;
    const shortfall = amountWei - spendableBalance;
    if (fundingCurrency === "weth") {
      return `Insufficient WETH. Wrap at least ${formatCompactWeth(shortfall)} ETH first, or lower your WETH budget.`;
    }
    return `Insufficient ETH after reserving gas. Lower the budget by at least ${formatCompactWeth(shortfall)} ETH.`;
  }, [account, amountWei, fundingCurrency, spendableBalance]);
  const stateLabel = auction.currentBlock < auction.startBlock
    ? "Scheduled"
    : auction.currentBlock >= auction.endBlock
      ? "Ended"
      : auction.graduated
        ? "Graduated"
        : "Live";
  const currentFdv = clearingFdv;
  const walletBids = auction.walletBids;
  const auctionComplete = auction.currentBlock >= auction.endBlock;
  const auctionFinalized = auctionComplete && auction.finalized;

  const setBalanceFraction = useCallback((percent: number) => {
    if (activeBalance === null) return;
    const reservedGas = fundingCurrency === "eth" ? activeBalance / 100n : 0n;
    const spendable = activeBalance > reservedGas ? activeBalance - reservedGas : 0n;
    setAmount(formatEther((spendable * BigInt(percent)) / 100n));
  }, [activeBalance, fundingCurrency]);

  const openReview = useCallback(async () => {
    if (!account) {
      await connect();
      return;
    }
    if (amountWei === 0n || maxPriceQ96 === 0n || priceError || fundingError) {
      setMessage(priceError ?? fundingError ?? "Enter a valid budget and maximum FDV before reviewing your bid.");
      return;
    }
    if (auction.currentBlock >= auction.endBlock) {
      setMessage("The auction has ended. Bids are no longer accepted.");
      return;
    }
    setReviewing(true);
    setMessage("Review ready below — scroll down to confirm your bid.");
  }, [account, amountWei, auction.currentBlock, auction.endBlock, connect, fundingError, maxPriceQ96, priceError]);

  const exitBid = useCallback(async (bid: CcaSubmittedBid) => {
    const provider = walletProvider ?? providerFromWindow();
    if (!provider || !account) {
      setMessage("Connect the wallet that owns this bid before requesting a refund.");
      return;
    }
    if (!auction.finalized) {
      setMessage("The auction is still finalizing on Base. No settlement transaction was sent.");
      return;
    }
    setExitingBidId(bid.bidId);
    try {
      await ensureBaseMainnetNetwork(provider);
      setMessage(`Requesting Uniswap exit/refund for bid #${bid.bidId} in your wallet.`);
      const settlement = bidSettlements[bid.bidId] ?? await readBidSettlement(provider, bid.bidId);
      const hash = canFullyExitBid(auction, bid)
        ? await sendTransaction(provider, account, AUCTION, encodeFunctionData({
          abi: auctionAbi,
          functionName: "exitBid",
          args: [BigInt(bid.bidId)],
        }))
        : await (async () => {
          const hints = await partialExitHints(provider, bid, settlement.startBlock);
          return sendTransaction(provider, account, AUCTION, encodeFunctionData({
            abi: auctionAbi,
            functionName: "exitPartiallyFilledBid",
            args: [BigInt(bid.bidId), hints.lastFullyFilledCheckpointBlock, hints.outbidBlock],
          }));
        })();
      setMessage(`Exit/refund confirmed: ${shortAddress(hash)}.`);
      await refresh(provider, account);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Uniswap exit/refund was not completed.");
    } finally {
      setExitingBidId(null);
    }
  }, [account, auction, bidSettlements, refresh, walletProvider]);

  const claimBid = useCallback(async (bid: CcaSubmittedBid) => {
    const provider = walletProvider ?? providerFromWindow();
    if (!provider || !account) {
      setMessage("Connect the wallet that owns this bid before claiming VEY.");
      return;
    }
    const settlement = bidSettlements[bid.bidId];
    if (!auction.finalized || !auction.graduated || !settlement?.exited || settlement.tokensFilled === 0n) {
      setMessage("This bid is not ready to claim VEY yet. Exit/refund it first once the final auction result is available.");
      return;
    }
    setClaimingBidId(bid.bidId);
    try {
      await ensureBaseMainnetNetwork(provider);
      setMessage(`Claiming VEY for bid #${bid.bidId} in your wallet.`);
      const hash = await sendTransaction(provider, account, AUCTION, encodeFunctionData({
        abi: auctionAbi,
        functionName: "claimTokens",
        args: [BigInt(bid.bidId)],
      }));
      setMessage(`VEY claimed: ${shortAddress(hash)}.`);
      await refresh(provider, account);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "VEY claim was not completed.");
    } finally {
      setClaimingBidId(null);
    }
  }, [account, auction.finalized, auction.graduated, bidSettlements, refresh, walletProvider]);

  const bid = useCallback(async () => {
    const provider = walletProvider ?? providerFromWindow();
    if (!provider || !account) {
      setMessage("Connect a Base wallet before placing a bid.");
      return;
    }
    if (amountWei === 0n || amountWei > (1n << 128n) - 1n || maxPriceQ96 === 0n || priceError) {
      setMessage(priceError ?? "The entered budget or maximum FDV is invalid.");
      return;
    }
    setSubmitting(true);
    try {
      await ensureBaseMainnetNetwork(provider);
      const revalidateAuction = async (notSentCopy: string) => {
        await ensureBaseMainnetNetwork(provider);
        const liveBoundary = await readCcaAuctionBoundary(provider, AUCTION);
        setAuction((current) => ({
          ...current,
          clearingPriceQ96: liveBoundary.clearingPriceQ96,
          currentBlock: liveBoundary.currentBlock,
          endBlock: liveBoundary.endBlock,
        }));
        const livePriceError = ccaBidPriceError(maxPriceQ96, liveBoundary.clearingPriceQ96);
        if (livePriceError) throw new Error(`${livePriceError} ${notSentCopy}`);
        if (liveBoundary.currentBlock >= liveBoundary.endBlock) {
          throw new Error(`The auction has ended. ${notSentCopy}`);
        }
      };

      // Keep the early check for fast feedback before any wallet confirmation.
      await revalidateAuction("No wallet transaction was sent.");
      const [latestNativeBalance, latestWethBalance] = await Promise.all([
        provider.request<string>({ method: "eth_getBalance", params: [account, "latest"] }),
        readCall(provider, WETH, encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [account] })),
      ]);
      const walletBalance = fundingCurrency === "eth"
        ? availableEthForBid(BigInt(latestNativeBalance))
        : BigInt(latestWethBalance);
      if (amountWei > walletBalance) {
        const shortfall = amountWei - walletBalance;
        throw new Error(fundingCurrency === "eth"
          ? `Insufficient ETH after reserving gas. Lower the budget by at least ${formatCompactWeth(shortfall)} ETH.`
          : `Insufficient WETH. Wrap at least ${formatCompactWeth(shortfall)} ETH first, or lower your WETH budget.`);
      }
      const hash = await executeCcaBidSequence({
        fundingCurrency,
        wrapEth: async () => {
          setMessage("Step 1 of 4: wrap ETH to WETH in your wallet.");
          await sendTransaction(provider, account, WETH, encodeFunctionData({ abi: wethAbi, functionName: "deposit" }), amountWei);
        },
        approveWeth: async () => {
          setMessage(`Step ${fundingCurrency === "eth" ? "2" : "1"} of ${fundingCurrency === "eth" ? "4" : "3"}: approve Permit2 for this exact WETH amount.`);
          await sendTransaction(provider, account, WETH, encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [PERMIT2, amountWei],
          }));
        },
        approvePermit2: async () => {
          setMessage(`Step ${fundingCurrency === "eth" ? "3" : "2"} of ${fundingCurrency === "eth" ? "4" : "3"}: allow Permit2 to pay the official auction.`);
          await sendTransaction(provider, account, PERMIT2, encodeFunctionData({
            abi: permit2Abi,
            functionName: "approve",
            args: [WETH, AUCTION, amountWei, Math.floor(Date.now() / 1_000) + 60 * 60 * 24 * 30],
          }));
        },
        revalidateAuction: async () => {
          await revalidateAuction("The final bid transaction was not sent.");
        },
        submitBid: async () => {
          setMessage(`Step ${fundingCurrency === "eth" ? "4" : "3"} of ${fundingCurrency === "eth" ? "4" : "3"}: submit your WETH bid to the official CCA contract.`);
          return sendTransaction(provider, account, AUCTION, encodeFunctionData({
            abi: auctionAbi,
            functionName: "submitBid",
            args: [maxPriceQ96, amountWei, account, "0x"],
          }));
        },
      });
      setReviewing(false);
      setMessage(`Bid confirmed: ${shortAddress(hash)}. It remains subject to the auction clearing price and finalization rules.`);
      await refresh(provider, account);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bid was not completed. No later transaction was sent.");
    } finally {
      setSubmitting(false);
    }
  }, [account, amountWei, fundingCurrency, maxPriceQ96, priceError, refresh, walletProvider]);

  return (
    <main className="cca-shell">
      <header className="cca-topbar">
        <a className="cca-brand" href="https://veydrift.com/">VEYDRIFT<span>CCA</span></a>
        <nav className="cca-nav" aria-label="Auction navigation">
          <a href="https://veydrift.com/">Play Veydrift</a>
          <a href="#how-it-works">How it works</a>
          <a href={UNISWAP_AUCTION_URL} target="_blank" rel="noreferrer">View on Uniswap ↗</a>
        </nav>
        <button className="cca-connect" type="button" onClick={() => void connect()}>{account ? shortAddress(account) : "Connect wallet"}</button>
      </header>

      <section className="cca-hero">
        <div>
          <p className="cca-eyebrow">BASE CONTINUOUS CLEARING AUCTION</p>
          <h1>Bid on <span>$VEYDRIFT.</span></h1>
          <p className="cca-subhead">Set a maximum fully diluted value, bid with WETH, or wrap ETH directly in your wallet. Your bid always goes to the official Uniswap CCA.</p>
        </div>
        <div className="cca-live-chip"><i /> {stateLabel} on Base</div>
      </section>

      <section className="cca-grid">
        <article className="cca-market-card">
          <div className="cca-card-heading"><span>$VEYDRIFT</span><span className="cca-chain">Base</span></div>
          <div className="cca-price">{formatCompactWeth(BigInt(Math.round(currentFdv)) * E18)}<small> WETH FDV</small></div>
          <p className="cca-muted">{formatUsd(currentFdv * auction.ethUsdReference)} · {priceFromQ96(auction.clearingPriceQ96 || auction.floorPriceQ96)} WETH per VEY</p>
          <div className="cca-metrics">
            <div><span>Bid volume</span><strong>{formatCompactWeth(auction.bidVolume)} WETH</strong></div>
            <div><span>Graduation threshold</span><strong>27 WETH</strong></div>
            <div><span>Auction supply</span><strong>250M VEY</strong></div>
            <div><span>Ends at block</span><strong>{auction.endBlock.toLocaleString()}</strong></div>
          </div>
          <a className="cca-official-link" href={UNISWAP_AUCTION_URL} target="_blank" rel="noreferrer">Inspect the official Uniswap auction ↗</a>
        </article>

        <article className="cca-bid-card">
          <div className="cca-card-heading"><span>Place a bid</span><span className="cca-status">{stateLabel}</span></div>
          <p className="cca-explainer">Your budget is the most WETH this order can use. Your maximum FDV is the highest valuation you accept; it is a price ceiling, not an instant market purchase.</p>
          <div className="cca-tabs" role="tablist" aria-label="Bid funding currency">
            <button className={fundingCurrency === "eth" ? "active" : ""} type="button" onClick={() => setFundingCurrency("eth")}>Use ETH</button>
            <button className={fundingCurrency === "weth" ? "active" : ""} type="button" onClick={() => setFundingCurrency("weth")}>Use WETH</button>
          </div>
          <label className="cca-input-label" htmlFor="cca-amount">Max budget</label>
          <div className="cca-input-wrap"><input id="cca-amount" inputMode="decimal" value={amount} onInput={(event) => setAmount((event.currentTarget as HTMLInputElement).value)} /><strong>{fundingCurrency.toUpperCase()}</strong></div>
          <div className="cca-budget-actions" aria-label="Set bid budget">
            {[25, 50, 75, 100].map((percent) => <button key={percent} type="button" disabled={activeBalance === null} onClick={() => setBalanceFraction(percent)}>{percent === 100 ? "MAX" : `${percent}%`}</button>)}
          </div>
          {account && <p className="cca-balance">Available {fundingCurrency.toUpperCase()}: {activeBalance === null ? "…" : formatCompactWeth(activeBalance)}{fundingCurrency === "eth" ? " (1% reserved for gas)" : ""}</p>}
          {fundingError && <p className="cca-error" role="alert">{fundingError}</p>}

          <div className="cca-fdv-heading"><label className="cca-input-label" htmlFor="cca-max-fdv">Max FDV</label><span>{formatUsd(Number(maxFdv || "0") * auction.ethUsdReference)}</span></div>
          <div className="cca-input-wrap"><input id="cca-max-fdv" inputMode="decimal" value={maxFdv} onInput={(event) => { maxFdvIsAutomatic.current = false; setMaxFdv((event.currentTarget as HTMLInputElement).value); }} /><strong>WETH</strong></div>
          <input className="cca-slider" type="range" min={minimumBidFdv} max={sliderMaxFdv} step="1" value={Math.min(Math.max(Number(maxFdv) || minimumBidFdv, minimumBidFdv), sliderMaxFdv)} onInput={(event) => { maxFdvIsAutomatic.current = false; setMaxFdv((event.currentTarget as HTMLInputElement).value); }} aria-label="Maximum fully diluted value" />
          {priceError ? <p className="cca-error">{priceError}</p> : <p className="cca-balance">Max price: {maxPrice} WETH / VEY · USD is indicative only.</p>}

          <div className="cca-receive"><span>Estimated receive at your max price</span><strong>{formatVey(estimatedReceive)} VEY</strong></div>
          <div className="cca-bid-guidance">
            <strong>How this estimate can change</strong>
            <p>Your order is split across auction blocks. This estimate assumes your whole budget fills at your selected maximum FDV. If a block clears below your ceiling, each executed WETH buys more VEY.</p>
            <p>You can receive fewer VEY than this estimate when only part of your budget fills (a partial fill), or when a block clears above your maximum FDV and that order slice does not execute.</p>
            <p className="cca-ai-note">Choosing an FDV? Give an AI agent <a href="https://cca.uniswap.org/" target="_blank" rel="noreferrer">Uniswap’s CCA reference ↗</a> with your budget and risk tolerance. It cannot predict the final clearing price and is not investment advice.</p>
          </div>
          <button className="cca-submit" type="button" disabled={submitting || stateLabel === "Ended" || Boolean(account && (fundingError || priceError))} onClick={() => void openReview()}>{submitting ? "Confirm in wallet…" : account && priceError ? "Raise max FDV" : account && fundingError ? fundingCurrency === "weth" ? "Wrap ETH or lower budget" : "Lower ETH budget" : account ? "Review bid" : "Connect wallet to bid"}</button>
          <p className="cca-notice">{fundingCurrency === "eth" ? "ETH is wrapped into WETH before the bid (four wallet confirmations)." : "WETH bidding requires three wallet confirmations."} This page never receives custody.</p>
          <p className="cca-message" role="status">{message}</p>

          {reviewing && <div ref={reviewRef} className="cca-review" role="dialog" aria-labelledby="cca-review-title" tabIndex={-1}>
            <strong id="cca-review-title">Review bid</strong>
            <p>Submit up to <b>{amount || "0"} {fundingCurrency.toUpperCase()}</b> at a maximum <b>{maxFdv || "0"} WETH FDV</b> ({maxPrice} WETH / VEY).</p>
            <p>{fundingCurrency === "eth" ? "ETH will be wrapped to WETH, then approved through Permit2." : "WETH will be approved through Permit2."} The final transaction calls Uniswap’s official auction contract.</p>
            <div><button type="button" onClick={() => setReviewing(false)}>Back</button><button type="button" disabled={submitting || Boolean(priceError)} onClick={() => void bid()}>Confirm bid</button></div>
          </div>}
        </article>
      </section>

      {auctionComplete && <section className={`cca-completion ${!auctionFinalized ? "is-pending" : auction.graduated ? "is-success" : "is-failed"}`} aria-labelledby="cca-completion-heading">
        <div>
          <p className="cca-eyebrow">AUCTION COMPLETE</p>
          <h2 id="cca-completion-heading">{!auctionFinalized ? "Finalizing auction on Base" : auction.graduated ? "VEY is ready to settle" : "Auction did not reach its launch threshold"}</h2>
          <p>{!auctionFinalized
            ? "The auction has ended. Settlement actions unlock as soon as the final Base checkpoint is recorded."
            : auction.graduated
            ? "Exit each bid to receive any unused WETH, then claim its VEY allocation. Both actions are sent directly from your wallet."
            : "No VEY was allocated. Exit each confirmed bid to return its WETH to the bid owner."}</p>
        </div>
        <dl>
          <div><dt>Final clearing FDV</dt><dd>{formatCompactWeth(BigInt(Math.round(currentFdv)) * E18)} WETH</dd></div>
          <div><dt>Confirmed bid volume</dt><dd>{formatCompactWeth(auction.bidVolume)} WETH</dd></div>
          <div><dt>End block</dt><dd>{auction.endBlock.toLocaleString()}</dd></div>
        </dl>
      </section>}

      <section className="cca-live-bids" aria-labelledby="cca-live-bids-heading">
        <div className="cca-live-bids-heading"><div><p className="cca-eyebrow">CONFIRMED ON BASE</p><h2 id="cca-live-bids-heading">Live bids</h2></div><span>{auction.recentBids.length ? `${auction.recentBids.length} recent · ${auction.totalBids} total` : "0 total"}</span></div>
        {auction.recentBids.length === 0 ? <p className="cca-live-bids-empty">No confirmed bids yet. Reverted wallet transactions are never shown here.</p> : <ol className="cca-live-bids-list">
          {auction.recentBids.map((bid) => <li key={`${bid.transactionHash}-${bid.bidId}`}>
            <div><strong>{formatCompactWeth(BigInt(bid.amountWei))} WETH</strong><span>max {formatCompactWeth(BigInt(Math.round(fdvFromQ96(BigInt(bid.maxPriceQ96)))) * E18)} WETH FDV</span></div>
            <div><span>{shortAddress(bid.owner)} · block {BigInt(bid.blockNumber).toLocaleString()}</span><a href={`https://basescan.org/tx/${bid.transactionHash}`} target="_blank" rel="noreferrer">View tx ↗</a></div>
          </li>)}
        </ol>}
      </section>

      <section className="cca-live-bids cca-wallet-bids" aria-labelledby="cca-wallet-bids-heading">
        <div className="cca-live-bids-heading">
          <div><p className="cca-eyebrow">YOUR WALLET</p><h2 id="cca-wallet-bids-heading">Your confirmed bids</h2></div>
          <span>{account ? `${walletBids.length} confirmed` : "Wallet not connected"}</span>
        </div>
        {!account ? <div className="cca-wallet-bids-prompt">
          <p>Connect a wallet to see its confirmed CCA bids.</p>
          <button type="button" onClick={() => void connect()}>Connect wallet</button>
        </div> : walletBids.length === 0 ? <p className="cca-live-bids-empty">No confirmed bids from {shortAddress(account)} yet. Reverted transactions are not included.</p> : <ol className="cca-live-bids-list">
          {walletBids.map((bid) => {
            const settlement = bidSettlements[bid.bidId];
            const needsClaim = auctionFinalized && auction.graduated && settlement?.exited && settlement.tokensFilled > 0n;
            return <li key={`${bid.transactionHash}-${bid.bidId}`}>
              <div><strong>{formatCompactWeth(BigInt(bid.amountWei))} WETH</strong><span>max {formatCompactWeth(BigInt(Math.round(fdvFromQ96(BigInt(bid.maxPriceQ96)))) * E18)} WETH FDV</span></div>
              <div><span>block {BigInt(bid.blockNumber).toLocaleString()}</span><a href={`https://basescan.org/tx/${bid.transactionHash}`} target="_blank" rel="noreferrer">View tx ↗</a>{auctionFinalized && !settlement?.exited ? <button className="cca-settlement-action" type="button" disabled={exitingBidId === bid.bidId} onClick={() => void exitBid(bid)}>{exitingBidId === bid.bidId ? "Confirm in wallet…" : auction.graduated && !canFullyExitBid(auction, bid) ? "Settle partial bid" : "Exit & refund"}</button> : needsClaim ? <button className="cca-settlement-action" type="button" disabled={claimingBidId === bid.bidId} onClick={() => void claimBid(bid)}>{claimingBidId === bid.bidId ? "Confirm in wallet…" : "Claim VEY"}</button> : auctionFinalized && settlement?.exited ? <span>{auction.graduated ? "VEY claimed or no VEY filled" : "WETH refunded"}</span> : null}</div>
            </li>;
          })}
        </ol>}
        <p className="cca-wallet-bids-source">Sourced from every confirmed <code>BidSubmitted</code> event for this wallet; updates automatically. Reverted wallet transactions are excluded. Settlement actions stay hidden until the auction ends.</p>
      </section>

      <section className="cca-how" id="how-it-works">
        <span>01</span><div><h2>Set your FDV limit</h2><p>Choose the highest fully diluted value you accept. The slider derives your exact WETH-per-VEY limit.</p></div>
        <span>02</span><div><h2>Bid in WETH</h2><p>Use existing WETH or wrap ETH in your wallet. This interface submits only to Uniswap’s official CCA.</p></div>
        <span>03</span><div><h2>Play Veydrift</h2><p>Explore the on-chain strategy game while the auction clears. <a href="https://veydrift.com/">Open veydrift.com ↗</a></p></div>
      </section>
    </main>
  );
}
