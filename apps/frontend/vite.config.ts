import preact from "@preact/preset-vite";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { MINIAPP_ICON_ALIAS_PATHS, MINIAPP_ICON_PATH } from "./iconAliases.mjs";
import {
  assertAccountAssociationDomain,
  buildMiniAppEmbed,
  buildMiniAppManifest,
  miniAppSurfaceForMode,
  productionAccountAssociation,
  testAccountAssociation,
  type AccountAssociation,
  type HtmlEnv,
  type MiniAppSurface,
} from "./miniAppMetadata";

export default defineConfig(({ mode }) => {
  const isTestSurface = mode === "playable" || mode === "settlement";
  const htmlEnv = miniAppSurfaceForMode(mode);
  const surface = mode === "playable" || mode === "settlement" ? mode : "";

  return {
    build: {
      rollupOptions: {
        output: {
          entryFileNames: isTestSurface
            ? "assets/[name]-settlement-[hash].js"
            : "assets/[name]-[hash].js",
        },
      },
    },
    define: {
      "import.meta.env.VITE_VEYDRIFT_SURFACE": JSON.stringify(surface),
    },
    plugins: [
      preact(),
      htmlEnvDefaults(htmlEnv),
      farcasterManifest(mode, htmlEnv),
      miniAppIconAliases(),
    ],
  };
});

function htmlEnvDefaults(env: MiniAppSurface): Plugin {
  const miniAppEmbed = JSON.stringify(buildMiniAppEmbed(env, "launch_miniapp"));
  const frameEmbed = JSON.stringify(buildMiniAppEmbed(env, "launch_frame"));
  const replacements: HtmlEnv & {
    MINIAPP_EMBED: string;
    FRAME_EMBED: string;
  } = {
    PUBLIC_SITE_URL: env.PUBLIC_SITE_URL,
    ROBOTS: env.ROBOTS,
    SITE_TITLE: env.SITE_TITLE,
    SITE_DESCRIPTION: env.SITE_DESCRIPTION,
    SOCIAL_IMAGE: env.SOCIAL_IMAGE,
    MINIAPP_IMAGE: env.MINIAPP_IMAGE,
    MINIAPP_SPLASH: env.MINIAPP_SPLASH,
    MINIAPP_LAUNCH_URL: env.MINIAPP_LAUNCH_URL,
    MINIAPP_EMBED: miniAppEmbed,
    FRAME_EMBED: frameEmbed,
  };

  return {
    name: "veydrift-html-env-defaults",
    transformIndexHtml(html) {
      return Object.entries(replacements).reduce(
        (nextHtml, [key, value]) => nextHtml.replaceAll(`__${key}__`, value),
        html,
      );
    },
  };
}

function farcasterManifest(mode: string, surface: MiniAppSurface): Plugin {
  return {
    name: "veydrift-farcaster-manifest",
    closeBundle() {
      const accountAssociation = accountAssociationForMode(mode);
      assertAccountAssociationDomain(accountAssociation, surface.domain);

      const wellKnownDir = join("dist", ".well-known");
      mkdirSync(wellKnownDir, { recursive: true });
      writeFileSync(
        join(wellKnownDir, "farcaster.json"),
        `${JSON.stringify(buildMiniAppManifest(surface, accountAssociation), null, 2)}\n`,
      );
    },
  };
}

function miniAppIconAliases(): Plugin {
  return {
    name: "veydrift-miniapp-icon-aliases",
    closeBundle() {
      const source = join("dist", MINIAPP_ICON_PATH.slice(1));

      for (const alias of MINIAPP_ICON_ALIAS_PATHS) {
        const destination = join("dist", alias.slice(1));
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(source, destination);
      }
    },
  };
}

function accountAssociationForMode(mode: string): AccountAssociation {
  if (mode !== "playable" && mode !== "settlement") {
    return productionAccountAssociation;
  }

  const fromJson = process.env.VEYDRIFT_TEST_FARCASTER_ACCOUNT_ASSOCIATION;
  if (fromJson) {
    return JSON.parse(fromJson) as AccountAssociation;
  }

  const header = process.env.VEYDRIFT_TEST_FARCASTER_ACCOUNT_ASSOCIATION_HEADER;
  const payload = process.env.VEYDRIFT_TEST_FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD;
  const signature = process.env.VEYDRIFT_TEST_FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE;

  if (header && payload && signature) {
    return { header, payload, signature };
  }

  return testAccountAssociation;
}
