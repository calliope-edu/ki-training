# Build info: `BUILD.json` and the version line

Every Calliope editor build says which version it is, in one shape, so
Calliope Campus' version overview (`/admin/versions`) can compare each target
against its channel and anyone can tell which build they are looking at. The
format is defined in calliope-mini-python-editor `docs/build-info.md`; this
editor copies it. The plan behind it is calliope-campus
`docs/design/2026-editor-channels.md` ("Version display").

## Channels

| Channel | Built from                             | Build branch | Served at                                         |
| ------- | -------------------------------------- | ------------ | ------------------------------------------------- |
| `live`  | a tag `calliope-vX.Y.Z`                | `build-live` | `ki-training.calliope.cc`, Campus pins it         |
| `dev`   | a push to `calliope-main`              | `build-dev`  | `ki-training-dev.calliope.cc`, campus-dev proxies |
| `local` | `npm run dev`, a local `npm run build` | none         | your machine                                      |

calliope-ui and the connection widget follow the channel: the workflow runs
calliope-ui's `resolve-calliope-deps` action before installing, which sets
them to their newest commit on `calliope-main` (dev) or their newest release
tag within the major `package.json` pins (live). The pins in `package.json`
(release tags) only serve local development.

## `BUILD.json`

At the site root (`/BUILD.json`) and in the Campus variant
(`/editors/ki-training/BUILD.json`), with the same values:

```json
{
  "channel": "live",
  "version": "calliope-v1.1.0",
  "commit": "7ea99620f3c4…",
  "builtAt": "2026-11-23T17:00:00Z",
  "ui": { "tag": "v0.1.0", "commit": "4e015326…" },
  "widget": { "tag": "v0.3.0", "commit": "53a8a25d…" },
  "libs": {}
}
```

On dev, `version` is `calliope-main` and the `tag` fields are `""`. The fields
are explained in the Python editor's doc.

## Where the values come from

[`bin/build-info.cjs`](../bin/build-info.cjs) builds the object from five
environment variables, which the `calliope-build` workflow sets once per job
(step "Build info"):

| Variable        | Set to                                       | Without it (local)                    |
| --------------- | -------------------------------------------- | ------------------------------------- |
| `BUILD_CHANNEL` | `live` for a tag, `dev` for a branch         | `local`                               |
| `BUILD_VERSION` | the tag or branch name                       | the checked-out branch                |
| `BUILD_COMMIT`  | the source commit                            | `git rev-parse HEAD`                  |
| `BUILD_AT`      | the time of the build                        | now                                   |
| `BUILD_DEPS`    | the output `json` of `resolve-calliope-deps` | the pins in package.json and the lock |

`vite.config.ts` compiles the object in as `import.meta.env.VITE_BUILD_INFO`
([`src/build-info.ts`](../src/build-info.ts)), and the workflow writes
`node bin/build-info.cjs` to both `BUILD.json`, so file and app agree.

## The version line

At the bottom of the settings menu (the gear; on narrow windows the main
menu), below a separator, black text:

- live: `calliope-v1.1.0 · 7ea9962` / `UI v0.1.0 · Widget v0.3.0`
- dev: a framed `dev` mark, `calliope-main · a1b2c3d` /
  `UI 4e01532 · Widget 53a8a25`
- local: a framed `local` mark, the branch and commit, and the pinned states

The Campus variant (`/editors/ki-training/`, or any page in a frame) also logs
the build once to the console:

```
[ki-training] live calliope-v1.1.0 · 7ea9962 {channel: "live", …}
```
