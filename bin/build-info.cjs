#!/usr/bin/env node
/**
 * (c) 2026, Calliope gGmbH and contributors
 *
 * SPDX-License-Identifier: MIT
 */
// The build's version as BUILD.json holds it (docs/build-info.md), copied from
// calliope-mini-python-editor's bin/build-info.js, which defines the format.
//
// The calliope-build workflow sets BUILD_CHANNEL, BUILD_VERSION, BUILD_COMMIT
// and BUILD_AT once per job, and BUILD_DEPS to the output `json` of the
// resolve-calliope-deps action (the states of calliope-ui and the connection
// widget the build installs). vite.config.ts compiles the same object into
// both builds as import.meta.env.VITE_BUILD_INFO, and the workflow writes
// BUILD.json next to each build with `node bin/build-info.cjs`. Without those
// variables (`npm run dev`, a local `npm run build`) the channel is "local",
// version and commit come from git and calliope-ui and the widget from the
// pins in package.json and package-lock.json.
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const CHANNELS = ["live", "dev", "local"];

const root = path.resolve(__dirname, "..");

/** BUILD.json key → npm package. */
const PACKAGES = {
  ui: "@calliope-edu/ui",
  widget: "@calliope-edu/mini-connection-widget",
};

const git = (args) => {
  try {
    return execSync(`git ${args}`, {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
};

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch {
    return undefined;
  }
};

const refOf = (spec) => /#(.+)$/.exec(spec || "")?.[1] ?? "";

/**
 * A package's state from the app's own pins: the tag when package.json pins
 * one (`#v0.3.0`), and the commit the lockfile resolved it to.
 */
const pinnedState = (name, pkg, lock) => {
  const spec = pkg?.dependencies?.[name];
  if (!spec) {
    return null;
  }
  const ref = refOf(spec);
  const resolved = lock?.packages?.[`node_modules/${name}`]?.resolved;
  const commit = refOf(resolved) || (/^[0-9a-f]{40}$/.test(ref) ? ref : "");
  return { tag: /^v\d+\.\d+\.\d+$/.test(ref) ? ref : "", commit };
};

/**
 * calliope-ui's and the widget's states: from BUILD_DEPS when the workflow
 * resolved them for its channel, else from the pins.
 * @param {string | undefined} deps
 */
const packageStates = (deps) => {
  if (deps) {
    const parsed = JSON.parse(deps);
    const state = (key) =>
      parsed[key]
        ? { tag: parsed[key].tag || "", commit: parsed[key].commit || "" }
        : null;
    return { ui: state("ui"), widget: state("widget") };
  }
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  return {
    ui: pinnedState(PACKAGES.ui, pkg, lock),
    widget: pinnedState(PACKAGES.widget, pkg, lock),
  };
};

/**
 * @param {Record<string, string | undefined>} env
 */
const buildInfo = (env = process.env) => {
  const channel = env.BUILD_CHANNEL || "local";
  if (!CHANNELS.includes(channel)) {
    throw new Error(
      `BUILD_CHANNEL must be one of ${CHANNELS.join(", ")}, not "${channel}"`
    );
  }
  return {
    channel,
    // live: the tag (calliope-vX.Y.Z); dev: the branch (calliope-main).
    version: env.BUILD_VERSION || git("rev-parse --abbrev-ref HEAD") || "local",
    commit: env.BUILD_COMMIT || git("rev-parse HEAD"),
    builtAt: env.BUILD_AT || new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    // { tag, commit } each; tag "" on dev.
    ...packageStates(env.BUILD_DEPS),
    // Pinned library forks, name → commit; none tracked here yet.
    libs: {},
  };
};

module.exports = { buildInfo };

if (require.main === module) {
  process.stdout.write(JSON.stringify(buildInfo(), null, 2) + "\n");
}
