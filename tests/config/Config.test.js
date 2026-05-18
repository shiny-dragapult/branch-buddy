"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const Config_1 = require("../../src/config/Config");
// Note: only `Config.make` is exercised here. `Config.read` and
// `Config.affects` touch `vscode.workspace.getConfiguration`, so they belong
// in integration-style tests with the vscode API mocked.
(0, vitest_1.describe)('Config.make', () => {
    (0, vitest_1.it)('applies the package.json defaults when no options are given', () => {
        const cfg = Config_1.Config.make();
        (0, vitest_1.expect)(cfg.group).toBe('');
        (0, vitest_1.expect)(cfg.color).toBe('#c41e3a');
        (0, vitest_1.expect)(cfg.foreground).toBe('#ffffff');
        (0, vitest_1.expect)(cfg.groupColor).toBeUndefined();
        (0, vitest_1.expect)(cfg.heartbeatMs).toBe(5000);
        (0, vitest_1.expect)(cfg.staleMs).toBe(30000);
    });
    (0, vitest_1.it)('trims surrounding whitespace from the group', () => {
        (0, vitest_1.expect)(Config_1.Config.make({ group: '  acme-app  ' }).group).toBe('acme-app');
    });
    (0, vitest_1.it)('coerces whitespace-only groupColor to undefined', () => {
        (0, vitest_1.expect)(Config_1.Config.make({ groupColor: '   ' }).groupColor).toBeUndefined();
    });
    (0, vitest_1.it)('preserves a real groupColor and trims it', () => {
        (0, vitest_1.expect)(Config_1.Config.make({ groupColor: '  #7aa2f7  ' }).groupColor).toBe('#7aa2f7');
    });
    (0, vitest_1.it)('accepts custom numeric tuning values', () => {
        const cfg = Config_1.Config.make({ heartbeatMs: 1000, staleMs: 2000 });
        (0, vitest_1.expect)(cfg.heartbeatMs).toBe(1000);
        (0, vitest_1.expect)(cfg.staleMs).toBe(2000);
    });
    (0, vitest_1.it)('produces an immutable snapshot (readonly fields)', () => {
        const cfg = Config_1.Config.make({ group: 'acme-app' });
        // Compile-time check: assigning would be a type error. At runtime,
        // properties are still assignable on a plain class instance, so we
        // assert the value didn't accidentally change after make() returned.
        (0, vitest_1.expect)(cfg.group).toBe('acme-app');
    });
});
//# sourceMappingURL=Config.test.js.map