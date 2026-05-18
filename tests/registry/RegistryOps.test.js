"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const RegistryOps_1 = require("../../src/registry/RegistryOps");
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
(0, vitest_1.describe)('RegistryOps', () => {
    (0, vitest_1.it)('starts empty', () => {
        (0, vitest_1.expect)(RegistryOps_1.RegistryOps.empty().toRegistry().instances).toEqual({});
    });
    (0, vitest_1.it)('upserts new entries and preserves insertion', () => {
        const reg = RegistryOps_1.RegistryOps.empty()
            .upsert('a', entry())
            .upsert('b', entry())
            .toRegistry();
        (0, vitest_1.expect)(Object.keys(reg.instances).sort()).toEqual(['a', 'b']);
    });
    (0, vitest_1.it)('overwrites an existing entry on upsert', () => {
        const reg = RegistryOps_1.RegistryOps.empty()
            .upsert('a', entry({ branch: 'main' }))
            .upsert('a', entry({ branch: 'feat/x' }))
            .toRegistry();
        (0, vitest_1.expect)(reg.instances.a.branch).toBe('feat/x');
        (0, vitest_1.expect)(Object.keys(reg.instances)).toHaveLength(1);
    });
    (0, vitest_1.it)('removes entries', () => {
        const reg = RegistryOps_1.RegistryOps.empty()
            .upsert('a', entry())
            .upsert('b', entry())
            .remove('a')
            .toRegistry();
        (0, vitest_1.expect)(Object.keys(reg.instances)).toEqual(['b']);
    });
    (0, vitest_1.it)('remove is a no-op for unknown ids', () => {
        const reg = RegistryOps_1.RegistryOps.empty().upsert('a', entry()).remove('nope').toRegistry();
        (0, vitest_1.expect)(Object.keys(reg.instances)).toEqual(['a']);
    });
    (0, vitest_1.it)('prunes entries older than the stale window', () => {
        const reg = {
            instances: {
                fresh: entry({ updatedAt: 950 }),
                stale: entry({ updatedAt: 500 }),
            },
        };
        const result = RegistryOps_1.RegistryOps.of(reg).pruneStale(1000, 100).toRegistry();
        (0, vitest_1.expect)(Object.keys(result.instances)).toEqual(['fresh']);
    });
    (0, vitest_1.it)('treats an entry exactly at the stale boundary as still fresh', () => {
        const reg = {
            instances: { borderline: entry({ updatedAt: 900 }) },
        };
        const result = RegistryOps_1.RegistryOps.of(reg).pruneStale(1000, 100).toRegistry();
        (0, vitest_1.expect)(result.instances.borderline).toBeDefined();
    });
    (0, vitest_1.it)('does not mutate the source registry', () => {
        const reg = { instances: { a: entry() } };
        RegistryOps_1.RegistryOps.of(reg).upsert('b', entry()).remove('a');
        (0, vitest_1.expect)(Object.keys(reg.instances)).toEqual(['a']);
    });
    (0, vitest_1.it)('lists others excluding myId', () => {
        const reg = {
            instances: {
                me: entry({ workspace: '/me' }),
                you: entry({ workspace: '/you' }),
            },
        };
        const others = RegistryOps_1.RegistryOps.of(reg).others('me');
        (0, vitest_1.expect)(others).toHaveLength(1);
        (0, vitest_1.expect)(others[0].workspace).toBe('/you');
    });
    (0, vitest_1.it)('returns all instances for `instances()`', () => {
        const reg = {
            instances: { a: entry(), b: entry() },
        };
        (0, vitest_1.expect)(RegistryOps_1.RegistryOps.of(reg).instances()).toHaveLength(2);
    });
});
//# sourceMappingURL=RegistryOps.test.js.map