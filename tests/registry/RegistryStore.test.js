"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vitest_1 = require("vitest");
const RegistryStore_1 = require("../../src/registry/RegistryStore");
/**
 * Vitest unit tests for the filesystem-backed RegistryStore.
 *
 * Each test gets a fresh path under `os.tmpdir()` so tests are isolated and
 * the suite can run in parallel safely.
 */
function freshPath() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'));
    return path.join(dir, 'registry.json');
}
function cleanup(filePath) {
    try {
        fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
    }
    catch {
        // ignore
    }
}
function entry(opts = {}) {
    return {
        pid: 1,
        workspace: '/x',
        branch: 'main',
        group: 'acme-app',
        updatedAt: 1000,
        ...opts,
    };
}
(0, vitest_1.describe)('RegistryStore', () => {
    let p;
    (0, vitest_1.beforeEach)(() => {
        p = freshPath();
    });
    (0, vitest_1.afterEach)(() => {
        cleanup(p);
    });
    (0, vitest_1.describe)('path & factory', () => {
        (0, vitest_1.it)('exposes its path via the `path` getter', () => {
            (0, vitest_1.expect)(RegistryStore_1.RegistryStore.at(p).path).toBe(p);
        });
    });
    (0, vitest_1.describe)('read()', () => {
        (0, vitest_1.it)('returns an empty registry when the file does not exist', () => {
            (0, vitest_1.expect)(RegistryStore_1.RegistryStore.at(p).read()).toEqual({ instances: {} });
        });
        (0, vitest_1.it)('returns an empty registry on malformed JSON', () => {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, '{ not valid json', 'utf8');
            (0, vitest_1.expect)(RegistryStore_1.RegistryStore.at(p).read()).toEqual({ instances: {} });
        });
        (0, vitest_1.it)('returns an empty registry when the file is empty', () => {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, '', 'utf8');
            (0, vitest_1.expect)(RegistryStore_1.RegistryStore.at(p).read()).toEqual({ instances: {} });
        });
        (0, vitest_1.it)('returns an empty registry when the file is well-formed JSON but missing `instances`', () => {
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, '{ "other": "shape" }', 'utf8');
            (0, vitest_1.expect)(RegistryStore_1.RegistryStore.at(p).read()).toEqual({ instances: {} });
        });
        (0, vitest_1.it)('parses a valid registry from disk', () => {
            const reg = { instances: { a: entry() } };
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, JSON.stringify(reg), 'utf8');
            (0, vitest_1.expect)(RegistryStore_1.RegistryStore.at(p).read()).toEqual(reg);
        });
    });
    (0, vitest_1.describe)('write() / read() round-trip', () => {
        (0, vitest_1.it)('round-trips an entry verbatim', () => {
            const store = RegistryStore_1.RegistryStore.at(p);
            const reg = {
                instances: {
                    a: entry({ branch: 'main', updatedAt: 1234 }),
                    b: entry({ branch: 'feat/x', updatedAt: 5678 }),
                },
            };
            store.write(reg);
            (0, vitest_1.expect)(store.read()).toEqual(reg);
        });
        (0, vitest_1.it)('overwrites previous content rather than appending', () => {
            const store = RegistryStore_1.RegistryStore.at(p);
            store.write({ instances: { a: entry({ branch: 'main' }) } });
            store.write({ instances: { b: entry({ branch: 'feat/x' }) } });
            const reread = store.read();
            (0, vitest_1.expect)(Object.keys(reread.instances)).toEqual(['b']);
            (0, vitest_1.expect)(reread.instances.b.branch).toBe('feat/x');
        });
        (0, vitest_1.it)('survives a burst of sequential writes without leaving a corrupted file', () => {
            const store = RegistryStore_1.RegistryStore.at(p);
            for (let i = 0; i < 50; i++) {
                store.write({
                    instances: { ['e' + i]: entry({ updatedAt: i }) },
                });
            }
            // After the storm, the file is still valid JSON readable as a
            // Registry — the temp-file + rename strategy never left a torn
            // half-written file behind.
            const final = store.read();
            (0, vitest_1.expect)(final.instances).toBeDefined();
            (0, vitest_1.expect)(Object.keys(final.instances)).toHaveLength(1);
        });
        (0, vitest_1.it)('leaves no `.tmp.*` siblings after a write completes', () => {
            const store = RegistryStore_1.RegistryStore.at(p);
            store.write({ instances: { a: entry() } });
            const siblings = fs.readdirSync(path.dirname(p));
            const leftovers = siblings.filter(f => f.includes('.tmp.'));
            (0, vitest_1.expect)(leftovers).toEqual([]);
        });
    });
    (0, vitest_1.describe)('ensureDir() / ensureFile()', () => {
        (0, vitest_1.it)('ensureDir() creates a missing parent directory', () => {
            const deep = path.join(path.dirname(p), 'a', 'b', 'c', 'registry.json');
            RegistryStore_1.RegistryStore.at(deep).ensureDir();
            (0, vitest_1.expect)(fs.existsSync(path.dirname(deep))).toBe(true);
        });
        (0, vitest_1.it)('ensureFile() creates an empty registry file when none exists', () => {
            RegistryStore_1.RegistryStore.at(p).ensureFile();
            (0, vitest_1.expect)(fs.existsSync(p)).toBe(true);
            (0, vitest_1.expect)(JSON.parse(fs.readFileSync(p, 'utf8'))).toEqual({ instances: {} });
        });
        (0, vitest_1.it)('ensureFile() leaves an existing valid registry untouched', () => {
            const reg = { instances: { a: entry({ branch: 'main' }) } };
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, JSON.stringify(reg), 'utf8');
            RegistryStore_1.RegistryStore.at(p).ensureFile();
            (0, vitest_1.expect)(JSON.parse(fs.readFileSync(p, 'utf8'))).toEqual(reg);
        });
        (0, vitest_1.it)('ensureDir() and ensureFile() chain (returning `this`)', () => {
            const store = RegistryStore_1.RegistryStore.at(p);
            const result = store.ensureDir().ensureFile();
            (0, vitest_1.expect)(result).toBe(store);
        });
    });
    (0, vitest_1.describe)('watch()', () => {
        (0, vitest_1.it)('returns a disposable when the watcher is installed', () => {
            const store = RegistryStore_1.RegistryStore.at(p).ensureFile();
            const w = store.watch(() => { });
            // fs.watch may legitimately return undefined on some filesystems
            // (e.g. certain networked mounts). If it succeeds, it must be a
            // disposable.
            if (w) {
                (0, vitest_1.expect)(typeof w.dispose).toBe('function');
                w.dispose();
            }
        });
        (0, vitest_1.it)('fires the callback when the file is rewritten', async () => {
            const store = RegistryStore_1.RegistryStore.at(p).ensureFile();
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
            (0, vitest_1.expect)(fired).toBeGreaterThan(0);
        });
    });
});
//# sourceMappingURL=RegistryStore.test.js.map