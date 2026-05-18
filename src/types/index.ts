/**
 * Shared types for Branch Sync.
 *
 * This module is intentionally free of any `vscode` import so that pure logic
 * (config snapshot, registry transformations, mismatch detection) can be unit
 * tested without mocking the editor API.
 */

export interface InstanceEntry {
    /** PID of the VS Code window's renderer/extension host process. */
    pid: number;
    /** Absolute fs path of the first workspace folder, or `<no-folder>`. */
    workspace: string;
    /** Current git branch in the primary repo, or null if unknown. */
    branch: string | null;
    /**
     * Project group this instance belongs to. Only instances with the same
     * non-empty group are compared against each other. Empty string means
     * the window opted out of comparison entirely.
     */
    group: string;
    /** Epoch ms of the last heartbeat. */
    updatedAt: number;
}

export interface Registry {
    instances: Record<string, InstanceEntry>;
}

export type MismatchReason =
    | 'no-group'    // this window isn't in any group → Branch Sync inactive
    | 'no-branch'   // this window doesn't know its branch yet
    | 'no-peers'    // no other live instance in the same group
    | 'evaluated';  // a real comparison ran (mismatch can be true or false)

export interface MismatchResult {
    mismatch: boolean;
    others: InstanceEntry[];
    reason: MismatchReason;
}

/** Minimal structural shape of a disposable. Matches `vscode.Disposable`. */
export interface DisposableLike {
    dispose(): void;
}

/** Minimal structural shape of a `vscode.git` repository. */
export interface GitRepoLike {
    rootUri: { fsPath: string };
    state: {
        HEAD?: { name?: string };
        onDidChange: (cb: () => void) => DisposableLike;
    };
}

/** Minimal structural shape of the `vscode.git` API v1. */
export interface GitApiLike {
    repositories: GitRepoLike[];
    onDidOpenRepository: (cb: (repo: GitRepoLike) => void) => DisposableLike;
    onDidCloseRepository: (cb: (repo: GitRepoLike) => void) => DisposableLike;
}
