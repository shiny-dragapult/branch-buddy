import * as vscode from 'vscode';

/**
 * Color customization keys we manage. We only touch these and remember
 * exactly which keys we set, so we can clear them later without disturbing
 * any other customizations the user has in their settings.
 *
 * Note the asymmetric casing: VS Code uses `titleBar.activeBackground`
 * (camelCase) but `statusBar.background` (lowercase). Both spellings live
 * here verbatim.
 */
const BACKGROUND_KEYS = [
    'titleBar.activeBackground',
    'titleBar.inactiveBackground',
    'statusBar.background',
    'activityBar.background',
] as const;

const FOREGROUND_KEYS = [
    'titleBar.activeForeground',
    'titleBar.inactiveForeground',
    'statusBar.foreground',
    'activityBar.foreground',
] as const;

const MANAGED_KEYS: readonly string[] = [...BACKGROUND_KEYS, ...FOREGROUND_KEYS];

/**
 * Applies / clears the "mismatch" red coloring on the title, status and
 * activity bars via `workbench.colorCustomizations`.
 *
 *     const colorizer = WindowColorizer.make()
 *         .background('#c41e3a')
 *         .foreground('#ffffff');
 *     await colorizer.apply();
 *     // ...later...
 *     await colorizer.clear();
 */
export class WindowColorizer {
    private _bg = '#c41e3a';
    private _fg = '#ffffff';
    private _applied = false;

    private constructor() {}

    static make(): WindowColorizer {
        return new WindowColorizer();
    }

    background(v: string): this {
        this._bg = v;
        return this;
    }

    foreground(v: string): this {
        this._fg = v;
        return this;
    }

    get isApplied(): boolean {
        return this._applied;
    }

    async apply(): Promise<void> {
        const cfg = vscode.workspace.getConfiguration();
        const existing = {
            ...(cfg.get<Record<string, string>>('workbench.colorCustomizations') ?? {}),
        };
        for (const k of BACKGROUND_KEYS) existing[k] = this._bg;
        for (const k of FOREGROUND_KEYS) existing[k] = this._fg;
        try {
            await cfg.update('workbench.colorCustomizations', existing, this.target());
            this._applied = true;
        } catch (err) {
            console.error('[branch-buddy] failed to apply colors', err);
        }
    }

    async clear(): Promise<void> {
        const cfg = vscode.workspace.getConfiguration();
        const existing = {
            ...(cfg.get<Record<string, string>>('workbench.colorCustomizations') ?? {}),
        };
        for (const k of MANAGED_KEYS) delete existing[k];
        try {
            await cfg.update(
                'workbench.colorCustomizations',
                Object.keys(existing).length ? existing : undefined,
                this.target(),
            );
            this._applied = false;
        } catch (err) {
            console.error('[branch-buddy] failed to clear colors', err);
        }
    }

    private target(): vscode.ConfigurationTarget {
        return vscode.workspace.workspaceFolders
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
    }
}
