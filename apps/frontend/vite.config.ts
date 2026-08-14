import preact from "@preact/preset-vite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
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

// Local-dev CORS bypass: the Veydrift APIs only allow the veydrift.com
// origins, so localhost fetches go through the dev server instead. Point
// VITE_VEYDRIFT_API_URL at /prod-api or /test-api (see .env.development)
// and the dev server forwards the requests server-side, where CORS does
// not apply. Production builds never use these paths.
const devApiProxy = {
  "/prod-api": {
    target: "https://api.veydrift.com",
    changeOrigin: true,
    headers: { origin: "https://veydrift.com" },
    rewrite: (path: string) => path.replace(/^\/prod-api/, ""),
  },
  "/test-api": {
    target: "https://api-test.veydrift.com",
    changeOrigin: true,
    headers: { origin: "https://test.veydrift.com" },
    rewrite: (path: string) => path.replace(/^\/test-api/, ""),
  },
};

export default defineConfig(({ mode }) => {
  const isTestSurface = mode === "playable" || mode === "settlement";
  const htmlEnv = miniAppSurfaceForMode(mode);
  const surface = mode === "playable" || mode === "settlement"
    ? mode
    : process.env.VITE_VEYDRIFT_SURFACE ?? "";

  return {
    preview: {
      proxy: devApiProxy,
    },
    server: {
      proxy: devApiProxy,
    },
    build: {
      rollupOptions: {
        output: {
          entryFileNames: isTestSurface
            ? "assets/[name]-settlement-[hash].js"
            : "assets/[name]-[hash].js",
          manualChunks(id) {
            // Reown is only imported after a regular-browser player explicitly
            // opens Connect. Keep it out of the initial bundle, especially the
            // Farcaster Mini App surface where this connector is disabled.
            if (id.includes("/node_modules/@reown/") || id.includes("/node_modules/@walletconnect/")) {
              return "reown-wallet";
            }
            return undefined;
          },
        },
      },
    },
    define: {
      "import.meta.env.VITE_VEYDRIFT_SURFACE": JSON.stringify(surface),
    },
    plugins: [
      preact(),
      htmlEnvDefaults(htmlEnv),
      docsMarkdownAsset(),
      farcasterManifest(mode, htmlEnv),
    ],
  };
});

const docsMarkdownUrl = new URL("./src/docs/content/docs.md", import.meta.url);

function docsMarkdownAsset(): Plugin {
  return {
    name: "veydrift-docs-markdown-asset",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url ? new URL(request.url, "http://localhost").pathname : "";
        if (pathname !== "/docs.md") {
          next();
          return;
        }

        response.statusCode = 200;
        response.setHeader("content-type", "text/markdown; charset=utf-8");
        response.end(readFileSync(docsMarkdownUrl));
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "docs.md",
        source: readFileSync(docsMarkdownUrl, "utf8"),
      });
    },
  };
}

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
