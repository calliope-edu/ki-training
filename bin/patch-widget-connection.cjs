#!/usr/bin/env node
/**
 * Applies the connection widget's patch to its copy of
 * @microbit/microbit-connection (installed as `microbit-connection-widget`).
 *
 * The connection widget (@calliope-edu/mini-connection-widget) runs on
 * @microbit/microbit-connection 1.0.0-beta.1 with Calliope fixes (J-Link
 * VID/PID, "Calliope mini" BLE name prefix, lenient board version, ...),
 * which it ships as a patch. The trainer itself uses Calliope's fork of the
 * library under the real name, so the widget's version is installed under an
 * alias, and vite.config.ts points the widget's imports at it. Run from
 * `postinstall`; does nothing when the patch is in already.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const target = "node_modules/microbit-connection-widget";
const patch = path.join(
  root,
  "node_modules/@calliope-edu/mini-connection-widget/patches/@microbit__microbit-connection@1.0.0-beta.1.patch"
);

if (!fs.existsSync(path.join(root, target)) || !fs.existsSync(patch)) {
  console.log("patch-widget-connection: nothing to patch");
  process.exit(0);
}

const git = (...args) =>
  execFileSync(
    "git",
    ["apply", `--directory=${target}`, "--unsafe-paths", ...args, patch],
    { cwd: root, stdio: "pipe" }
  );

try {
  git("--check", "--reverse");
  console.log("patch-widget-connection: already applied");
  process.exit(0);
} catch {
  // Not applied yet.
}
git();
console.log(`patch-widget-connection: patched ${target}`);
