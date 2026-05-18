import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RegistryStore } from '../../src/registry/RegistryStore';
import type { InstanceEntry, Registry } from '../../src/types';

/**
 * Vitest unit tests for the filesystem-backed RegistryStore.
 *
 * Each test gets a fresh path under `os.tmpdir()` so tests are isolated and
 * the suite can run in parallel safely.
 */

function freshPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'));
    return path.join(dir, 'registry.json');
}

function cleanup(filePath: string): void {
    try {
        fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
    } catch {
        // ignore
    }
}

function entry(opts: Partial<InstanceEntry> = {}): InstanceEntry {
    return {
        pid: 1,
        workspace: '/x',
        branch: 'main',
        group: 'acme-app',
        updatedAt: 1000,
        ...opts,
    };
}

describe('RegistryStore', () => {
    let p: string;

    beforeEach(() => {
        p = freshPath();
    });

    afterEach(() => {
        cleanup(p);
    });

    describe('path & factory', () => {
        it('exposes its path via the `path` getter', () => {
            expect(RegistryStore.at(p).path).toBe(p);
        });
    });

    describe('read()', () => {
        it('returns an empty registry when the file does not exist', () => {
            expect(RegistryStore.at(p).read()).toEqual({ instances: {} });
        });

        it('returns an empty registry on malformed JSON', () => {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, '{ not valid json', 'utf8');
            expect(RegistryStore.at(p).read()).toEqual({ instances: {} });
        });

        it('returns an empty registry when the file is empty', () => {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, '', 'utf8');
            expect(RegistryStore.at(p).read()).toEqual({ instances: {} });
        });

        it('returns an empty registry when the file is well-formed JSON but missing `instances`', () => {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, '{ "other": "shape" }', 'utf8');
            expect(RegistryStore.at(p).read()).toEqual({ instances: {} });
        });

        it('parses a valid registry from disk', () => {
            const reg: Registry = { instances: { a: entry() } };
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, JSON.stringify(reg), 'utf8');
            expect(RegistryStore.at(p).read()).toEqual(reg);
        });
    });

    describe('write() / read() round-trip', () => {
        it('round-trips an entry verbatim', () => {
            const store = RegistryStore.at(p);
            const reg: Registry = {
                instances: {
                    a: entry({ branch: 'main', updatedAt: 1234 }),
                    b: entry({ branch: 'feat/x', updatedAt: 5678 }),
                },
            };
            store.write(reg);
            expect(store.read()).toEqual(reg);
        });

        it('overwrites previous content rather than appending', () => {
            const store = RegistryStore.at(p);
            store.write({ instances: { a: entry({ branch: 'main' }) } });
            store.write({ instances: { b: entry({ branch: 'feat/x' }) } });
            const reread = store.read();
            expect(Object.keys(reread.instances)).toEqual(['b']);
            expect(reread.instances.b.branch).toBe('feat/x');
        });

        it('survives a burst of sequential writes without leaving a corrupted file', () => {
            const store = RegistryStore.at(p);
            for (let i = 0; i < 50; i++) {
                store.write({
                    instances: { ['e' + i]: entry({ updatedAt: i }) },
                });
            }
            // After the storm, the file is still valid JSON readable as a
            // Registry — the temp-file + rename strategy never left a torn
            // half-written file behind.
            const final = store.read();
            expect(final.instances).toBeDefined();
            expect(Object.keys(final.instances)).toHaveLength(1);
        });

        it('leaves no `.tmp.*` siblings after a write completes', () => {
            const store = RegistryStore.at(p);
            store.write({ instances: { a: entry() } });
            const siblings = fs.readdirSync(path.dirname(p));
            const leftovers = siblings.filter(f => f.includes('.tmp.'));
            expect(leftovers).toEqual([]);
        });
    });

    describe('ensureDir() / ensureFile()', () => {
        it('ensureDir() creates a missing parent directory', () => {
            const deep = path.join(path.dirname(p), 'a', 'b', 'c', 'registry.json');
            RegistryStore.at(deep).ensureDir();
            expect(fs.existsSync(path.dirname(deep))).toBe(true);
        });

        it('ensureFile() creates an empty registry file when none exists', () => {
            RegistryStore.at(p).ensureFile();
            expect(fs.existsSync(p)).toBe(true);
            expect(JSON.parse(fs.readFileSync(p, 'utf8'))).toEqual({ instances: {} });
        });

        it('ensureFile() leaves an existing valid registry untouched', () => {
            const reg: Registry = { instances: { a: entry({ branch: 'main' }) } };
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, JSON.stringify(reg), 'utf8');
            RegistryStore.at(p).ensureFile();
            expect(JSON.parse(fs.readFileSync(p, 'utf8'))).toEqual(reg);
        });

        it('ensureDir() and ensureFile() chain (returning `this`)', () => {
            const store = RegistryStore.at(p);
            const result = store.ensureDir().ensureFile();
            expect(result).toBe(store);
        });
    });

    describe('watch()', () => {
        it('returns a disposable when the watcher is installed', () => {
            const store = RegistryStore.at(p).ensureFile();
            const w = store.watch(() => {});
            // fs.watch may legitimately return undefined on some filesystems
            // (e.g. certain networked mounts). If it succeeds, it must be a
            // disposable.
            if (w) {
                expect(typeof w.dispose).toBe('function');
                w.dispose();
            }
        });

        it('fires the callback when the file is rewritten', async () => {
            const store = RegistryStore.at(p).ensureFile();
            let fired = 0;
            const w = store.watch(() => {
                fired++;
            });
            if (!w) {
                // Skip on filesystems that can't watch — covered above.
                return;
            }

            store.write({ instances: { a: entry({ updatedAt: 42 }) } });
            // fs.watch is async; give it a beat to deliver the event.
            await new Promise(r => setTimeout(r, 150));
            w.dispose();
            expect(fired).toBeGreaterThan(0);
        });
    });
});
