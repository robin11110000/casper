/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CSPRCLICK_APP_ID?: string;
  readonly VITE_CASPER_NETWORK?: string;
  readonly VITE_CASPER_NODE_RPC_URL?: string;
  readonly VITE_ORACLE_PACKAGE_HASH?: string;
  readonly VITE_MARKET_PACKAGE_HASH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
