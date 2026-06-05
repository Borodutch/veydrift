export const MINIAPP_ICON_PATH = "/assets/miniapp/icon.png";

export const MINIAPP_ICON_ALIAS_PATHS = [
  "/favicon.ico",
  "/favicon.png",
  "/apple-touch-icon.png",
  "/icon.png",
  "/assets/favicon.ico",
  "/assets/favicon.png",
  "/assets/icon.png",
];

export function miniAppIconAliasTarget(pathname) {
  return MINIAPP_ICON_ALIAS_PATHS.includes(pathname) ? MINIAPP_ICON_PATH : undefined;
}
