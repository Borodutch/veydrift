import { expect, test } from "bun:test";
import { auctionEndsAt, auctionStartsAt, auctionUrl } from "./auction";
import { AuctionBanner } from "./components/AuctionBanner";

const text = (node: any): string => node == null || typeof node === "boolean" ? ""
  : typeof node !== "object" ? String(node)
  : Array.isArray(node) ? node.map(text).join(" ")
  : text(node.props?.children);

test("the banner links to the auction, says when it opens, then that it is live, and disappears once it ends", () => {
  const upcoming = AuctionBanner({ now: auctionStartsAt - 1 });
  expect(upcoming?.props.href).toBe(auctionUrl);
  expect(text(upcoming)).toContain("opens on Uniswap on October 22 at 1 PM Pacific");
  expect(text(AuctionBanner({ now: auctionStartsAt }))).toContain("is live on Uniswap until November 5");
  expect(AuctionBanner({ now: auctionEndsAt })).toBeNull();
});
