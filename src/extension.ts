import * as vscode from 'vscode';
import { BranchSync } from './BranchSync';

/**
 * Branch Sync extension entry point. Kept intentionally tiny: it instantiates
 * the orchestrator and lets it own all subscriptions. Everything substantive
 * lives in modules under `src/{config,registry,detection,ui,git}`.
 */

let instance: BranchSync | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Integration test escape hatch: when set, the auto-activated instance
    // bows out so the test code can own the BranchSync lifecycle without
    // colliding on registered commands / shared registry entries.
    if (process.env.BRANCH_SYNC_DISABLE_AUTO_START) return;
    instance = await BranchSync.start(context);
}

export function deactivate(): void {
    instance?.dispose();
    instance = undefined;
}
