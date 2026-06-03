import { describe, expect, test } from "bun:test";
import {
  accountAssociationDomain,
  assertAccountAssociationDomain,
  buildMiniAppEmbed,
  buildMiniAppManifest,
  productionAccountAssociation,
  productionMiniAppSurface,
  testAccountAssociation,
  testMiniAppSurface,
} from "../miniAppMetadata";

describe("Farcaster Mini App metadata", () => {
  test("keeps production manifest associated with veydrift.com", () => {
    const manifest = buildMiniAppManifest(productionMiniAppSurface, productionAccountAssociation);

    expect(accountAssociationDomain(manifest.accountAssociation)).toBe("veydrift.com");
    expect(manifest.miniapp.homeUrl).toBe("https://veydrift.com/?miniApp=true");
    expect(manifest.frame).toEqual(manifest.miniapp);
    expect(manifest.miniapp.canonicalDomain).toBe("veydrift.com");
    expect(manifest.miniapp.requiredChains).toEqual(["eip155:8453"]);
    expect(manifest.miniapp.noindex).toBe(false);
  });

  test("builds test manifest with test.veydrift.com URLs and canonical domain", () => {
    const manifest = buildMiniAppManifest(testMiniAppSurface, testAccountAssociation);

    expect(accountAssociationDomain(manifest.accountAssociation)).toBe("test.veydrift.com");
    expect(manifest.miniapp.homeUrl).toBe("https://test.veydrift.com/?miniApp=true");
    expect(manifest.miniapp.iconUrl).toBe("https://test.veydrift.com/assets/miniapp/icon.png");
    expect("imageUrl" in manifest.miniapp).toBe(false);
    expect("buttonTitle" in manifest.miniapp).toBe(false);
    expect(manifest.frame).toEqual(manifest.miniapp);
    expect("imageUrl" in manifest.frame).toBe(false);
    expect("buttonTitle" in manifest.frame).toBe(false);
    expect(manifest.miniapp.canonicalDomain).toBe("test.veydrift.com");
    expect(manifest.miniapp.requiredChains).toEqual(["eip155:84532"]);
    expect(manifest.miniapp.requiredCapabilities).toEqual([
      "actions.ready",
      "wallet.getEthereumProvider",
    ]);
    expect(manifest.miniapp.noindex).toBe(true);
  });

  test("rejects a signed association for the wrong domain", () => {
    expect(() => assertAccountAssociationDomain(productionAccountAssociation, "test.veydrift.com"))
      .toThrow("must be test.veydrift.com");
  });

  test("builds share embed metadata for root Mini App launch", () => {
    const embed = buildMiniAppEmbed(testMiniAppSurface);

    expect(embed).toEqual({
      version: "1",
      imageUrl: "https://test.veydrift.com/assets/miniapp/embed.png",
      aspectRatio: "3:2",
      button: {
        title: "Join the testers",
        action: {
          type: "launch_miniapp",
          name: "Veydrift",
          url: "https://test.veydrift.com/?miniApp=true",
          splashImageUrl: "https://test.veydrift.com/assets/miniapp/splash.png",
          splashBackgroundColor: "#05070d",
        },
      },
    });
  });
});
