"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const MismatchDetector_1 = require("../../src/detection/MismatchDetector");
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
function registry(entries) {
    return { instances: entries };
}
function detectorAt(now = 1000, staleMs = 100) {
    return MismatchDetector_1.MismatchDetector.make()
        .myId('me')
        .myBranch('main')
        .myGroup('acme-app')
        .now(now)
        .staleMs(staleMs);
}
(0, vitest_1.describe)('MismatchDetector', () => {
    (0, vitest_1.it)('returns no-group when this window has no group set', () => {
        const result = MismatchDetector_1.MismatchDetector.make()
            .myId('me')
            .myBranch('main')
            .myGroup('')
            .now(1000)
            .check(registry({ peer: entry({ branch: 'feat/x' }) }));
        (0, vitest_1.expect)(result).toEqual({ mismatch: false, others: [], reason: 'no-group' });
    });
    (0, vitest_1.it)('returns no-branch when this window does not yet know its branch', () => {
        const result = detectorAt()
            .myBranch(null)
            .check(registry({ peer: entry({ branch: 'feat/x' }) }));
        (0, vitest_1.expect)(result.reason).toBe('no-branch');
        (0, vitest_1.expect)(result.mismatch).toBe(false);
    });
    (0, vitest_1.it)('returns no-peers when no live instance is in our group', () => {
        const result = detectorAt().check(registry({
            peer: entry({ group: 'other-app', branch: 'feat/x' }),
        }));
        (0, vitest_1.expect)(result.reason).toBe('no-peers');
        (0, vitest_1.expect)(result.mismatch).toBe(false);
    });
    (0, vitest_1.it)('flags a mismatch when a peer in our group is on a different branch', () => {
        const result = detectorAt().check(registry({ peer: entry({ branch: 'feat/x' }) }));
        (0, vitest_1.expect)(result.reason).toBe('evaluated');
        (0, vitest_1.expect)(result.mismatch).toBe(true);
        (0, vitest_1.expect)(result.others).toHaveLength(1);
    });
    (0, vitest_1.it)('reports no mismatch when every peer matches our branch', () => {
        const result = detectorAt().check(registry({
            peer1: entry({ branch: 'main' }),
            peer2: entry({ branch: 'main' }),
        }));
        (0, vitest_1.expect)(result.reason).toBe('evaluated');
        (0, vitest_1.expect)(result.mismatch).toBe(false);
        (0, vitest_1.expect)(result.others).toHaveLength(2);
    });
    (0, vitest_1.it)('excludes our own entry from consideration', () => {
        const result = detectorAt().check(registry({
            me: entry({ branch: 'feat/x' }), // wrong branch, but it's us
        }));
        (0, vitest_1.expect)(result.reason).toBe('no-peers');
        (0, vitest_1.expect)(result.mismatch).toBe(false);
    });
    (0, vitest_1.it)('ignores entries older than the stale window', () => {
        const result = detectorAt(10000, 1000).check(registry({
            old: entry({ branch: 'feat/x', updatedAt: 1000 }), // 9s old, stale
        }));
        (0, vitest_1.expect)(result.reason).toBe('no-peers');
    });
    (0, vitest_1.it)('only compares peers in the same group', () => {
        const result = detectorAt().check(registry({
            same_group: entry({ branch: 'main', group: 'acme-app' }),
            other_group: entry({ branch: 'feat/x', group: 'unrelated' }),
        }));
        (0, vitest_1.expect)(result.reason).toBe('evaluated');
        (0, vitest_1.expect)(result.mismatch).toBe(false);
        (0, vitest_1.expect)(result.others).toHaveLength(1);
    });
    (0, vitest_1.it)('ignores peers whose branch is null (still loading)', () => {
        const result = detectorAt().check(registry({
            loading: entry({ branch: null }),
        }));
        (0, vitest_1.expect)(result.reason).toBe('no-peers');
    });
    (0, vitest_1.it)('flags a mismatch even if only one out of many peers diverges', () => {
        const result = detectorAt().check(registry({
            a: entry({ branch: 'main' }),
            b: entry({ branch: 'main' }),
            c: entry({ branch: 'feat/x' }),
        }));
        (0, vitest_1.expect)(result.mismatch).toBe(true);
        (0, vitest_1.expect)(result.others).toHaveLength(3);
    });
    (0, vitest_1.it)('tolerates legacy entries without a group field by treating it as empty', () => {
        // Mimic a registry entry written by an older version that didn't include
        // the `group` key. It should fall into the "" group and be excluded
        // from any non-empty-group comparison.
        const legacy = { ...entry({ branch: 'feat/x' }) };
        // simulate missing
        delete legacy.group;
        const result = detectorAt().check(registry({ legacy }));
        (0, vitest_1.expect)(result.reason).toBe('no-peers');
    });
});
//# sourceMappingURL=MismatchDetector.test.js.map