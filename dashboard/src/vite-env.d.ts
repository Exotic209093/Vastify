/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VASTIFY_API_KEY?: string;
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
