import * as assert from 'assert';
import * as vscode from 'vscode';
import { WindowColorizer } from '../../src/ui/WindowColorizer';

/**
 * Feature test for WindowColorizer.
 *
 * The single most important contract: apply()/clear() must leave any
 * unrelated `workbench.colorCustomizations` keys untouched. Regressions here
 * silently corrupt the user's editor theme — well worth pinning down.
 */

const SECTION = 'workbench.colorCustomizations';
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

/** WindowColorizer picks Workspace target when a folder is open, else Global. */
function colorizerTarget(): vscode.ConfigurationTarget {
    return vscode.workspace.workspaceFolders
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
}

async function setRawColors(
    value: Record<string, string> | undefined,
): Promise<void> {
    await vscode.workspace
        .getConfiguration()
        .update(SECTION, value, colorizerTarget());
}

function readRawColors(): Record<string, string> {
    return (
        vscode.workspace
            .getConfiguration()
            .get<Record<string, string>>(SECTION) ?? {}
    );
}

function inspectedValue(
    target: vscode.ConfigurationTarget.Global | vscode.ConfigurationTarget.Workspace,
): Record<string, string> | undefined {
    const inspected = vscode.workspace
        .getConfiguration()
        .inspect<Record<string, string>>(SECTION);
    return target === vscode.ConfigurationTarget.Workspace
        ? inspected?.workspaceValue
        : inspected?.globalValue;
}

function replaceProperty<T extends object, K extends keyof T>(
    target: T,
    key: K,
    value: T[K],
): () => void {
    const original = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, {
        configurable: true,
        value,
    });
    return () => {
        if (original) {
            Object.defineProperty(target, key, original);
        } else {
            delete (target as Record<PropertyKey, unknown>)[key as PropertyKey];
        }
    };
}

async function resetColors(): Promise<void> {
    // Clear both scopes so previous tests can't bleed into the next regardless
    // of which target the colorizer picked.
    const cfg = vscode.workspace.getConfiguration();
    await cfg.update(SECTION, undefined, vscode.ConfigurationTarget.Global);
    if (vscode.workspace.workspaceFolders) {
        await cfg.update(SECTION, undefined, vscode.ConfigurationTarget.Workspace);
    }
}

suite('WindowColorizer (feature)', () => {
    suiteSetup(resetColors);
    suiteTeardown(resetColors);
    teardown(resetColors);

    test('starts in the not-applied state', () => {
        const c = WindowColorizer.make();
        assert.strictEqual(c.isApplied, false);
    });

    test('apply() writes every managed key and flips isApplied', async () => {
        const c = WindowColorizer.make();
        await c.apply();
        assert.strictEqual(c.isApplied, true);

        const colors = readRawColors();
        for (const k of MANAGED_KEYS) {
            assert.ok(k in colors, `expected ${k} to be set after apply()`);
        }
    });

    test('apply() writes the configured background and foreground values', async () => {
        const c = WindowColorizer.make().background('#112233').foreground('#445566');
        await c.apply();

        const colors = readRawColors();
        for (const k of BACKGROUND_KEYS) {
            assert.strictEqual(colors[k], '#112233', `${k} should be the bg color`);
        }
        for (const k of FOREGROUND_KEYS) {
            assert.strictEqual(colors[k], '#445566', `${k} should be the fg color`);
        }
    });

    test('apply() preserves unrelated customizations the user already set', async () => {
        await setRawColors({
            'editor.background': '#101010',
            'sideBar.background': '#202020',
            'panel.background': '#303030',
        });

        const c = WindowColorizer.make().background('#c41e3a').foreground('#ffffff');
        await c.apply();

        const colors = readRawColors();
        assert.strictEqual(colors['editor.background'], '#101010', 'editor.background preserved');
        assert.strictEqual(colors['sideBar.background'], '#202020', 'sideBar.background preserved');
        assert.strictEqual(colors['panel.background'], '#303030', 'panel.background preserved');
        assert.strictEqual(colors['titleBar.activeBackground'], '#c41e3a', 'managed key applied');
    });

    test('apply() writes managed colors at workspace scope when a folder is open', async () => {
        assert.ok(
            vscode.workspace.workspaceFolders,
            'precondition: integration tests run with a workspace folder open',
        );
        const cfg = vscode.workspace.getConfiguration();
        await cfg.update(
            SECTION,
            { 'editor.background': '#global-only' },
            vscode.ConfigurationTarget.Global,
        );
        await cfg.update(
            SECTION,
            { 'panel.background': '#workspace-only' },
            vscode.ConfigurationTarget.Workspace,
        );

        const c = WindowColorizer.make().background('#c41e3a').foreground('#ffffff');
        await c.apply();

        const workspaceValue = inspectedValue(vscode.ConfigurationTarget.Workspace);
        const globalValue = inspectedValue(vscode.ConfigurationTarget.Global);

        assert.strictEqual(workspaceValue?.['titleBar.activeBackground'], '#c41e3a');
        assert.strictEqual(workspaceValue?.['statusBar.foreground'], '#ffffff');
        assert.strictEqual(
            workspaceValue?.['panel.background'],
            '#workspace-only',
            'unrelated workspace customization preserved',
        );
        assert.strictEqual(
            globalValue?.['titleBar.activeBackground'],
            undefined,
            'managed colors should not be persisted globally while a workspace folder is open',
        );
        assert.strictEqual(globalValue?.['editor.background'], '#global-only');
    });

    test('apply() writes managed colors at global scope when no folder is open', async () => {
        const restoreFolders = replaceProperty(
            vscode.workspace,
            'workspaceFolders',
            undefined,
        );
        try {
            const c = WindowColorizer.make().background('#334455').foreground('#fefefe');
            await c.apply();
        } finally {
            restoreFolders();
        }

        const globalValue = inspectedValue(vscode.ConfigurationTarget.Global);
        const workspaceValue = inspectedValue(vscode.ConfigurationTarget.Workspace);

        assert.strictEqual(globalValue?.['titleBar.activeBackground'], '#334455');
        assert.strictEqual(globalValue?.['statusBar.foreground'], '#fefefe');
        assert.strictEqual(
            workspaceValue?.['titleBar.activeBackground'],
            undefined,
            'managed colors should not be persisted to workspace scope without a workspace folder',
        );
    });

    test('clear() removes every managed key and flips isApplied back', async () => {
        const c = WindowColorizer.make();
        await c.apply();
        await c.clear();

        assert.strictEqual(c.isApplied, false);
        const colors = readRawColors();
        for (const k of MANAGED_KEYS) {
            assert.ok(!(k in colors), `expected ${k} to be absent after clear()`);
        }
    });

    test('clear() preserves unrelated customizations the user already set', async () => {
        await setRawColors({
            'editor.background': '#101010',
            'sideBar.background': '#202020',
        });

        const c = WindowColorizer.make();
        await c.apply();
        await c.clear();

        const colors = readRawColors();
        assert.strictEqual(colors['editor.background'], '#101010');
        assert.strictEqual(colors['sideBar.background'], '#202020');
        for (const k of MANAGED_KEYS) {
            assert.ok(!(k in colors), `${k} should be cleared`);
        }
    });

    test('apply() is idempotent — calling twice yields the same colors and isApplied', async () => {
        const c = WindowColorizer.make().background('#aabbcc').foreground('#ddeeff');

        await c.apply();
        const after1 = readRawColors();

        await c.apply();
        const after2 = readRawColors();

        assert.deepStrictEqual(after2, after1, 'second apply() must produce identical state');
        assert.strictEqual(c.isApplied, true);
    });

    test('clear() before any apply() is a safe no-op', async () => {
        await setRawColors({ 'editor.background': '#101010' });

        const c = WindowColorizer.make();
        await c.clear(); // never called apply()

        assert.strictEqual(c.isApplied, false);
        const colors = readRawColors();
        assert.strictEqual(colors['editor.background'], '#101010', 'unrelated key preserved');
        for (const k of MANAGED_KEYS) {
            assert.ok(!(k in colors), `${k} should still be absent`);
        }
    });

    test('changing colors and re-applying updates the values in place', async () => {
        const c = WindowColorizer.make().background('#aaaaaa').foreground('#000000');
        await c.apply();
        assert.strictEqual(readRawColors()['titleBar.activeBackground'], '#aaaaaa');

        c.background('#bbbbbb').foreground('#111111');
        await c.apply();
        const colors = readRawColors();
        assert.strictEqual(colors['titleBar.activeBackground'], '#bbbbbb');
        assert.strictEqual(colors['statusBar.foreground'], '#111111');
    });

    test('clear() with no other customizations leaves workbench.colorCustomizations unset', async () => {
        const c = WindowColorizer.make();
        await c.apply();
        await c.clear();

        // The colorizer passes `undefined` to update() when its managed keys
        // were the only ones present, so the persisted value at whichever
        // target it wrote to should be cleared.
        const inspected = vscode.workspace
            .getConfiguration()
            .inspect<Record<string, string>>(SECTION);
        const persisted = vscode.workspace.workspaceFolders
            ? inspected?.workspaceValue
            : inspected?.globalValue;
        assert.strictEqual(persisted, undefined, 'persisted value should be undefined after clean clear()');
    });

    // Documents current behavior, not necessarily desired: clear() doesn't
    // restore any user-set value that happened to collide with a managed key.
    // If we ever want to preserve those, this test should flip and the
    // colorizer needs to snapshot prior values on apply().
    test('[known limitation] clear() removes a user value that collides with a managed key', async () => {
        await setRawColors({ 'titleBar.activeBackground': '#user-set' });

        const c = WindowColorizer.make();
        await c.apply();
        await c.clear();

        const colors = readRawColors();
        assert.ok(
            !('titleBar.activeBackground' in colors),
            'collision-with-managed-key user values are not preserved by current implementation',
        );
    });
});
