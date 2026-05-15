/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VEYDRIFT_SETTLEMENT_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
