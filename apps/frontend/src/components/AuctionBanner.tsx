import { ArrowRight } from "lucide-preact";
import { auctionEndsAt, auctionStartsAt, auctionUrl } from "../auction";

/** Strip above every page that sends visitors to the $VEYDRIFT auction on Uniswap until it ends. */
export function AuctionBanner({ now = Date.now() }: { now?: number }) {
  if (now >= auctionEndsAt) return null;
  const live = now >= auctionStartsAt;
  return (
    <a
      className="auction-banner relative z-40 flex min-h-10 flex-wrap items-center justify-center gap-x-3 gap-y-0.5 bg-cyan-300 px-4 py-2 text-center text-sm font-medium text-slate-950 transition hover:bg-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-slate-950 md:h-10 md:flex-nowrap md:py-0"
      href={auctionUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      <span>
        {live
          ? "The $VEYDRIFT auction is live on Uniswap until November 5."
          : "The $VEYDRIFT auction opens on Uniswap on October 22 at 1 PM Pacific."}
      </span>
      <span className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
        {live ? "Place a bid" : "See the auction"}
        <ArrowRight aria-hidden="true" className="h-4 w-4" />
      </span>
    </a>
  );
}
