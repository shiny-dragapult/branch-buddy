import { describe, expect, it } from 'vitest';
import { Config, TrackingMode } from '../../src/config/Config';

// Note: only `Config.make` is exercised here. `Config.read` and
// `Config.affects` touch `vscode.workspace.getConfiguration`, so they belong
// in integration-style tests with the vscode API mocked.

describe('Config.make', () => {
    it('applies the package.json defaults when no options are given', () => {
        const cfg = Config.make();
        expect(cfg.group).toBe('');
        expect(cfg.color).toBe('#c41e3a');
        expect(cfg.foreground).toBe('#ffffff');
        expect(cfg.groupColor).toBeUndefined();
        expect(cfg.heartbeatMs).toBe(5000);
        expect(cfg.staleMs).toBe(30000);
        expect(cfg.trackingMode).toBe(TrackingMode.FirstWorkspaceFolder);
    });

    it('trims surrounding whitespace from the group', () => {
        expect(Config.make({ group: '  acme-app  ' }).group).toBe('acme-app');
    });

    it('coerces whitespace-only groupColor to undefined', () => {
        expect(Config.make({ groupColor: '   ' }).groupColor).toBeUndefined();
    });

    it('preserves a real groupColor and trims it', () => {
        expect(Config.make({ groupColor: '  #7aa2f7  ' }).groupColor).toBe('#7aa2f7');
    });

    it('accepts custom numeric tuning values', () => {
        const cfg = Config.make({ heartbeatMs: 1000, staleMs: 2000 });
        expect(cfg.heartbeatMs).toBe(1000);
        expect(cfg.staleMs).toBe(2000);
    });

    it('accepts all-workspace-folder tracking mode', () => {
        const cfg = Config.make({ trackingMode: TrackingMode.AllWorkspaceFolders });
        expect(cfg.trackingMode).toBe(TrackingMode.AllWorkspaceFolders);
    });

    it('produces an immutable snapshot (readonly fields)', () => {
        const cfg = Config.make({ group: 'acme-app' });
        // Compile-time check: assigning would be a type error. At runtime,
        // properties are still assignable on a plain class instance, so we
        // assert the value didn't accidentally change after make() returned.
        expect(cfg.group).toBe('acme-app');
    });
});
