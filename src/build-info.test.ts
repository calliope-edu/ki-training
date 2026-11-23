/**
 * (c) 2026, Calliope gGmbH and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import { createRequire } from "node:module";
import { vi } from "vitest";
import {
  BuildInfo,
  buildInfo,
  logBuildInfoWhenEmbedded,
  packagesLine,
  parseBuildInfo,
  versionLine,
} from "./build-info";

const { buildInfo: fromEnv } = createRequire(import.meta.url)(
  "../bin/build-info.cjs"
) as {
  buildInfo: (env: Record<string, string | undefined>) => BuildInfo;
};

const live: BuildInfo = {
  channel: "live",
  version: "calliope-v1.0.0",
  commit: "7ea99620123456789abcdef0123456789abcdef0",
  builtAt: "2026-11-23T17:00:00Z",
  ui: { tag: "v0.3.0", commit: "aaaaaaaaaa" },
  widget: { tag: "v0.4.1", commit: "bbbbbbbbbb" },
  libs: {},
};

describe("build info", () => {
  it("names version and short commit", () => {
    expect(versionLine(live)).toEqual("calliope-v1.0.0 · 7ea9962");
    expect(
      versionLine({ ...live, channel: "dev", version: "calliope-main" })
    ).toEqual("calliope-main · 7ea9962");
    expect(versionLine({ ...live, commit: "" })).toEqual("calliope-v1.0.0");
  });

  it("names calliope-ui and widget by tag, on dev by commit", () => {
    expect(packagesLine(live)).toEqual("UI v0.3.0 · Widget v0.4.1");
    expect(
      packagesLine({
        ...live,
        ui: { tag: "", commit: "6faa0c1234" },
        widget: { tag: "", commit: "9e8d7c6234" },
      })
    ).toEqual("UI 6faa0c1 · Widget 9e8d7c6");
    expect(packagesLine({ ...live, ui: null, widget: null })).toBeNull();
  });

  it("falls back to local without or with broken build info", () => {
    expect(parseBuildInfo(undefined).channel).toEqual("local");
    expect(parseBuildInfo("{").version).toEqual("local");
    expect(parseBuildInfo(JSON.stringify(live))).toEqual(live);
  });

  it("is compiled in from the vite config", () => {
    expect(["live", "dev", "local"]).toContain(buildInfo.channel);
    expect(buildInfo.ui?.commit).toBeTruthy();
    expect(buildInfo.widget?.commit).toBeTruthy();
  });

  it("writes the BUILD.json shape from the workflow's variables", () => {
    expect(
      fromEnv({
        BUILD_CHANNEL: "live",
        BUILD_VERSION: "calliope-v1.0.0",
        BUILD_COMMIT: live.commit,
        BUILD_AT: live.builtAt,
        BUILD_DEPS: JSON.stringify({ ui: live.ui, widget: live.widget }),
      })
    ).toEqual(live);
    // resolve-calliope-deps gives tag null on dev; BUILD.json says "".
    expect(
      fromEnv({
        BUILD_CHANNEL: "dev",
        BUILD_DEPS: JSON.stringify({
          ui: { tag: null, commit: "6faa0c1234" },
          widget: null,
        }),
      })
    ).toMatchObject({
      channel: "dev",
      ui: { tag: "", commit: "6faa0c1234" },
      widget: null,
    });
    expect(() => fromEnv({ BUILD_CHANNEL: "beta" })).toThrow();
  });

  it("takes calliope-ui and the widget from the pins when built locally", () => {
    const local = fromEnv({});
    expect(local.channel).toEqual("local");
    expect(local.ui?.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(local.widget?.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("logs only in the embedded variant", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logBuildInfoWhenEmbedded(live, "/", false);
    expect(info).not.toHaveBeenCalled();
    logBuildInfoWhenEmbedded(live, "/editors/ki-training/", false);
    logBuildInfoWhenEmbedded(live, "/", true);
    expect(info).toHaveBeenCalledTimes(2);
    expect(info.mock.calls[0][0]).toEqual(
      "[ki-training] live calliope-v1.0.0 · 7ea9962"
    );
    info.mockRestore();
  });
});
