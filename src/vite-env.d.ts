/**
 * (c) 2024, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
/// <reference types="vite-plugin-svgr/client" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VERSION: string;
  readonly VITE_STAGE: string;
  /** JSON of the build's BUILD.json (vite.config.ts, src/build-info.ts). */
  readonly VITE_BUILD_INFO: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
