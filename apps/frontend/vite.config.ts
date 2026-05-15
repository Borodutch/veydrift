import preact from "@preact/preset-vite";
import { defineConfig, type Plugin } from "vite";

type HtmlEnv = Record<string, string>;

const baseHtmlEnv = {
  PUBLIC_SITE_URL: "https://veydrift.com",
  ROBOTS: "index,follow",
  SITE_TITLE: "Veydrift",
  SITE_DESCRIPTION: "Veydrift is a new onchain space project. More details are coming soon.",
  SOCIAL_IMAGE: "https://veydrift.com/assets/og-image.jpg",
  MINIAPP_IMAGE: "https://veydrift.com/assets/miniapp/embed.png",
  MINIAPP_SPLASH: "https://veydrift.com/assets/miniapp/splash.png",
} satisfies HtmlEnv;

const playableHtmlEnv = {
  PUBLIC_SITE_URL: "https://test.veydrift.com",
  ROBOTS: "noindex,nofollow",
  SITE_TITLE: "Veydrift First Planet Test",
  SITE_DESCRIPTION:
    "Veydrift Base Sepolia test app for MetaMask first-planet settlement.",
  SOCIAL_IMAGE: "https://test.veydrift.com/assets/miniapp/og-image.jpg",
  MINIAPP_IMAGE: "https://test.veydrift.com/assets/miniapp/embed.png",
  MINIAPP_SPLASH: "https://test.veydrift.com/assets/miniapp/splash.png",
} satisfies HtmlEnv;

export default defineConfig(({ mode }) => {
  const isTestSurface = mode === "playable" || mode === "settlement";
  const htmlEnv = isTestSurface ? playableHtmlEnv : baseHtmlEnv;
  const surface = mode === "playable" || mode === "settlement" ? mode : "";

  return {
    define: {
      "import.meta.env.VITE_VEYDRIFT_SURFACE": JSON.stringify(surface),
    },
    plugins: [
      preact(),
      htmlEnvDefaults(htmlEnv),
    ],
  };
});

function htmlEnvDefaults(env: HtmlEnv): Plugin {
  return {
    name: "veydrift-html-env-defaults",
    transformIndexHtml(html) {
      return Object.entries(env).reduce(
        (nextHtml, [key, value]) => nextHtml.replaceAll(`__${key}__`, value),
        html,
      );
    },
  };
}
