import { ConfigOptions, TrackingMode } from './ConfigTypes';

/**
 * Immutable snapshot of the `branchBuddy.*` configuration.
 *
 * This file is intentionally free of any `vscode` import so it can be unit
 * tested directly. The companion `ConfigLoader` (which does import vscode)
 * is the only place that reads the live config from the editor.
 */
export class Config {
    readonly group: string;
    readonly color: string;
    readonly foreground: string;
    readonly groupColor: string | undefined;
    readonly heartbeatMs: number;
    readonly staleMs: number;
    readonly trackingMode: TrackingMode;

    private constructor(opts: Required<Omit<ConfigOptions, 'groupColor'>> & {
        groupColor: string | undefined;
    }) {
        this.group = opts.group;
        this.color = opts.color;
        this.foreground = opts.foreground;
        this.groupColor = opts.groupColor;
        this.heartbeatMs = opts.heartbeatMs;
        this.staleMs = opts.staleMs;
        this.trackingMode = opts.trackingMode;
    }

    /** Build a Config in-memory. Defaults mirror `package.json`. */
    static make(opts: ConfigOptions = {}): Config {
        const groupColorRaw = (opts.groupColor ?? '').trim();
        return new Config({
            group: (opts.group ?? '').trim(),
            color: opts.color ?? '#c41e3a',
            foreground: opts.foreground ?? '#ffffff',
            groupColor: groupColorRaw || undefined,
            heartbeatMs: opts.heartbeatMs ?? 5000,
            staleMs: opts.staleMs ?? 30000,
            trackingMode: opts.trackingMode ?? TrackingMode.FirstWorkspaceFolder,
        });
    }
}

export type { ConfigOptions };
export { TrackingMode };
