import { describe, expect, it } from 'vitest';
import { RegistryOps } from '../../src/registry/RegistryOps';
import type { InstanceEntry, Registry } from '../../src/types';

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

describe('RegistryOps', () => {
    it('starts empty', () => {
        expect(RegistryOps.empty().toRegistry().instances).toEqual({});
    });

    it('upserts new entries and preserves insertion', () => {
        const reg = RegistryOps.empty()
            .upsert('a', entry())
            .upsert('b', entry())
            .toRegistry();
        expect(Object.keys(reg.instances).sort()).toEqual(['a', 'b']);
    });

    it('overwrites an existing entry on upsert', () => {
        const reg = RegistryOps.empty()
            .upsert('a', entry({ branch: 'main' }))
            .upsert('a', entry({ branch: 'feat/x' }))
            .toRegistry();
        expect(reg.instances.a.branch).toBe('feat/x');
        expect(Object.keys(reg.instances)).toHaveLength(1);
    });

    it('removes entries', () => {
        const reg = RegistryOps.empty()
            .upsert('a', entry())
            .upsert('b', entry())
            .remove('a')
            .toRegistry();
        expect(Object.keys(reg.instances)).toEqual(['b']);
    });

    it('remove is a no-op for unknown ids', () => {
        const reg = RegistryOps.empty().upsert('a', entry()).remove('nope').toRegistry();
        expect(Object.keys(reg.instances)).toEqual(['a']);
    });

    it('prunes entries older than the stale window', () => {
        const reg: Registry = {
            instances: {
                fresh: entry({ updatedAt: 950 }),
                stale: entry({ updatedAt: 500 }),
            },
        };
        const result = RegistryOps.of(reg).pruneStale(1000, 100).toRegistry();
        expect(Object.keys(result.instances)).toEqual(['fresh']);
    });

    it('treats an entry exactly at the stale boundary as still fresh', () => {
        const reg: Registry = {
            instances: { borderline: entry({ updatedAt: 900 }) },
        };
        const result = RegistryOps.of(reg).pruneStale(1000, 100).toRegistry();
        expect(result.instances.borderline).toBeDefined();
    });

    it('does not mutate the source registry', () => {
        const reg: Registry = { instances: { a: entry() } };
        RegistryOps.of(reg).upsert('b', entry()).remove('a');
        expect(Object.keys(reg.instances)).toEqual(['a']);
    });

    it('lists others excluding myId', () => {
        const reg: Registry = {
            instances: {
                me: entry({ workspace: '/me' }),
                you: entry({ workspace: '/you' }),
            },
        };
        const others = RegistryOps.of(reg).others('me');
        expect(others).toHaveLength(1);
        expect(others[0].workspace).toBe('/you');
    });

    it('returns all instances for `instances()`', () => {
        const reg: Registry = {
            instances: { a: entry(), b: entry() },
        };
        expect(RegistryOps.of(reg).instances()).toHaveLength(2);
    });
});
