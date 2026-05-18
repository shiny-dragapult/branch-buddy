import * as assert from 'assert';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- this test monkey-patches fs methods.
import fs = require('fs');
import * as os from 'os';
import * as path from 'path';
import { RegistryStore } from '../../src/registry/RegistryStore';
import type { Registry } from '../../src/types';

function freshPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-integration-'));
    return path.join(dir, 'registry.json');
}

function cleanup(filePath: string): void {
    try {
        fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
    } catch {
        // ignore
    }
}

function replaceMethod<T extends object, K extends keyof T>(
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

suite('RegistryStore (integration coverage)', () => {
    let p: string;

    setup(() => {
        p = freshPath();
    });

    teardown(() => {
        cleanup(p);
    });

    test('path, ensureFile(), and read() cover the empty-registry path', () => {
        const store = RegistryStore.at(p);

        assert.strictEqual(store.path, p);
        assert.deepStrictEqual(store.read(), { instances: {} });

        const returned = store.ensureFile();
        assert.strictEqual(returned, store);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(p, 'utf8')), { instances: {} });
    });

    test('ensureDir() is a no-op when the parent directory already exists', () => {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        const store = RegistryStore.at(p);

        assert.strictEqual(store.ensureDir(), store);
        assert.strictEqual(fs.existsSync(path.dirname(p)), true);
    });

    test('read() returns empty for malformed and structurally invalid JSON', () => {
        fs.mkdirSync(path.dirname(p), { recursive: true });

        fs.writeFileSync(p, '{"notInstances":true}', 'utf8');
        assert.deepStrictEqual(RegistryStore.at(p).read(), { instances: {} });

        fs.writeFileSync(p, '{ invalid json', 'utf8');
        assert.deepStrictEqual(RegistryStore.at(p).read(), { instances: {} });
    });

    test('write() falls back to a direct write when temp rename fails', () => {
        const reg: Registry = {
            instances: {
                a: {
                    pid: 1,
                    workspace: '/workspace',
                    branch: 'main',
                    group: 'coverage',
                    updatedAt: 1000,
                },
            },
        };
        const restoreRename = replaceMethod(fs, 'renameSync', (() => {
            throw new Error('simulated rename failure');
        }) as typeof fs.renameSync);

        try {
            RegistryStore.at(p).write(reg);
        } finally {
            restoreRename();
        }

        assert.deepStrictEqual(RegistryStore.at(p).read(), reg);
        const leftovers = fs.readdirSync(path.dirname(p)).filter(f => f.includes('.tmp.'));
        assert.deepStrictEqual(leftovers, []);
    });

    test('write() swallows direct-write and temp-cleanup failures', () => {
        const restoreWrite = replaceMethod(fs, 'writeFileSync', (() => {
            throw new Error('simulated write failure');
        }) as typeof fs.writeFileSync);
        const restoreUnlink = replaceMethod(fs, 'unlinkSync', (() => {
            throw new Error('simulated unlink failure');
        }) as typeof fs.unlinkSync);

        try {
            assert.doesNotThrow(() => {
                RegistryStore.at(p).write({ instances: {} });
            });
        } finally {
            restoreUnlink();
            restoreWrite();
        }

        assert.strictEqual(fs.existsSync(p), false);
    });

    test('watch() returns undefined when fs.watch cannot be installed', () => {
        const restoreWatch = replaceMethod(fs, 'watch', (() => {
            throw new Error('simulated watch failure');
        }) as typeof fs.watch);

        try {
            assert.strictEqual(RegistryStore.at(p).watch(() => {}), undefined);
        } finally {
            restoreWatch();
        }
    });
});
