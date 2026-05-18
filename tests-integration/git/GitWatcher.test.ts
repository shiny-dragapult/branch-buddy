import * as assert from 'assert';
import * as vscode from 'vscode';
import { GitWatcher } from '../../src/git/GitWatcher';
import type { DisposableLike, GitApiLike, GitRepoLike } from '../../src/types';
import {
    FIXTURE_BRANCH,
    gitCheckout,
    gitCreateAndCheckout,
    resetFixtureRepoToInitialBranch,
    sleep,
    waitForCondition,
} from '../helpers/testEnv';

/**
 * Feature test for GitWatcher.
 *
 * Drives branch changes through the vscode.git API (`repo.createBranch`,
 * `repo.checkout`) instead of the git CLI. Going through vscode.git's own
 * API channel guarantees its state-change event fires; the CLI approach
 * depended on fs.watch over Docker bind mounts, which is lossy and made
 * these tests flaky.
 */

const SECONDARY_BRANCH = 'feat/test-checkout';
const TERTIARY_BRANCH = 'feat/another-checkout';

interface FakeGitApi extends GitApiLike {
    openRepo(repo: GitRepoLike): void;
    closeRepo(repo: GitRepoLike): void;
}

function fixtureDir(): string {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error('no workspace folder');
    return folder.uri.fsPath;
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

function disposable(onDispose?: () => void): DisposableLike {
    return {
        dispose: () => {
            onDispose?.();
        },
    };
}

function fakeRepo(fsPath: string, branch: string | null, onDispose?: () => void): GitRepoLike {
    const changeListeners: Array<() => void> = [];
    const state: GitRepoLike['state'] = {
        onDidChange: cb => {
            changeListeners.push(cb);
            return disposable(onDispose);
        },
    };
    if (branch !== null) {
        state.HEAD = { name: branch };
    }
    return {
        rootUri: { fsPath },
        state,
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

async function withFakeGitExtension<T>(
    extension:
        | undefined
        | {
            isActive: boolean;
            exports: { getAPI(v: 1): GitApiLike };
            activate(): Promise<{ getAPI(v: 1): GitApiLike }>;
        },
    run: () => Promise<T>,
): Promise<T> {
    const restore = replaceMethod(
        vscode.extensions,
        'getExtension',
        ((id: string) => {
            if (id === 'vscode.git') return extension;
            return undefined;
        }) as typeof vscode.extensions.getExtension,
    );
    try {
        return await run();
    } finally {
        restore();
    }
}

suite('GitWatcher (feature)', () => {
    let watcher: GitWatcher | undefined;

    suiteSetup(() => {
        assert.ok(
            vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0,
            'tests require the fixture workspace folder',
        );
    });

    setup(async () => {
        await resetFixtureRepoToInitialBranch([SECONDARY_BRANCH, TERTIARY_BRANCH]);
    });

    teardown(async () => {
        watcher?.dispose();
        watcher = undefined;
        await resetFixtureRepoToInitialBranch([SECONDARY_BRANCH, TERTIARY_BRANCH]);
    });

    test('attach() resolves with the current branch from the fixture repo', async () => {
        let observed: string | null | undefined;
        watcher = GitWatcher.make()
            .forWorkspaceFolder(fixtureDir())
            .onBranchChange(b => {
                observed = b;
            });
        await watcher.attach();

        await waitForCondition(
            () => observed === FIXTURE_BRANCH,
            5000,
            `observed branch to become ${FIXTURE_BRANCH}; last value: ${observed}`,
        );
        assert.strictEqual(watcher.currentBranch(), FIXTURE_BRANCH);
    });

    test('onBranchChange fires after createBranch(checkout=true)', async () => {
        const observed: (string | null)[] = [];
        watcher = GitWatcher.make()
            .forWorkspaceFolder(fixtureDir())
            .onBranchChange(b => observed.push(b));
        await watcher.attach();

        await waitForCondition(
            () => observed.includes(FIXTURE_BRANCH),
            5000,
            'initial branch event',
        );

        await gitCreateAndCheckout(SECONDARY_BRANCH);

        await waitForCondition(
            () => observed.includes(SECONDARY_BRANCH),
            5000,
            `observed branch to include ${SECONDARY_BRANCH}; saw: ${JSON.stringify(observed)}`,
        );
        assert.strictEqual(watcher.currentBranch(), SECONDARY_BRANCH);
    });

    test('multiple onBranchChange listeners all receive events', async () => {
        const a: (string | null)[] = [];
        const b: (string | null)[] = [];

        watcher = GitWatcher.make()
            .forWorkspaceFolder(fixtureDir())
            .onBranchChange(v => a.push(v))
            .onBranchChange(v => b.push(v));
        await watcher.attach();

        await waitForCondition(
            () => a.includes(FIXTURE_BRANCH) && b.includes(FIXTURE_BRANCH),
            5000,
            'both listeners observed the initial branch',
        );
    });

    test('switching back to the original branch reports it again', async () => {
        const observed: (string | null)[] = [];
        watcher = GitWatcher.make()
            .forWorkspaceFolder(fixtureDir())
            .onBranchChange(v => observed.push(v));
        await watcher.attach();
        await waitForCondition(() => observed.includes(FIXTURE_BRANCH), 5000, 'initial branch');

        await gitCreateAndCheckout(SECONDARY_BRANCH);
        await waitForCondition(
            () => observed.includes(SECONDARY_BRANCH),
            5000,
            `branch -> ${SECONDARY_BRANCH}`,
        );

        observed.length = 0;
        await gitCheckout(FIXTURE_BRANCH);
        await waitForCondition(
            () => observed.includes(FIXTURE_BRANCH),
            5000,
            `branch -> ${FIXTURE_BRANCH} again; saw: ${JSON.stringify(observed)}`,
        );
        assert.strictEqual(watcher.currentBranch(), FIXTURE_BRANCH);
    });

    test('dispose() stops further branch events from reaching the listener', async () => {
        const observed: (string | null)[] = [];
        watcher = GitWatcher.make()
            .forWorkspaceFolder(fixtureDir())
            .onBranchChange(v => observed.push(v));
        await watcher.attach();
        await waitForCondition(() => observed.includes(FIXTURE_BRANCH), 5000, 'initial branch');

        watcher.dispose();
        watcher = undefined;

        const snapshotBefore = [...observed];
        await gitCreateAndCheckout(TERTIARY_BRANCH);
        await sleep(500);

        assert.deepStrictEqual(
            observed,
            snapshotBefore,
            `no new events should have arrived after dispose; saw: ${JSON.stringify(observed)}`,
        );
    });

    test('currentBranch() returns null when called before attach()', () => {
        watcher = GitWatcher.make().forWorkspaceFolder(fixtureDir());
        assert.strictEqual(watcher.currentBranch(), null);
    });

    test('attach() is a safe no-op when vscode.git is unavailable', async () => {
        const warnings: unknown[][] = [];
        const restoreWarn = replaceMethod(console, 'warn', ((...args: unknown[]) => {
            warnings.push(args);
        }) as typeof console.warn);

        try {
            await withFakeGitExtension(undefined, async () => {
                watcher = GitWatcher.make()
                    .forWorkspaceFolder('/fake/workspace')
                    .onBranchChange(() => {
                        throw new Error('listener should not fire without vscode.git');
                    });

                const attached = await watcher.attach();
                assert.strictEqual(attached, watcher);
                assert.strictEqual(watcher.currentBranch(), null);
            });
        } finally {
            restoreWarn();
        }

        assert.ok(
            warnings.some(args => String(args[0]).includes('vscode.git extension not found')),
            `expected missing-git warning; saw ${JSON.stringify(warnings)}`,
        );
    });

    test('attach() activates an inactive git extension and falls back to the first repository', async () => {
        const primary = fakeRepo('/repo/one', 'first-branch');
        const secondary = fakeRepo('/repo/two', 'second-branch');
        const api = fakeApi([primary, secondary]);
        let activateCalls = 0;
        const observed: Array<string | null> = [];

        await withFakeGitExtension(
            {
                isActive: false,
                exports: { getAPI: () => { throw new Error('inactive exports should not be used'); } },
                activate: async () => {
                    activateCalls++;
                    return { getAPI: () => api };
                },
            },
            async () => {
                watcher = GitWatcher.make()
                    .forWorkspaceFolder('/repo/not-present')
                    .onBranchChange(v => observed.push(v));

                await watcher.attach();
            },
        );

        assert.strictEqual(activateCalls, 1);
        assert.strictEqual(watcher!.currentBranch(), 'first-branch');
        assert.ok(observed.includes('first-branch'), JSON.stringify(observed));
    });

    test('repository open and close events subscribe, dispose, and fire branch updates', async () => {
        let repoSubDisposed = 0;
        const initial = fakeRepo('/repo/initial', 'initial-branch');
        const opened = fakeRepo('/repo/opened', 'opened-branch', () => {
            repoSubDisposed++;
        });
        const api = fakeApi([initial]);
        const observed: Array<string | null> = [];

        await withFakeGitExtension(
            {
                isActive: true,
                exports: { getAPI: () => api },
                activate: async () => ({ getAPI: () => api }),
            },
            async () => {
                watcher = GitWatcher.make()
                    .forWorkspaceFolder('/repo/opened')
                    .onBranchChange(v => observed.push(v));

                await watcher.attach();
                api.openRepo(opened);
                assert.strictEqual(watcher.currentBranch(), 'opened-branch');

                api.closeRepo(opened);
                assert.strictEqual(watcher.currentBranch(), 'initial-branch');
            },
        );

        assert.strictEqual(repoSubDisposed, 1);
        assert.ok(observed.includes('opened-branch'), JSON.stringify(observed));
        assert.ok(observed.includes('initial-branch'), JSON.stringify(observed));
    });

    test('attach() polls briefly when repositories are initially empty', async () => {
        const api = fakeApi([]);
        const observed: Array<string | null> = [];

        await withFakeGitExtension(
            {
                isActive: true,
                exports: { getAPI: () => api },
                activate: async () => ({ getAPI: () => api }),
            },
            async () => {
                watcher = GitWatcher.make()
                    .forWorkspaceFolder('/repo/polled')
                    .onBranchChange(v => observed.push(v));

                await watcher.attach();
                assert.strictEqual(observed.length, 1);
                assert.strictEqual(observed[0], null);

                api.repositories.push(fakeRepo('/repo/polled', 'polled-branch'));
                await waitForCondition(
                    () => observed.includes('polled-branch'),
                    1500,
                    `poll to observe repository; saw ${JSON.stringify(observed)}`,
                );
            },
        );
    });
});
