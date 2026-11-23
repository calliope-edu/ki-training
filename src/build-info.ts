/**
 * (c) 2026, Calliope gGmbH and contributors
 *
 * SPDX-License-Identifier: MIT
 */

/** A shared package's state in a build: its release tag ("" on dev) and commit. */
export interface PackageState {
  tag: string;
  commit: string;
}

/**
 * Which version this build is: the same values as the BUILD.json next to it
 * (docs/build-info.md). vite.config.ts compiles them in from
 * bin/build-info.cjs.
 */
export interface BuildInfo {
  channel: "live" | "dev" | "local";
  /** live: the tag (calliope-vX.Y.Z); dev: the branch (calliope-main). */
  version: string;
  commit: string;
  builtAt: string;
  ui: PackageState | null;
  widget: PackageState | null;
  libs: Record<string, string>;
}

const fallback: BuildInfo = {
  channel: "local",
  version: "local",
  commit: "",
  builtAt: "",
  ui: null,
  widget: null,
  libs: {},
};

export const parseBuildInfo = (json: string | undefined): BuildInfo => {
  if (!json) {
    return fallback;
  }
  try {
    return { ...fallback, ...(JSON.parse(json) as Partial<BuildInfo>) };
  } catch {
    return fallback;
  }
};

export const buildInfo = parseBuildInfo(import.meta.env.VITE_BUILD_INFO);

export const shortCommit = (commit: string): string => commit.slice(0, 7);

const joined = (...parts: string[]) => parts.filter(Boolean).join(" · ");

/** "calliope-v1.0.0 · 7ea9962" (live), "calliope-main · a1b2c3d" (dev). */
export const versionLine = (info: BuildInfo): string =>
  joined(info.version, shortCommit(info.commit));

const packageState = (label: string, state: PackageState | null) =>
  state ? `${label} ${state.tag || shortCommit(state.commit)}` : "";

/**
 * "UI v0.3.0 · Widget v0.4.1" (live), "UI 6faa0c1 · Widget 9e8d7c6" (dev), or
 * null without calliope-ui and the widget.
 */
export const packagesLine = (info: BuildInfo): string | null =>
  joined(packageState("UI", info.ui), packageState("Widget", info.widget)) ||
  null;

/**
 * The embedded Campus variant (/editors/ki-training/, or any page in a frame)
 * shows its version line to nobody who looks for it there, so it names its
 * build in the console once.
 */
export const logBuildInfoWhenEmbedded = (
  info: BuildInfo = buildInfo,
  baseUrl: string = import.meta.env.BASE_URL ?? "/",
  framed: boolean = window.parent !== window
): void => {
  if (framed || baseUrl.startsWith("/editors/")) {
    console.info(`[ki-training] ${info.channel} ${versionLine(info)}`, info);
  }
};
