import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { TrackingMode } from '../../src/config/Config';
import type { InstanceEntry, Registry } from '../../src/types';

/**
 * Shared helpers for the integration test suites. Kept under `helpers/` so
 * the `.vscode-test.mjs` glob (`**\/*.test.js`) doesn't pick it up as a test
 * file — it just gets compiled alongside and imported by the real suites.
 *
 * The registry path here must match BranchSync's own path (it's hardcoded
 * to `os.tmpdir()/vscode-branch-buddy/registry.json` in production).
 */

export const REGISTRY_PATH = path.join(
    os.tmpdir(),
    'vscode-branch-buddy',
    'registry.json',
);

export const COLOR_SECTION = 'workbench.colorCustomizations';
export const FIXTURE_BRANCH = 'fixture-branch';
export const MANAGED_BG_KEY = 'titleBar.activeBackground';

// ---------- registry I/O ----------

export function readRegistry(): Registry {
    try {
        if (!fs.existsSync(REGISTRY_PATH)) return { instances: {} };
        return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')) as Registry;
    } catch {
        return { instances: {} };
    }
}

export function writeRegistry(reg: Registry): void {
    fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2), 'utf8');
}

export function clearRegistry(): void {
    writeRegistry({ instances: {} });
}

// ---------- fake peer manipulation ----------

export interface PeerOptions {
    /** Defaults to a random uuid. */
    id?: string;
    /** Defaults to a deliberately-unused pid. */
    pid?: number;
    /** Defaults to `/peer-workspace`. */
    workspace?: string;
    /** No default — required to be useful. */
    branch: string;
    /** No default — required to be useful. */
    group: string;
    /** Defaults to "now"; pass an older value to simulate a stale peer. */
    updatedAt?: number;
}

/** Inject a fake peer into the shared registry and return its instance id. */
export function injectPeer(opts: PeerOptions): string {
    const id = opts.id ?? `peer-${crypto.randomUUID()}`;
    const reg = readRegistry();
    reg.instances[id] = {
        pid: opts.pid ?? 99_000,
        workspace: opts.workspace ?? '/peer-workspace',
        branch: opts.branch,
        group: opts.group,
        updatedAt: opts.updatedAt ?? Date.now(),
    };
    writeRegistry(reg);
    return id;
}

/** Mutate a previously-injected peer's fields, keeping `updatedAt` fresh. */
export function updatePeer(id: string, patch: Partial<Omit<PeerOptions, 'id'>>): void {
    const reg = readRegistry();
    const existing = reg.instances[id];
    if (!existing) {
        throw new Error(`peer ${id} not present in registry`);
    }
    reg.instances[id] = {
        ...existing,
        ...(patch.pid !== undefined && { pid: patch.pid }),
        ...(patch.workspace !== undefined && { workspace: patch.workspace }),
        ...(patch.branch !== undefined && { branch: patch.branch }),
        ...(patch.group !== undefined && { group: patch.group }),
        updatedAt: patch.updatedAt ?? Date.now(),
    };
    writeRegistry(reg);
}

export function removePeer(id: string): void {
    const reg = readRegistry();
    delete reg.instances[id];
    writeRegistry(reg);
}

// ---------- timing ----------

export function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

export async function waitForCondition(
    predicate: () => boolean,
    timeoutMs: number,
    label: string,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await sleep(50);
    }
    throw new Error(`timed out waiting for ${label}`);
}

// ---------- vscode helpers ----------

export function fakeContext(): vscode.ExtensionContext {
    return {
        subscriptions: [] as vscode.Disposable[],
    } as unknown as vscode.ExtensionContext;
}

export function effectiveColors(): Record<string, string> {
    return (
        vscode.workspace
            .getConfiguration()
            .get<Record<string, string>>(COLOR_SECTION) ?? {}
    );
}

export function redIsApplied(): boolean {
    return effectiveColors()[MANAGED_BG_KEY] !== undefined;
}

export async function setGroup(value: string | undefined): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const target = folder
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : vscode.ConfigurationTarget.Global;
    await vscode.workspace
        .getConfiguration('branchBuddy', folder?.uri)
        .update('group', value, target);
}

export async function setHeartbeatMs(value: number | undefined): Promise<void> {
    await vscode.workspace
        .getConfiguration('branchBuddy')
        .update('heartbeatMs', value, vscode.ConfigurationTarget.Global);
}

export async function setStaleMs(value: number | undefined): Promise<void> {
    await vscode.workspace
        .getConfiguration('branchBuddy')
        .update('staleMs', value, vscode.ConfigurationTarget.Global);
}

export async function setTrackingMode(value: TrackingMode | undefined): Promise<void> {
    await vscode.workspace
        .getConfiguration('branchBuddy')
        .update('trackingMode', value, vscode.ConfigurationTarget.Global);
}

export async function resetColors(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration();
    await cfg.update(COLOR_SECTION, undefined, vscode.ConfigurationTarget.Global);
    if (vscode.workspace.workspaceFolders) {
        await cfg.update(COLOR_SECTION, undefined, vscode.ConfigurationTarget.Workspace);
    }
}

/** Find the registry entry written by the current process/workspace pair. */
export function ourEntry(reg: Registry = readRegistry()): InstanceEntry | undefined {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return Object.values(reg.instances).find(
        e => e.pid === process.pid && (!ws || e.workspace === ws),
    );
}

/**
 * Wait until BranchSync has detected the fixture branch (or time out).
 * Matches GitWatcher's own startup poll budget (20 x 500ms = 10s).
 */
export async function waitForBranch(timeoutMs = 10_000): Promise<InstanceEntry> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const entry = ourEntry();
        if (entry && entry.branch) return entry;
        await sleep(100);
    }
    const gitExt = vscode.extensions.getExtension<{
        getAPI(v: 1): { repositories: unknown[] };
    }>('vscode.git');
    const repos = gitExt?.exports?.getAPI?.(1)?.repositories ?? '<extension not loaded>';
    throw new Error(
        `timed out waiting for BranchSync to detect a branch; ` +
            `last entry: ${JSON.stringify(ourEntry())}; ` +
            `vscode.git repositories: ${JSON.stringify(repos)}`,
    );
}

/** Trigger BranchSync's refresh command and wait briefly for it to settle. */
export async function refreshAndSettle(settleMs = 250): Promise<void> {
    await vscode.commands.executeCommand('branchBuddy.refresh');
    await sleep(settleMs);
}

// ---------- vscode.git API helpers ----------
//
// These drive the fixture repo through vscode.git's own API instead of the
// git CLI. Going through the extension's API guarantees the state-change
// event fires (vscode.git knows about its own actions), which is more
// reliable than CLI + fs.watch on Docker bind mounts where filesystem
// events can be lossy.

export interface MinimalGitRepo {
    rootUri: { fsPath: string };
    state: { HEAD?: { name?: string } };
    createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
    deleteBranch(name: string, force?: boolean): Promise<void>;
    checkout(treeish: string): Promise<void>;
}

interface MinimalGitApi {
    repositories: MinimalGitRepo[];
    onDidOpenRepository(cb: (r: MinimalGitRepo) => void): { dispose(): void };
}

export async function getFixtureRepo(timeoutMs = 10_000): Promise<MinimalGitRepo> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error('no workspace folder open');

    const ext = vscode.extensions.getExtension<{ getAPI(v: 1): MinimalGitApi }>('vscode.git');
    if (!ext) throw new Error('vscode.git extension not installed');
    const exports_ = ext.isActive ? ext.exports : await ext.activate();
    const api = exports_.getAPI(1);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const repo = api.repositories.find(r => r.rootUri.fsPath === folder.uri.fsPath);
        if (repo) return repo;
        await sleep(100);
    }
    throw new Error(
        `fixture repo never appeared in vscode.git api.repositories (looking for ${folder.uri.fsPath})`,
    );
}

/** Create a new branch and check it out. */
export async function gitCreateAndCheckout(branch: string): Promise<void> {
    const repo = await getFixtureRepo();
    await repo.createBranch(branch, true);
}

/** Check out an existing branch (no creation). */
export async function gitCheckout(branch: string): Promise<void> {
    const repo = await getFixtureRepo();
    await repo.checkout(branch);
}

/** Delete a branch by name. No-ops if the branch doesn't exist. */
export async function gitDeleteBranch(branch: string): Promise<void> {
    const repo = await getFixtureRepo();
    try {
        await repo.deleteBranch(branch, true);
    } catch {
        // ignore — branch may not exist
    }
}

/**
 * Reset the fixture repo back to `FIXTURE_BRANCH`, deleting any branches
 * a test may have created. Idempotent.
 */
export async function resetFixtureRepoToInitialBranch(
    extraBranchesToCleanUp: readonly string[] = [],
): Promise<void> {
    const repo = await getFixtureRepo();
    if (repo.state.HEAD?.name !== FIXTURE_BRANCH) {
        try {
            await repo.checkout(FIXTURE_BRANCH);
        } catch {
            // Already there, or the branch was renamed — proceed.
        }
    }
    for (const branch of extraBranchesToCleanUp) {
        await gitDeleteBranch(branch);
    }
}
