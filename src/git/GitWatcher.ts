import * as vscode from 'vscode';
import { DisposableLike, GitApiLike, GitRepoLike } from '../types';

export type BranchChangeListener = (branch: string | null) => void;

/**
 * Wraps the built-in `vscode.git` extension API and emits branch updates
 * for the primary workspace repo.
 *
 *     const git = await GitWatcher.make()
 *         .forWorkspaceFolder(folder?.uri.fsPath)
 *         .onBranchChange(branch => coordinator.handleBranchChange(branch))
 *         .attach();
 */
export class GitWatcher {
    private api: GitApiLike | undefined;
    private listeners: BranchChangeListener[] = [];
    private disposables: DisposableLike[] = [];
    private repoSubs = new Map<unknown, DisposableLike>();
    private primaryFolder: string | undefined;

    private constructor() {}

    static make(): GitWatcher {
        return new GitWatcher();
    }

    forWorkspaceFolder(fsPath: string | undefined): this {
        this.primaryFolder = fsPath;
        return this;
    }

    onBranchChange(cb: BranchChangeListener): this {
        this.listeners.push(cb);
        return this;
    }

    async attach(): Promise<this> {
        const ext = vscode.extensions.getExtension<{ getAPI(v: 1): GitApiLike }>('vscode.git');
        if (!ext) {
            console.warn('[branch-buddy] vscode.git extension not found');
            return this;
        }
        const exports_ = ext.isActive ? ext.exports : await ext.activate();
        this.api = exports_.getAPI(1);

        for (const repo of this.api.repositories) this.subscribeToRepo(repo);

        this.disposables.push(
            this.api.onDidOpenRepository(repo => {
                this.subscribeToRepo(repo);
                this.fire();
            }),
            this.api.onDidCloseRepository(repo => {
                const sub = this.repoSubs.get(repo);
                if (sub) {
                    sub.dispose();
                    this.repoSubs.delete(repo);
                }
                this.fire();
            }),
        );

        // Repositories may still be loading on cold start — poll briefly.
        this.fire();
        if (this.api.repositories.length === 0) {
            let tries = 0;
            const poll = setInterval(() => {
                tries++;
                this.fire();
                if ((this.api && this.api.repositories.length > 0) || tries > 20) {
                    clearInterval(poll);
                }
            }, 500);
            this.disposables.push({ dispose: () => clearInterval(poll) });
        }

        return this;
    }

    currentBranch(): string | null {
        const repo = this.pickPrimaryRepo();
        return repo?.state?.HEAD?.name ?? null;
    }

    currentBranchForWorkspaceFolder(fsPath: string | undefined): string | null {
        if (!fsPath) return this.currentBranch();
        const repo = this.pickRepoForWorkspaceFolder(fsPath);
        return repo?.state?.HEAD?.name ?? null;
    }

    dispose(): void {
        for (const d of this.disposables) d.dispose();
        for (const sub of this.repoSubs.values()) sub.dispose();
        this.disposables = [];
        this.repoSubs.clear();
    }

    private pickPrimaryRepo(): GitRepoLike | undefined {
        if (!this.api || this.api.repositories.length === 0) return undefined;
        if (this.primaryFolder) {
            const match = this.pickRepoForWorkspaceFolder(this.primaryFolder);
            if (match) return match;
        }
        return this.api.repositories[0];
    }

    private pickRepoForWorkspaceFolder(fsPath: string): GitRepoLike | undefined {
        if (!this.api) return undefined;
        return this.api.repositories.find(r => r.rootUri.fsPath === fsPath);
    }

    private subscribeToRepo(repo: GitRepoLike): void {
        if (this.repoSubs.has(repo)) return;
        const sub = repo.state.onDidChange(() => this.fire());
        this.repoSubs.set(repo, sub);
    }

    private fire(): void {
        const branch = this.currentBranch();
        for (const cb of this.listeners) cb(branch);
    }
}
