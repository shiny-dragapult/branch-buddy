import { InstanceEntry, MismatchResult, Registry } from '../types';

/**
 * Pure mismatch detector. Given this window's identity (id / branch / group)
 * and the contents of the shared registry, decides whether at least one peer
 * in the same group is on a different branch.
 *
 *     MismatchDetector.make()
 *         .myId(instanceId)
 *         .myBranch('main')
 *         .myGroup('acme-app')
 *         .now(Date.now())
 *         .staleMs(30_000)
 *         .check(registry);
 *
 * No filesystem access, no `vscode` import — tests just feed a `Registry`
 * literal and assert on the returned `MismatchResult`.
 */
export class MismatchDetector {
    private _myId = '';
    private _myBranch: string | null = null;
    private _myGroup = '';
    private _now = Date.now();
    private _staleMs = 30_000;

    private constructor() {}

    static make(): MismatchDetector {
        return new MismatchDetector();
    }

    myId(v: string): this {
        this._myId = v;
        return this;
    }

    myBranch(v: string | null): this {
        this._myBranch = v;
        return this;
    }

    myGroup(v: string): this {
        this._myGroup = v;
        return this;
    }

    now(v: number): this {
        this._now = v;
        return this;
    }

    staleMs(v: number): this {
        this._staleMs = v;
        return this;
    }

    check(registry: Registry): MismatchResult {
        // No group on this window → Branch Sync is intentionally inactive.
        if (!this._myGroup) {
            return { mismatch: false, others: [], reason: 'no-group' };
        }

        const others = Object.entries(registry.instances)
            .filter(([id]) => id !== this._myId)
            .filter(([, e]) => this._now - e.updatedAt <= this._staleMs)
            .filter(([, e]) => e.branch !== null && e.branch !== undefined)
            // Only compare against peers in the same group. Tolerate legacy
            // entries (written before `group` existed) by treating missing
            // as the empty string.
            .filter(([, e]) => (e.group ?? '') === this._myGroup)
            .map(([, e]) => e);

        if (this._myBranch === null) {
            return { mismatch: false, others, reason: 'no-branch' };
        }
        if (others.length === 0) {
            return { mismatch: false, others, reason: 'no-peers' };
        }

        const mismatch = others.some(e => e.branch !== this._myBranch);
        return { mismatch, others, reason: 'evaluated' };
    }
}

/** Re-export to keep `import { InstanceEntry }` workable from here too. */
export type { InstanceEntry };
