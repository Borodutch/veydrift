/// <reference types="vite/client" />

declare module "*.md?raw" {
  const source: string;
  export default source;
}

interface ImportMetaEnv {
  readonly VITE_VEYDRIFT_API_URL?: string;
  readonly VITE_VEYDRIFT_SETTLEMENT_ADDRESS?: string;
  readonly VITE_VEYDRIFT_SURFACE?: "playable" | "settlement" | "test";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
