# Branch Buddy

<p align="center">
  <img src="logo/branch-buddy-logo-original.png" alt="Branch Buddy logo" width="220">
</p>

[![CI](https://github.com/shiny-dragapult/branch-buddy/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/shiny-dragapult/branch-buddy/actions/workflows/ci.yml)

A VS Code extension that watches every VS Code window you have open and **turns a window red whenever any other open instance is on a different git branch.**

## Why

When you're juggling several VS Code windows (microservice repos, frontend + backend, multiple worktrees), it's easy to commit, push, or run scripts in the *wrong* window because they all look identical. This extension makes "wrong window" impossible to miss: a mismatch paints the title bar, status bar, and activity bar bright red.

## Opting repos in: the `group` setting

By default, **Branch Buddy does nothing**. To activate it for a repo, set `branchBuddy.group` in that repo's workspace settings (or run the **Branch Buddy: Set group for this workspace** command). Only instances that share the **same non-empty group** are compared, so unrelated projects open in other windows are ignored.

Typical setup for a frontend/backend project:

```jsonc
// acme-frontend/.vscode/settings.json
{ "branchBuddy.group": "acme-app" }

// acme-backend/.vscode/settings.json
{ "branchBuddy.group": "acme-app" }
```

Both repos now compare branches with each other. Any other unrelated repo (no group set, or a different group) is invisible to them. Because the setting lives in `.vscode/settings.json`, you can commit it and teammates inherit the grouping automatically.

For a multi-root VS Code workspace where one window contains several repos, keep the same per-repo `branchBuddy.group` values and opt the window into per-folder tracking:

```jsonc
// .code-workspace settings, or your user/workspace settings
{ "branchBuddy.trackingMode": "allWorkspaceFolders" }
```

In this mode, each workspace folder writes its own registry entry, so Branch Buddy compares projects both across separate VS Code windows and inside the same multi-root window. The default is `firstWorkspaceFolder`, which preserves the original one-entry-per-window behavior.

## How it works

- Each VS Code window writes its current branch into a shared registry file under `os.tmpdir()/vscode-branch-buddy/registry.json` and refreshes that entry on a heartbeat.
- Each window watches the registry file (and uses the heartbeat as a fallback) and compares every other live instance's branch against its own.
- If *any* other live instance is on a different branch, this window applies a red `workbench.colorCustomizations` override. When everyone realigns, the override is removed.
- Stale entries (instances that haven't checked in for `branchBuddy.staleMs`, default 30s) are ignored so a crashed VS Code won't leave you stuck red.

Branch detection uses the built-in `vscode.git` extension API, so it reacts immediately to checkouts — no shelling out to `git`.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `branchBuddy.group` | `""` | Project group identifier. Only instances with the same non-empty group are compared. Empty disables the extension for this window. |
| `branchBuddy.color` | `#c41e3a` | Background color used when a mismatch is detected. |
| `branchBuddy.foreground` | `#ffffff` | Foreground color paired with the alert color. |
| `branchBuddy.groupColor` | `""` | Foreground color for the group name shown in the status bar (e.g. `#7aa2f7`). Empty inherits the theme default. |
| `branchBuddy.trackingMode` | `"firstWorkspaceFolder"` | `firstWorkspaceFolder` tracks one repo per VS Code window. `allWorkspaceFolders` tracks every workspace folder as a separate entry for multi-root workspaces. |
| `branchBuddy.heartbeatMs` | `5000` | How often this window updates its registry entry. |
| `branchBuddy.staleMs` | `30000` | Entries older than this are treated as dead instances. |

## Commands

- **Branch Buddy: Refresh now** — force a re-check.
- **Branch Buddy: Show status of all instances** — see every registered instance, its branch, group, workspace, and how old its heartbeat is.
- **Branch Buddy: Set group for this workspace** — quick way to set/clear `branchBuddy.group` without editing JSON.

## Build (no Node on the host)

Everything compiles inside Docker. You never need Node installed locally — VS Code ships its own Node runtime, which is what loads `out/extension.js` once it exists.

First time, or whenever `package.json` changes:

```sh
docker compose build
```

Then start the watcher and leave it running while you develop:

```sh
docker compose up app
# or, with live source sync:
docker compose watch
```

That continuously emits `./out/extension.js` to the host. Press `F5` in VS Code with this folder open to launch an Extension Development Host pointed at the compiled output. Open a second VS Code window on a *different* branch to see the effect.

For a one-shot compile without the watcher:

```sh
docker compose run --rm app npx tsc -p .
```

## Tests

There are two parallel test tracks:

**Unit tests** for the pure modules (`Config.make`, `RegistryOps`, `InstanceEntryBuilder`, `MismatchDetector`) run under Vitest in the app container — no Node on the host:

```sh
docker compose run --rm app npm test            # one-shot
docker compose run --rm app npm run test:watch  # re-run on change
docker compose run --rm app npm run typecheck   # type-check src/ + tests/
```

Tests live under `tests/`, mirror `src/`, and never import `vscode`.

CI publishes coverage reports as artifacts from both the unit and integration jobs. To generate the same reports locally:

```sh
docker compose run --rm app npm run coverage:unit
docker compose run --rm integration npm run coverage:integration
```

**Integration ("feature") tests** for the modules that touch the editor (currently `ConfigLoader`) run under `@vscode/test-cli` + `@vscode/test-electron`. These spawn a real VS Code instance, drive `vscode.workspace.getConfiguration()`, and assert on the result. Tests live under `tests-integration/` using Mocha's TDD UI (`suite`/`test`) and Node's `assert`, per the [VS Code extension testing guide](https://code.visualstudio.com/api/working-with-extensions/testing-extension).

They run in a **separate Docker service** (`integration`) based on `node:22-bookworm-slim` with `xvfb` and Electron's runtime libraries installed — the alpine app image can't launch Electron:

```sh
docker compose build integration              # one-time (or when deps change)
docker compose run --rm integration           # compiles + runs the suite
```

That command runs `xvfb-run -a npm run test:integration`, which transitively invokes `npm run prepare:integration` (compiling both production code and integration tests to `out-test/`) before launching VS Code under the virtual display. The downloaded VS Code binary is cached in a named Docker volume (`vscode-test-cache`) so subsequent runs reuse it.

If you ever want to run the suite outside Docker (e.g. on a developer laptop with Node installed), the npm scripts work as-is:

```sh
npm run prepare:integration
npm run test:integration
```

## Notes & caveats

- The red colors are applied at **workspace** scope when a workspace folder is open, otherwise at **global** scope. The extension only manages the keys it sets, so any other `workbench.colorCustomizations` you have are preserved.
- With the default `firstWorkspaceFolder` tracking mode, a multi-root workspace or repo containing nested git checkouts reports the **first** workspace folder's git repo. Set `branchBuddy.trackingMode` to `allWorkspaceFolders` when you want each workspace folder in the window to be tracked independently.
- The registry lives in the OS temp dir, so it's shared between all VS Code installs of the same user on the same machine. Different users / different machines don't see each other.
