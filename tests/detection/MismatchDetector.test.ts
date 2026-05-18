import { describe, expect, it } from 'vitest';
import { MismatchDetector } from '../../src/detection/MismatchDetector';
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

function registry(entries: Record<string, InstanceEntry>): Registry {
    return { instances: entries };
}

function detectorAt(now = 1000, staleMs = 100): MismatchDetector {
    return MismatchDetector.make()
        .myId('me')
        .myBranch('main')
        .myGroup('acme-app')
        .now(now)
        .staleMs(staleMs);
}

describe('MismatchDetector', () => {
    it('returns no-group when this window has no group set', () => {
        const result = MismatchDetector.make()
            .myId('me')
            .myBranch('main')
            .myGroup('')
            .now(1000)
            .check(registry({ peer: entry({ branch: 'feat/x' }) }));

        expect(result).toEqual({ mismatch: false, others: [], reason: 'no-group' });
    });

    it('returns no-branch when this window does not yet know its branch', () => {
        const result = detectorAt()
            .myBranch(null)
            .check(registry({ peer: entry({ branch: 'feat/x' }) }));

        expect(result.reason).toBe('no-branch');
        expect(result.mismatch).toBe(false);
    });

    it('returns no-peers when no live instance is in our group', () => {
        const result = detectorAt().check(
            registry({
                peer: entry({ group: 'other-app', branch: 'feat/x' }),
            }),
        );
        expect(result.reason).toBe('no-peers');
        expect(result.mismatch).toBe(false);
    });

    it('flags a mismatch when a peer in our group is on a different branch', () => {
        const result = detectorAt().check(
            registry({ peer: entry({ branch: 'feat/x' }) }),
        );
        expect(result.reason).toBe('evaluated');
        expect(result.mismatch).toBe(true);
        expect(result.others).toHaveLength(1);
    });

    it('reports no mismatch when every peer matches our branch', () => {
        const result = detectorAt().check(
            registry({
                peer1: entry({ branch: 'main' }),
                peer2: entry({ branch: 'main' }),
            }),
        );
        expect(result.reason).toBe('evaluated');
        expect(result.mismatch).toBe(false);
        expect(result.others).toHaveLength(2);
    });

    it('excludes our own entry from consideration', () => {
        const result = detectorAt().check(
            registry({
                me: entry({ branch: 'feat/x' }), // wrong branch, but it's us
            }),
        );
        expect(result.reason).toBe('no-peers');
        expect(result.mismatch).toBe(false);
    });

    it('ignores entries older than the stale window', () => {
        const result = detectorAt(10_000, 1000).check(
            registry({
                old: entry({ branch: 'feat/x', updatedAt: 1000 }), // 9s old, stale
            }),
        );
        expect(result.reason).toBe('no-peers');
    });

    it('only compares peers in the same group', () => {
        const result = detectorAt().check(
            registry({
                same_group: entry({ branch: 'main', group: 'acme-app' }),
                other_group: entry({ branch: 'feat/x', group: 'unrelated' }),
            }),
        );
        expect(result.reason).toBe('evaluated');
        expect(result.mismatch).toBe(false);
        expect(result.others).toHaveLength(1);
    });

    it('ignores peers whose branch is null (still loading)', () => {
        const result = detectorAt().check(
            registry({
                loading: entry({ branch: null }),
            }),
        );
        expect(result.reason).toBe('no-peers');
    });

    it('flags a mismatch even if only one out of many peers diverges', () => {
        const result = detectorAt().check(
            registry({
                a: entry({ branch: 'main' }),
                b: entry({ branch: 'main' }),
                c: entry({ branch: 'feat/x' }),
            }),
        );
        expect(result.mismatch).toBe(true);
        expect(result.others).toHaveLength(3);
    });

    it('tolerates legacy entries without a group field by treating it as empty', () => {
        // Mimic a registry entry written by an older version that didn't include
        // the `group` key. It should fall into the "" group and be excluded
        // from any non-empty-group comparison.
        const legacy = { ...entry({ branch: 'feat/x' }) } as InstanceEntry;
        // simulate missing
        delete (legacy as Partial<InstanceEntry>).group;
        const result = detectorAt().check(registry({ legacy }));
        expect(result.reason).toBe('no-peers');
    });
});
