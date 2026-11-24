# CLAUDE.md

## Branches

- Work happens on `calliope-main`: branch off it and merge back into it. It is
  the only Calliope branch (`main` and `feat-calliope` were merged into it on
  2026-11-23 and are no longer worked on).
- A tag `calliope-vX.Y.Z` goes live: the `calliope-build` workflow builds it
  onto `build-live` (`ki-training.calliope.cc`; Campus pins it). Every push to
  `calliope-main` builds onto `build-dev` (`ki-training-dev.calliope.cc`).
- Never commit to `build-live` or `build-dev` by hand; only the workflow
  writes them.
- calliope-ui and the connection widget follow the build's channel
  (`resolve-calliope-deps`); the pins in `package.json` are release tags for
  local development. Build info and the version line: `docs/build-info.md`.
- The forks `calliope-edu/makecode-embed` and `calliope-edu/mini-connection`
  come from their `calliope-main` over https; `package-lock.json` pins their
  commits. A push to a fork's `calliope-main` commits the new pin here (the
  fork's `calliope-app-lockfile` workflow), which makes a dev build; the next
  tag takes it live. A local `npm install` writes GitHub dependencies as
  `git+ssh` again: commit them as `git+https` (the forks' workflow also fixes
  them on its next run).
- The plan behind this: calliope-campus `docs/design/2026-editor-channels.md`.
