/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_TOKEN?: string;
}

declare module "*.json" {
  const value: any;
  export default value;
}
