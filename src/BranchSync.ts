import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { TrackingMode } from './config/Config';
import { ConfigLoader } from './config/ConfigLoader';
import { MismatchDetector } from './detection/MismatchDetector';
import { GitWatcher } from './git/GitWatcher';
import { InstanceEntryBuilder } from './registry/InstanceEntryBuilder';
import { RegistryOps } from './registry/RegistryOps';
import { RegistryStore } from './registry/RegistryStore';
import { LocalEntry } from './types/BranchSyncTypes';
import { GroupStatusBar } from './ui/GroupStatusBar';
import { WindowColorizer } from './ui/WindowColorizer';

/**
 * Orchestrator. Owns the lifecycle of every collaborator and translates VS
 * Code events into calls on them. Kept thin on purpose — all the substantive
 * logic lives in the modules under `config/`, `registry/`, `detection/`,
 * `ui/`, and `git/`.
 */
export class BranchSync {
    private readonly instanceId: string;
    private readonly registry: RegistryStore;
    private readonly colorizer: WindowColorizer;
    private readonly git: GitWatcher;
    private statusBar: GroupStatusBar | undefined;
    private currentBranch: string | null = null;
    private heartbeatTimer: NodeJS.Timeout | undefined;
    private checkScheduled = false;
    private disposed = false;
    private disposables: vscode.Disposable[] = [];
    private ownEntryIds = new Set<string>();

    private constructor() {
        this.instanceId = `${process.pid}-${crypto.randomUUID()}`;
        this.registry = RegistryStore.at(
            path.join(os.tmpdir(), 'vscode-branch-buddy', 'registry.json'),
        );
        const cfg = ConfigLoader.read();
        this.colorizer = WindowColorizer.make()
            .background(cfg.color)
            .foreground(cfg.foreground);
        this.git = GitWatcher.make()
            .forWorkspaceFolder(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath)
            .onBranchChange(b => this.handleBranchChange(b));
    }

    static async start(context: vscode.ExtensionContext): Promise<BranchSync> {
        const self = new BranchSync();
        self.registry.ensureDir();
        self.writeOwnEntry();
        self.installRegistryWatcher();
        self.installStatusBar();
        self.installHeartbeat();
        await self.git.attach();
        self.installConfigListener();
        self.installCommands();
        self.installShutdownHook();
        context.subscriptions.push({ dispose: () => self.dispose() });
        return self;
    }

    dispose(): void {
        // Flip the flag *before* the disposable loop so any setTimeout /
        // setInterval callback that fires while we're tearing down sees it
        // and bails. Without this, a queued scheduleCheck timeout can fire
        // between the shutdown hook clearing red and dispose() returning,
        // and re-apply red because the peer is still in the registry.
        this.disposed = true;
        for (const d of this.disposables) d.dispose();
        this.disposables = [];
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.statusBar?.dispose();
        this.git.dispose();
    }

    // ---------- internal wiring ----------

    private folderUri(): vscode.Uri | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri;
    }

    private workspacePath(): string {
        return this.folderUri()?.fsPath ?? '<no-folder>';
    }

    private localEntries(): LocalEntry[] {
        const windowCfg = ConfigLoader.read();
        const folders = vscode.workspace.workspaceFolders ?? [];

        if (
            windowCfg.trackingMode === TrackingMode.AllWorkspaceFolders &&
            folders.length > 0
        ) {
            return folders.map(folder => {
                const cfg = ConfigLoader.read(folder.uri);
                return {
                    id: this.entryIdForFolder(folder),
                    uri: folder.uri,
                    workspace: folder.uri.fsPath,
                    branch: this.git.currentBranchForWorkspaceFolder(folder.uri.fsPath),
                    cfg,
                };
            });
        }

        const uri = this.folderUri();
        const cfg = ConfigLoader.read(uri);
        return [
            {
                id: this.instanceId,
                uri,
                workspace: this.workspacePath(),
                branch: this.currentBranch,
                cfg,
            },
        ];
    }

    private entryIdForFolder(folder: vscode.WorkspaceFolder): string {
        return `${this.instanceId}:${folder.index}:${folder.uri.fsPath}`;
    }

    private writeOwnEntry(): void {
        const entries = this.localEntries();
        const staleMs = entries[0]?.cfg.staleMs ?? ConfigLoader.read().staleMs;
        const nextIds = new Set(entries.map(e => e.id));
        let ops = RegistryOps.of(this.registry.read()).pruneStale(Date.now(), staleMs);

        for (const id of this.ownEntryIds) {
            if (!nextIds.has(id)) ops = ops.remove(id);
        }
        for (const local of entries) {
            const entry = InstanceEntryBuilder.make()
                .branch(local.branch)
                .group(local.cfg.group)
                .workspace(local.workspace)
                .build();
            ops = ops.upsert(local.id, entry);
        }

        this.ownEntryIds = nextIds;
        const next = ops.toRegistry();
        this.registry.write(next);
    }

    private removeOwnEntry(): void {
        let ops = RegistryOps.of(this.registry.read()).remove(this.instanceId);
        for (const id of this.ownEntryIds) ops = ops.remove(id);
        const next = ops.toRegistry();
        this.registry.write(next);
        this.ownEntryIds.clear();
    }

    private handleBranchChange(branch: string | null): void {
        const changed = branch !== this.currentBranch;
        this.currentBranch = branch;
        this.writeOwnEntry();
        if (changed) this.refreshStatusBar();
        this.scheduleCheck();
    }

    private installRegistryWatcher(): void {
        const w = this.registry.ensureFile().watch(() => this.scheduleCheck());
        if (w) this.disposables.push({ dispose: () => w.dispose() });
    }

    private installStatusBar(): void {
        this.statusBar = GroupStatusBar.create();
        this.refreshStatusBar();
    }

    private refreshStatusBar(): void {
        if (!this.statusBar) return;
        const entries = this.localEntries();
        const groups = [...new Set(entries.map(e => e.cfg.group).filter(Boolean))];
        const primary = entries.find(e => e.cfg.group) ?? entries[0];
        const group = groups.length > 1 ? `${groups.length} groups` : (groups[0] ?? '');
        const branch = entries.length === 1 ? entries[0]?.branch ?? null : null;
        this.statusBar
            .color(primary?.cfg.groupColor)
            .update({ group, branch });
    }

    private installHeartbeat(): void {
        this.restartHeartbeat();
    }

    private restartHeartbeat(): void {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        const cfg = ConfigLoader.read();
        this.heartbeatTimer = setInterval(() => {
            if (this.disposed) return;
            this.writeOwnEntry();
            this.scheduleCheck();
        }, cfg.heartbeatMs);
    }

    private scheduleCheck(): void {
        if (this.disposed) return;
        if (this.checkScheduled) return;
        this.checkScheduled = true;
        setTimeout(() => {
            this.checkScheduled = false;
            if (this.disposed) return;
            void this.checkAndApplyColors();
        }, 150);
    }

    private async checkAndApplyColors(): Promise<void> {
        if (this.disposed) return;
        const entries = this.localEntries();
        const reg = this.registry.read();
        const result = entries
            .map(local =>
                MismatchDetector.make()
                    .myId(local.id)
                    .myBranch(local.branch)
                    .myGroup(local.cfg.group)
                    .now(Date.now())
                    .staleMs(local.cfg.staleMs)
                    .check(reg),
            )
            .find(r => r.mismatch);
        const cfg = entries[0]?.cfg ?? ConfigLoader.read(this.folderUri());

        if (result && !this.colorizer.isApplied) {
            await this.colorizer
                .background(cfg.color)
                .foreground(cfg.foreground)
                .apply();
        } else if (!result && this.colorizer.isApplied) {
            await this.colorizer.clear();
        }
    }

    private installConfigListener(): void {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (!e.affectsConfiguration('branchBuddy')) return;
                if (e.affectsConfiguration('branchBuddy.heartbeatMs')) {
                    this.restartHeartbeat();
                }
                if (
                    e.affectsConfiguration('branchBuddy.group') ||
                    e.affectsConfiguration('branchBuddy.trackingMode')
                ) {
                    this.writeOwnEntry();
                }
                if (
                    e.affectsConfiguration('branchBuddy.group') ||
                    e.affectsConfiguration('branchBuddy.groupColor') ||
                    e.affectsConfiguration('branchBuddy.trackingMode')
                ) {
                    this.refreshStatusBar();
                }
                if (this.colorizer.isApplied) {
                    const cfg = ConfigLoader.read();
                    void this.colorizer
                        .background(cfg.color)
                        .foreground(cfg.foreground)
                        .apply();
                }
                this.scheduleCheck();
            }),
        );
    }

    private installCommands(): void {
        this.disposables.push(
            vscode.commands.registerCommand('branchBuddy.refresh', () => {
                this.writeOwnEntry();
                void this.checkAndApplyColors();
            }),
            vscode.commands.registerCommand('branchBuddy.showStatus', () => this.showStatus()),
            vscode.commands.registerCommand('branchBuddy.setGroup', () => this.promptForGroup()),
        );
    }

    private installShutdownHook(): void {
        this.disposables.push({
            dispose: () => {
                this.removeOwnEntry();
                if (this.colorizer.isApplied) void this.colorizer.clear();
            },
        });
    }

    private showStatus(): void {
        const reg = this.registry.read();
        const cfg = ConfigLoader.read(this.folderUri());
        const lines = Object.entries(reg.instances).map(([id, e]) => {
            const self =
                id === this.instanceId || this.ownEntryIds.has(id) ? ' (this window)' : '';
            const age = Math.round((Date.now() - e.updatedAt) / 1000);
            const group = e.group ? `[${e.group}]` : '[no group]';
            return `• ${group} ${e.branch ?? '<unknown>'} — ${path.basename(e.workspace)} (pid ${e.pid}, ${age}s ago)${self}`;
        });
        const header = `Branch Sync — this window: group=${cfg.group || '<none>'}, branch=${this.currentBranch ?? '<unknown>'}`;
        const body = lines.length ? lines.join('\n') : 'No instances registered yet.';
        void vscode.window.showInformationMessage(`${header}\n${body}`, { modal: true });
    }

    private async promptForGroup(): Promise<void> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        const current = ConfigLoader.read(folder?.uri).group;
        const next = await vscode.window.showInputBox({
            title: 'Branch Sync — group for this workspace',
            prompt:
                'Set a group name shared by all repos that belong to the same project (e.g. "acme-app"). Leave empty to disable Branch Sync for this window.',
            value: current,
            placeHolder: 'acme-app',
        });
        if (next === undefined) return;
        const target = folder
            ? vscode.ConfigurationTarget.WorkspaceFolder
            : vscode.ConfigurationTarget.Workspace;
        try {
            await vscode.workspace
                .getConfiguration('branchBuddy', folder?.uri)
                .update('group', next.trim() || undefined, target);
        } catch (err) {
            void vscode.window.showErrorMessage(`Branch Sync: failed to save group — ${err}`);
        }
    }
}
