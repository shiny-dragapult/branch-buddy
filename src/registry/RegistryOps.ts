import { InstanceEntry, Registry } from '../types';

/**
 * Pure, immutable transformations over a `Registry`.
 *
 * Every chainable method returns a new `RegistryOps`; nothing here touches
 * the filesystem or `vscode`. That makes the whole class trivially unit
 * testable — feed in a `Registry` literal, assert on the result.
 *
 *     RegistryOps.of(reg)
 *         .pruneStale(Date.now(), 30_000)
 *         .upsert(id, entry)
 *         .toRegistry();
 */
export class RegistryOps {
    private constructor(private readonly reg: Registry) {}

    static of(reg: Registry): RegistryOps {
        // Shallow clone the instances map so callers can't mutate our state
        // by holding a reference to the original.
        return new RegistryOps({ instances: { ...reg.instances } });
    }

    static empty(): RegistryOps {
        return new RegistryOps({ instances: {} });
    }

    pruneStale(now: number, staleMs: number): RegistryOps {
        const next: Record<string, InstanceEntry> = {};
        for (const [id, e] of Object.entries(this.reg.instances)) {
            if (now - e.updatedAt <= staleMs) next[id] = e;
        }
        return new RegistryOps({ instances: next });
    }

    upsert(id: string, entry: InstanceEntry): RegistryOps {
        return new RegistryOps({
            instances: { ...this.reg.instances, [id]: entry },
        });
    }

    remove(id: string): RegistryOps {
        const next = { ...this.reg.instances };
        delete next[id];
        return new RegistryOps({ instances: next });
    }

    /** All entries except the one belonging to `myId`. */
    others(myId: string): InstanceEntry[] {
        return Object.entries(this.reg.instances)
            .filter(([id]) => id !== myId)
            .map(([, e]) => e);
    }

    instances(): InstanceEntry[] {
        return Object.values(this.reg.instances);
    }

    toRegistry(): Registry {
        return this.reg;
    }
}
