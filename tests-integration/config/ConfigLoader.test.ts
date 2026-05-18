import * as assert from 'assert';
import * as vscode from 'vscode';
import { TrackingMode } from '../../src/config/Config';
import { ConfigLoader } from '../../src/config/ConfigLoader';

/**
 * Feature test for ConfigLoader.
 *
 * Runs inside a real VS Code instance via `@vscode/test-cli`, so it can drive
 * `vscode.workspace.getConfiguration().update(...)` and then assert that
 * `ConfigLoader.read()` actually sees the updated values. Uses Mocha's TDD UI
 * (`suite`/`test`) per the VS Code testing guide.
 */

const SECTION = 'branchBuddy';
const MANAGED_KEYS = [
    'group',
    'color',
    'foreground',
    'groupColor',
    'trackingMode',
    'heartbeatMs',
    'staleMs',
] as const;

/** Reset every key we touch back to its package.json default. */
async function resetAll(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration(SECTION);
    for (const k of MANAGED_KEYS) {
        await cfg.update(k, undefined, vscode.ConfigurationTarget.Global);
    }
}

async function setGlobal(key: string, value: unknown): Promise<void> {
    await vscode.workspace
        .getConfiguration(SECTION)
        .update(key, value, vscode.ConfigurationTarget.Global);
}

suite('ConfigLoader (feature)', () => {
    suiteSetup(async () => {
        await resetAll();
    });

    suiteTeardown(async () => {
        await resetAll();
    });

    teardown(async () => {
        // Each test runs against a clean slate so order doesn't matter.
        await resetAll();
    });

    test('read() returns package.json defaults when nothing is set', () => {
        const cfg = ConfigLoader.read();
        assert.strictEqual(cfg.group, '', 'group default');
        assert.strictEqual(cfg.color, '#c41e3a', 'color default');
        assert.strictEqual(cfg.foreground, '#ffffff', 'foreground default');
        assert.strictEqual(cfg.groupColor, undefined, 'groupColor default');
        assert.strictEqual(
            cfg.trackingMode,
            TrackingMode.FirstWorkspaceFolder,
            'trackingMode default',
        );
        assert.strictEqual(cfg.heartbeatMs, 5000, 'heartbeatMs default');
        assert.strictEqual(cfg.staleMs, 30000, 'staleMs default');
    });

    test('read() picks up a configured group', async () => {
        await setGlobal('group', 'acme-app');
        assert.strictEqual(ConfigLoader.read().group, 'acme-app');
    });

    test('read() trims surrounding whitespace from group', async () => {
        await setGlobal('group', '  acme-app  ');
        assert.strictEqual(ConfigLoader.read().group, 'acme-app');
    });

    test('read() reflects custom color and foreground', async () => {
        await setGlobal('color', '#112233');
        await setGlobal('foreground', '#445566');
        const cfg = ConfigLoader.read();
        assert.strictEqual(cfg.color, '#112233');
        assert.strictEqual(cfg.foreground, '#445566');
    });

    test('read() reflects a configured groupColor', async () => {
        await setGlobal('groupColor', '#7aa2f7');
        assert.strictEqual(ConfigLoader.read().groupColor, '#7aa2f7');
    });

    test('read() coerces whitespace-only groupColor to undefined', async () => {
        await setGlobal('groupColor', '   ');
        assert.strictEqual(ConfigLoader.read().groupColor, undefined);
    });

    test('read() reflects custom heartbeatMs and staleMs', async () => {
        await setGlobal('heartbeatMs', 1000);
        await setGlobal('staleMs', 2000);
        const cfg = ConfigLoader.read();
        assert.strictEqual(cfg.heartbeatMs, 1000);
        assert.strictEqual(cfg.staleMs, 2000);
    });

    test('read() reflects configured trackingMode', async () => {
        await setGlobal('trackingMode', TrackingMode.AllWorkspaceFolders);
        assert.strictEqual(ConfigLoader.read().trackingMode, TrackingMode.AllWorkspaceFolders);
    });

    test('read() returns an immutable snapshot — later config changes do not mutate prior reads', async () => {
        await setGlobal('group', 'first-group');
        const before = ConfigLoader.read();
        await setGlobal('group', 'second-group');
        assert.strictEqual(before.group, 'first-group', 'previously read snapshot stayed constant');
        assert.strictEqual(ConfigLoader.read().group, 'second-group', 'new read sees new value');
    });

    test('affects() returns true only for the specific key', () => {
        const fakeEvent: vscode.ConfigurationChangeEvent = {
            affectsConfiguration: (section: string) => section === 'branchBuddy.group',
        };
        assert.strictEqual(ConfigLoader.affects(fakeEvent, 'group'), true);
        assert.strictEqual(ConfigLoader.affects(fakeEvent, 'color'), false);
        assert.strictEqual(ConfigLoader.affects(fakeEvent, 'groupColor'), false);
    });

    test('affects() composes correctly when the event spans the whole section', () => {
        const fakeEvent: vscode.ConfigurationChangeEvent = {
            // Simulate VS Code's behavior: changing one key also makes the
            // parent section "affected".
            affectsConfiguration: (section: string) =>
                section === 'branchBuddy' || section === 'branchBuddy.heartbeatMs',
        };
        assert.strictEqual(ConfigLoader.affects(fakeEvent, 'heartbeatMs'), true);
        assert.strictEqual(ConfigLoader.affects(fakeEvent, 'color'), false);
    });
});
