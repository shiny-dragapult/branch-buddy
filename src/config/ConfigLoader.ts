import * as vscode from 'vscode';
import { Config, ConfigOptions, TrackingMode } from './Config';

/**
 * The only place in the codebase that reads the live `branchBuddy.*`
 * configuration from VS Code. Kept apart from `Config` itself so the value
 * class stays free of any `vscode` import and can be unit tested directly.
 */
export class ConfigLoader {
    private constructor() {}

    /** Read the live config, resolved against an optional workspace folder. */
    static read(folder?: vscode.Uri): Config {
        const cfg = vscode.workspace.getConfiguration('branchBuddy', folder);
        return Config.make({
            group: cfg.get<string>('group', ''),
            color: cfg.get<string>('color', '#c41e3a'),
            foreground: cfg.get<string>('foreground', '#ffffff'),
            groupColor: cfg.get<string>('groupColor', ''),
            heartbeatMs: cfg.get<number>('heartbeatMs', 5000),
            staleMs: cfg.get<number>('staleMs', 30000),
            trackingMode: cfg.get<TrackingMode>(
                'trackingMode',
                TrackingMode.FirstWorkspaceFolder,
            ),
        });
    }

    /** Convenience predicate for `onDidChangeConfiguration`. */
    static affects(
        e: vscode.ConfigurationChangeEvent,
        key: keyof ConfigOptions,
    ): boolean {
        return e.affectsConfiguration(`branchBuddy.${key}`);
    }
}
