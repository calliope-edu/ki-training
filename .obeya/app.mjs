#!/usr/bin/env node
/**
 * Runs this workspace's own ml-trainer dev server (Vite) on a free port, beside
 * other workspaces on the same machine.
 *
 *   node .obeya/app.mjs start    install dependencies if missing, start Vite in the
 *                                background, wait until it answers, print the URL
 *   node .obeya/app.mjs stop     stop what `start` started here (nothing else)
 *   node .obeya/app.mjs status   port, PID, URL and whether it still runs
 *
 * State goes to `.obeya/run/` (gitignored): app.json (url, port, pid) and vite.log.
 * Vite outlives the shell that started it (detached; on Windows through a
 * windowless console, see launchHidden); `stop` ends it by PID with its process tree.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const runDir = resolve(root, '.obeya', 'run');
const stateFile = resolve(runDir, 'app.json');
const logFile = resolve(runDir, 'vite.log');
const win = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 5173 is the default of vite.config.ts and of the Playwright e2e tests: leave it free.
const FIRST_PORT = 5500;

function readState() {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function free(port) {
  const probe = (host) =>
    new Promise((ok) => {
      const s = net.createServer();
      s.once('error', () => ok(false));
      s.listen({ port, host, exclusive: true }, () => s.close(() => ok(true)));
    });
  return probe('127.0.0.1').then((a) => a && probe('::').catch(() => true));
}

async function freePort(from) {
  for (let p = from; p < from + 200; p++) if (await free(p)) return p;
  throw new Error(`no free port from ${from}`);
}

/**
 * Windows: a detached process has no console, so console programs it starts
 * (esbuild) would open windows of their own. An intermediate cmd.exe, spawned
 * not detached with all stdio ignored, gets a console without a window and
 * redirects the log itself; the job object lets its child break away, so Vite
 * outlives this script. Returns the PID of that child, not of cmd.exe.
 */
async function launchHidden(cmd, args, options) {
  const line = [cmd, ...args].map((a) => `"${a}"`).join(' ') + ` < NUL > "${logFile}" 2>&1`;
  const shell = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    ...options,
    windowsVerbatimArguments: true,
    stdio: 'ignore',
  });
  shell.unref();
  let exited = false;
  shell.once('exit', () => (exited = true));
  const filter = `ParentProcessId=${shell.pid} AND Name='${basename(cmd)}'`;
  for (let i = 0; i < 40 && !exited; i++) {
    const pid = Number(
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "${filter}").ProcessId`],
        { encoding: 'utf8', windowsHide: true }
      )
        .split(/\s+/)
        .find(Boolean)
    );
    if (pid) return pid;
    await sleep(250);
  }
  return shell.pid;
}

async function launch(cmd, args) {
  const options = { cwd: root, env: process.env, windowsHide: true };
  if (win) return launchHidden(cmd, args, options);
  const log = openSync(logFile, 'w');
  const child = spawn(cmd, args, { ...options, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  return child.pid;
}

async function start() {
  const state = readState();
  if (state && alive(state.pid)) {
    console.log(`already running: ${state.url}`);
    return;
  }
  if (state) stop();
  if (!existsSync(resolve(root, 'node_modules'))) {
    execFileSync('npm', ['ci'], { cwd: root, stdio: 'inherit', shell: win });
  }
  mkdirSync(runDir, { recursive: true });
  const port = await freePort(FIRST_PORT);
  const url = `http://localhost:${port}/`;
  console.log(`starting Vite on ${port}`);
  const pid = await launch(process.execPath, [
    resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'),
    'dev',
    '--port',
    String(port),
    '--strictPort',
  ]);
  writeFileSync(stateFile, JSON.stringify({ url, port, pid }, null, 2));
  for (let i = 0; i < 180; i++) {
    const res = await fetch(url).catch(() => null);
    if (res && res.status < 500) {
      console.log(`ready: ${url}`);
      return;
    }
    if (!alive(pid)) throw new Error('Vite exited; see .obeya/run/vite.log');
    await sleep(1000);
  }
  throw new Error('Vite did not answer within 180 s; see .obeya/run/vite.log');
}

function stop() {
  const state = readState();
  if (!state) return;
  if (alive(state.pid)) {
    try {
      if (win) {
        execFileSync('taskkill', ['/PID', String(state.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } else process.kill(-state.pid, 'SIGTERM');
      console.log(`stopped Vite (${state.pid})`);
    } catch {
      /* gone already */
    }
  }
  rmSync(stateFile, { force: true });
}

function status() {
  const state = readState();
  if (!state) return console.log('not running');
  console.log(`vite: port ${state.port}, pid ${state.pid}, ${alive(state.pid) ? 'running' : 'gone'}`);
  console.log(`url: ${state.url}`);
}

const cmd = process.argv[2];
try {
  if (cmd === 'start') await start();
  else if (cmd === 'stop') stop();
  else if (cmd === 'status') status();
  else {
    console.error('usage: node .obeya/app.mjs start|stop|status');
    process.exit(2);
  }
} catch (e) {
  console.error(String(e.message ?? e));
  process.exit(1);
}
