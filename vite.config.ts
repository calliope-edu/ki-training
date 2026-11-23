/// <reference types="vitest" />
/**
 * (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors
 * Modifications (c) 2024, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import react from "@vitejs/plugin-react";
import ejs from "ejs";
import fs from "node:fs";
import path from "node:path";
import {
  IndexHtmlTransformContext,
  IndexHtmlTransformResult,
  Plugin,
  ServerOptions,
  UserConfig,
  defineConfig,
  loadEnv,
} from "vite";
import svgr from "vite-plugin-svgr";
import { configDefaults } from "vitest/config";

interface TemplateStrings {
  appNameFull: string;
  ogDescription: undefined | string;
  metaDescription: undefined | string;
}

// Support optionally pulling in external branding if the module is installed.
const theme = "@microbit-foundation/ml-trainer-microbit";
const external = `node_modules/${theme}`;
const internal = "src/deployment/default";
const themePackageExternal = fs.existsSync(external);
const themePackageAlias = themePackageExternal
  ? theme
  : path.resolve(__dirname, internal);

const viteEjsPlugin = (data: ejs.Data): Plugin => {
  return {
    name: "ejs",
    transformIndexHtml: {
      order: "pre",
      handler: (
        html: string,
        _ctx: IndexHtmlTransformContext
      ): IndexHtmlTransformResult => ejs.render(html, data),
    },
  };
};

/**
 * The connection widget (@calliope-edu/mini-connection-widget) runs on its own,
 * patched @microbit/microbit-connection 1.0.0-beta.1, installed under the alias
 * `microbit-connection-widget` (bin/patch-widget-connection.cjs). The trainer
 * keeps Calliope's fork of the library under the real name, so only the
 * widget's imports are pointed at the alias.
 */
const widgetConnectionPlugin = (): Plugin => ({
  name: "widget-microbit-connection",
  enforce: "pre",
  resolveId(source, importer, options) {
    if (
      !importer ||
      !/[\\/]@calliope-edu[\\/]mini-connection-widget[\\/]/.test(importer) ||
      !/^@microbit\/microbit-connection(\/|$)/.test(source)
    ) {
      return null;
    }
    return this.resolve(
      source.replace(
        "@microbit/microbit-connection",
        "microbit-connection-widget"
      ),
      importer,
      { ...options, skipSelf: true }
    );
  },
});

export default defineConfig(async ({ mode }): Promise<UserConfig> => {
  const strings: TemplateStrings = themePackageExternal
    ? // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      ((await import(themePackageAlias)).default({}) as TemplateStrings)
    : {
        appNameFull: "calliope-ml",
        ogDescription: undefined,
        metaDescription: undefined,
      };
  return {
    base: process.env.BASE_URL ?? "/",
    plugins: [
      viteEjsPlugin({
        ...strings,
        // The shared consent/analytics assets from go.calliope.cc. The build
        // for Calliope Campus (CAMPUS_DIST=1, .github/workflows/campus-dist.yml)
        // leaves them out: Campus serves it on its own origin, where every
        // script runs with Campus's rights, so it only loads what it pins.
        sharedAssets: process.env.CAMPUS_DIST !== "1",
      }),
      widgetConnectionPlugin(),
      react(),
      // The connection widget and calliope-ui ship Svelte 5 source.
      svelte({ preprocess: vitePreprocess() }),
      svgr(),
    ],
    optimizeDeps: {
      // Shipped as unbuilt Svelte/TS source, which the dep optimizer cannot
      // prebundle; their own dependencies are prebundled instead.
      exclude: ["@calliope-edu/mini-connection-widget", "@calliope-edu/ui"],
      include: [
        "microbit-connection-widget",
        "microbit-connection-widget/usb",
        "microbit-connection-widget/bluetooth",
        "nrf-intel-hex",
        "bits-ui",
        "svelte-sonner",
      ],
    },
    assetsInclude: ["**/*.hex"],
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(
        process.env.npm_package_version
      ),
    },
    build: {
      target: "es2017",
      rollupOptions: {
        input: "index.html",
      },
    },
    server: createServer(mode),
    test: {
      globals: true,
      environment: "jsdom",
      exclude: [...configDefaults.exclude, "**/e2e/**"],
    },
    resolve: {
      alias: {
        "theme-package": themePackageAlias,
      },
    },
  };
});

const createServer = (mode: string): ServerOptions => {
  const commonEnv = loadEnv(mode, process.cwd(), "");
  const options = {
    port: 5173,
    proxy: {
      "/microbit-org-proxy/": {
        target: "https://calliope.cc/",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/microbit-org-proxy/, ""),
      },
    },
  };

  if (commonEnv.API_PROXY) {
    options.proxy["/api/v1"] = {
      target: commonEnv.API_PROXY,
      changeOrigin: true,
    };
  }
  return options;
};
