import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BranchSync } from '../../src/BranchSync';
import { TrackingMode } from '../../src/config/Config';
import type { DisposableLike, GitApiLike, GitRepoLike } from '../../src/types';
import {
    FIXTURE_BRANCH,
    MANAGED_BG_KEY,
    REGISTRY_PATH,
    clearRegistry,
    effectiveColors,
    fakeContext,
    injectPeer,
    ourEntry,
    readRegistry,
    refreshAndSettle,
    resetColors,
    setGroup,
    setHeartbeatMs,
    setStaleMs,
    setTrackingMode,
    sleep,
    waitForBranch,
    waitForCondition,
    writeRegistry,
} from '../helpers/testEnv';

interface FakeGitApi extends GitApiLike {
    openRepo(repo: GitRepoLike): void;
    closeRepo(repo: GitRepoLike): void;
}

function replaceMethod<T extends object, K extends keyof T>(
    target: T,
    key: K,
    value: T[K],
): () => void {
    const original = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, {
        configurable: true,
        value,
    });
    return () => {
        if (original) {
            Object.defineProperty(target, key, original);
        } else {
            delete (target as Record<PropertyKey, unknown>)[key as PropertyKey];
        }
    };
}

function disposable(): DisposableLike {
    return { dispose: () => {} };
}

function fakeRepo(fsPath: string, branch: string): GitRepoLike {
    return {
        rootUri: { fsPath },
        state: {
            HEAD: { name: branch },
            onDidChange: () => disposable(),
        },
    };
}

function fakeApi(initialRepos: GitRepoLike[]): FakeGitApi {
    const openListeners: Array<(repo: GitRepoLike) => void> = [];
    const closeListeners: Array<(repo: GitRepoLike) => void> = [];
    return {
        repositories: [...initialRepos],
        onDidOpenRepository: cb => {
            openListeners.push(cb);
            return disposable();
        },
        onDidCloseRepository: cb => {
            closeListeners.push(cb);
            return disposable();
        },
        openRepo(repo: GitRepoLike): void {
            this.repositories.push(repo);
            for (const cb of openListeners) cb(repo);
        },
        closeRepo(repo: GitRepoLike): void {
            this.repositories = this.repositories.filter(r => r !== repo);
            for (const cb of closeListeners) cb(repo);
        },
    };
}

function fakeWorkspaceFolder(fsPath: string, index: number): vscode.WorkspaceFolder {
    return {
        uri: vscode.Uri.file(fsPath),
        name: path.basename(fsPath),
        index,
    };
}

suite('BranchSync lifecycle (feature)', () => {
    let instance: BranchSync | undefined;

    suiteSetup(async () => {
        assert.ok(
            process.env.BRANCH_SYNC_DISABLE_AUTO_START,
            'BRANCH_SYNC_DISABLE_AUTO_START must be set so the extension does not auto-start a competing BranchSync',
        );
        assert.ok(
            vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0,
            'tests require the fixture workspace folder',
        );
    });

    setup(async () => {
        await setGroup(undefined);
        await setHeartbeatMs(undefined);
        await setStaleMs(undefined);
        await setTrackingMode(undefined);
        await resetColors();
        clearRegistry();
    });

    teardown(async () => {
        if (instance) {
            instance.dispose();
            instance = undefined;
        }
        await setGroup(undefined);
        await setHeartbeatMs(undefined);
        await setStaleMs(undefined);
        await setTrackingMode(undefined);
        await resetColors();
        clearRegistry();
    });

    test('start() writes our entry into the registry', async () => {
        await setGroup('lifecycle-test');
        instance = await BranchSync.start(fakeContext());

        const entry = ourEntry();
        assert.ok(entry, 'our entry should be present after start()');
        assert.strictEqual(entry?.group, 'lifecycle-test');
        assert.strictEqual(entry?.pid, process.pid);
    });

    test('start() uses the shared OS temp registry and pid+uuid instance key', async () => {
        await setGroup('lifecycle-test');
        instance = await BranchSync.start(fakeContext());

        assert.strictEqual(
            REGISTRY_PATH,
            path.join(os.tmpdir(), 'vscode-branch-buddy', 'registry.json'),
        );
        assert.strictEqual(fs.existsSync(REGISTRY_PATH), true, 'registry file should exist');

        const keys = Object.keys(readRegistry().instances);
        assert.strictEqual(keys.length, 1);
        const key = keys[0];
        assert.ok(key, 'registry key should be present');
        assert.match(
            key,
            new RegExp(`^${process.pid}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`),
            'instance registry key should be pid + uuid',
        );
    });

    test('start() reports the first workspace folder repo when other repos are visible', async () => {
        const firstFolder = fakeWorkspaceFolder('/branch-sync-first-folder', 0);
        const secondFolder = fakeWorkspaceFolder('/branch-sync-second-folder', 1);
        const firstRepo = fakeRepo(firstFolder.uri.fsPath, 'first-folder-branch');
        const secondRepo = fakeRepo(secondFolder.uri.fsPath, 'second-folder-branch');
        const nestedRepo = fakeRepo(
            path.join(firstFolder.uri.fsPath, 'nested-checkout'),
            'nested-branch',
        );
        const api = fakeApi([nestedRepo, secondRepo, firstRepo]);

        const restoreFolders = replaceMethod(
            vscode.workspace,
            'workspaceFolders',
            [firstFolder, secondFolder],
        );
        const restoreGit = replaceMethod(
            vscode.extensions,
            'getExtension',
            ((id: string) => {
                if (id === 'vscode.git') {
                    return {
                        isActive: true,
                        exports: { getAPI: () => api },
                        activate: async () => ({ getAPI: () => api }),
                    };
                }
                return undefined;
            }) as typeof vscode.extensions.getExtension,
        );
        try {
            instance = await BranchSync.start(fakeContext());

            await waitForCondition(
                () => {
                    const entries = Object.values(readRegistry().instances);
                    return entries.some(
                        entry =>
                            entry.pid === process.pid &&
                            entry.workspace === firstFolder.uri.fsPath &&
                            entry.branch === 'first-folder-branch',
                    );
                },
                1000,
                'registry entry for the first workspace folder repo',
            );
        } finally {
            restoreGit();
            restoreFolders();
        }
    });

    test('start() tracks and highlights every workspace folder when trackingMode is allWorkspaceFolders', async () => {
        const firstFolder = fakeWorkspaceFolder('/branch-sync-first-folder', 0);
        const secondFolder = fakeWorkspaceFolder('/branch-sync-second-folder', 1);
        const firstRepo = fakeRepo(firstFolder.uri.fsPath, 'first-folder-branch');
        const secondRepo = fakeRepo(secondFolder.uri.fsPath, 'second-folder-branch');
        const api = fakeApi([secondRepo, firstRepo]);
        const originalGetConfiguration = vscode.workspace.getConfiguration.bind(vscode.workspace);

        const restoreFolders = replaceMethod(
            vscode.workspace,
            'workspaceFolders',
            [firstFolder, secondFolder],
        );
        const restoreConfig = replaceMethod(
            vscode.workspace,
            'getConfiguration',
            ((section?: string, scope?: vscode.ConfigurationScope | null) => {
                const cfg = originalGetConfiguration(section, scope);
                if (section !== 'branchBuddy') return cfg;
                return {
                    ...cfg,
                    get: <T>(key: string, defaultValue?: T): T => {
                        if (key === 'group') return 'multi-root-group' as T;
                        if (key === 'trackingMode') return TrackingMode.AllWorkspaceFolders as T;
                        return cfg.get(key, defaultValue) as T;
                    },
                    has: cfg.has.bind(cfg),
                    inspect: cfg.inspect.bind(cfg),
                    update: cfg.update.bind(cfg),
                };
            }) as typeof vscode.workspace.getConfiguration,
        );
        const restoreGit = replaceMethod(
            vscode.extensions,
            'getExtension',
            ((id: string) => {
                if (id === 'vscode.git') {
                    return {
                        isActive: true,
                        exports: { getAPI: () => api },
                        activate: async () => ({ getAPI: () => api }),
                    };
                }
                return undefined;
            }) as typeof vscode.extensions.getExtension,
        );
        try {
            instance = await BranchSync.start(fakeContext());

            await waitForCondition(
                () => {
                    const entries = Object.values(readRegistry().instances).filter(
                        entry => entry.pid === process.pid,
                    );
                    return (
                        entries.length === 2 &&
                        entries.some(
                            entry =>
                                entry.workspace === firstFolder.uri.fsPath &&
                                entry.branch === 'first-folder-branch' &&
                                entry.group === 'multi-root-group',
                        ) &&
                        entries.some(
                            entry =>
                                entry.workspace === secondFolder.uri.fsPath &&
                                entry.branch === 'second-folder-branch' &&
                                entry.group === 'multi-root-group',
                        )
                    );
                },
                1000,
                'registry entries for every workspace folder repo',
            );
            await waitForCondition(
                () => effectiveColors()[MANAGED_BG_KEY] !== undefined,
                3000,
                'red applied for diverged workspace folders in the same group',
            );
        } finally {
            restoreGit();
            restoreConfig();
            restoreFolders();
        }
    });

    test('GitWatcher attach() fills in the branch from the fixture repo', async () => {
        await setGroup('lifecycle-test');
        instance = await BranchSync.start(fakeContext());

        const entry = await waitForBranch();
        assert.strictEqual(entry.branch, FIXTURE_BRANCH);
    });

    test('dispose() removes our entry from the registry', async () => {
        await setGroup('lifecycle-test');
        instance = await BranchSync.start(fakeContext());
        assert.ok(ourEntry(), 'precondition: entry present');

        instance.dispose();
        instance = undefined;

        assert.strictEqual(ourEntry(), undefined, 'entry should be gone after dispose()');
    });

    test('dispose() clears red colors that the instance applied', async () => {
        await setGroup('lifecycle-test');
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        injectPeer({ group: 'lifecycle-test', branch: 'totally-different-branch' });

        await refreshAndSettle();
        await waitForCondition(
            () => effectiveColors()[MANAGED_BG_KEY] !== undefined,
            3000,
            'red applied after refresh',
        );

        instance.dispose();
        instance = undefined;

        await waitForCondition(
            () => effectiveColors()[MANAGED_BG_KEY] === undefined,
            3000,
            'red cleared after dispose',
        );
    });

    test('clearing branchBuddy.group clears active red and removes the alert state', async () => {
        await setGroup('lifecycle-test');
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        injectPeer({ group: 'lifecycle-test', branch: 'totally-different-branch' });

        await refreshAndSettle();
        await waitForCondition(
            () => effectiveColors()[MANAGED_BG_KEY] !== undefined,
            3000,
            'red applied',
        );

        await setGroup('');
        await waitForCondition(
            () => effectiveColors()[MANAGED_BG_KEY] === undefined,
            3000,
            'red cleared after group went empty',
        );

        assert.strictEqual(ourEntry()?.group, '');
    });

    test('reconfiguring heartbeatMs actually changes the cadence', async () => {
        await setGroup('lifecycle-test');
        await setHeartbeatMs(10_000);
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        const initial = ourEntry()!;
        await sleep(500);
        const slow = ourEntry()!;
        const slowAdvancedBy = slow.updatedAt - initial.updatedAt;

        await setHeartbeatMs(150);

        const fastBefore = ourEntry()!.updatedAt;
        await sleep(600);
        const fastAfter = ourEntry()!.updatedAt;
        const fastAdvancedBy = fastAfter - fastBefore;

        assert.ok(
            fastAdvancedBy > slowAdvancedBy,
            `expected the fast cadence to advance updatedAt faster than the slow one ` +
                `(slow advanced ${slowAdvancedBy}ms in 500ms, fast advanced ${fastAdvancedBy}ms in 600ms)`,
        );
        assert.ok(
            fastAdvancedBy >= 100,
            `expected updatedAt to advance by at least one fast-cadence tick; advanced ${fastAdvancedBy}ms`,
        );
    });

    test('stale peer entries are pruned by the next own-entry write', async () => {
        await setGroup('lifecycle-test');
        await setStaleMs(200);

        writeRegistry({
            instances: {
                'stale-peer': {
                    pid: 1,
                    workspace: '/x',
                    branch: 'main',
                    group: 'lifecycle-test',
                    updatedAt: Date.now() - 10_000,
                },
            },
        });

        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        const reg = readRegistry();
        assert.ok(!('stale-peer' in reg.instances), 'stale peer should be pruned');
    });

    test('showStatus command reports this window and registered peers', async () => {
        await setGroup('lifecycle-test');
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();

        injectPeer({
            id: 'status-peer',
            group: 'lifecycle-test',
            branch: 'feat/status-peer',
            workspace: '/tmp/status-peer-workspace',
            updatedAt: Date.now() - 2500,
        });

        let shown: string | undefined;
        const restore = replaceMethod(
            vscode.window,
            'showInformationMessage',
            ((message: string) => {
                shown = message;
                return Promise.resolve(undefined);
            }) as typeof vscode.window.showInformationMessage,
        );
        try {
            await vscode.commands.executeCommand('branchBuddy.showStatus');
        } finally {
            restore();
        }

        assert.ok(shown, 'status message should be shown');
        assert.ok(shown.includes('group=lifecycle-test'), shown);
        assert.ok(shown.includes(`branch=${FIXTURE_BRANCH}`), shown);
        assert.ok(shown.includes('[lifecycle-test] feat/status-peer'), shown);
        assert.ok(shown.includes('status-peer-workspace'), shown);
        assert.ok(shown.includes('(this window)'), shown);
    });

    test('showStatus command handles an empty registry', async () => {
        await setGroup('lifecycle-test');
        instance = await BranchSync.start(fakeContext());
        await waitForBranch();
        clearRegistry();

        let shown: string | undefined;
        const restore = replaceMethod(
            vscode.window,
            'showInformationMessage',
            ((message: string) => {
                shown = message;
                return Promise.resolve(undefined);
            }) as typeof vscode.window.showInformationMessage,
        );
        try {
            await vscode.commands.executeCommand('branchBuddy.showStatus');
        } finally {
            restore();
        }

        assert.ok(shown?.includes('No instances registered yet.'), shown);
    });

    test('setGroup command saves a trimmed workspace-folder group', async () => {
        await setGroup('before-command');
        instance = await BranchSync.start(fakeContext());

        const restore = replaceMethod(
            vscode.window,
            'showInputBox',
            (() => Promise.resolve('  command-group  ')) as typeof vscode.window.showInputBox,
        );
        try {
            await vscode.commands.executeCommand('branchBuddy.setGroup');
        } finally {
            restore();
        }

        const folder = vscode.workspace.workspaceFolders?.[0];
        const value = vscode.workspace
            .getConfiguration('branchBuddy', folder?.uri)
            .get<string>('group');
        assert.strictEqual(value, 'command-group');
    });

    test('setGroup command leaves configuration untouched when cancelled', async () => {
        await setGroup('before-cancel');
        instance = await BranchSync.start(fakeContext());

        const restore = replaceMethod(
            vscode.window,
            'showInputBox',
            (() => Promise.resolve(undefined)) as typeof vscode.window.showInputBox,
        );
        try {
            await vscode.commands.executeCommand('branchBuddy.setGroup');
        } finally {
            restore();
        }

        const folder = vscode.workspace.workspaceFolders?.[0];
        const value = vscode.workspace
            .getConfiguration('branchBuddy', folder?.uri)
            .get<string>('group');
        assert.strictEqual(value, 'before-cancel');
    });

    test('setGroup command reports configuration write failures', async () => {
        await setGroup('before-error');
        instance = await BranchSync.start(fakeContext());

        let errorMessage: string | undefined;
        const restoreInput = replaceMethod(
            vscode.window,
            'showInputBox',
            (() => Promise.resolve('after-error')) as typeof vscode.window.showInputBox,
        );
        const restoreError = replaceMethod(
            vscode.window,
            'showErrorMessage',
            ((message: string) => {
                errorMessage = message;
                return Promise.resolve(undefined);
            }) as typeof vscode.window.showErrorMessage,
        );
        const originalGetConfiguration = vscode.workspace.getConfiguration.bind(vscode.workspace);
        const restoreConfig = replaceMethod(
            vscode.workspace,
            'getConfiguration',
            ((section?: string, scope?: vscode.ConfigurationScope | null) => {
                const cfg = originalGetConfiguration(section, scope);
                if (section !== 'branchBuddy') return cfg;
                return {
                    ...cfg,
                    get: cfg.get.bind(cfg),
                    has: cfg.has.bind(cfg),
                    inspect: cfg.inspect.bind(cfg),
                    update: async () => {
                        throw new Error('simulated write failure');
                    },
                };
            }) as typeof vscode.workspace.getConfiguration,
        );

        try {
            await vscode.commands.executeCommand('branchBuddy.setGroup');
        } finally {
            restoreConfig();
            restoreError();
            restoreInput();
        }

        assert.ok(errorMessage?.includes('failed to save group'), errorMessage);
        assert.ok(errorMessage?.includes('simulated write failure'), errorMessage);
    });
});
