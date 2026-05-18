import { describe, expect, it } from 'vitest';
import { InstanceEntryBuilder } from '../../src/registry/InstanceEntryBuilder';

describe('InstanceEntryBuilder', () => {
    it('uses sensible defaults when no setters are called', () => {
        const entry = InstanceEntryBuilder.make().updatedAt(1000).build();
        expect(entry.pid).toBe(process.pid);
        expect(entry.workspace).toBe('<no-folder>');
        expect(entry.branch).toBeNull();
        expect(entry.group).toBe('');
        expect(entry.updatedAt).toBe(1000);
    });

    it('chains setters in any order', () => {
        const entry = InstanceEntryBuilder.make()
            .group('acme-app')
            .branch('main')
            .pid(1234)
            .workspace('/x')
            .updatedAt(42)
            .build();
        expect(entry).toEqual({
            pid: 1234,
            workspace: '/x',
            branch: 'main',
            group: 'acme-app',
            updatedAt: 42,
        });
    });

    it('falls back to Date.now() when updatedAt is not supplied', () => {
        const before = Date.now();
        const entry = InstanceEntryBuilder.make().build();
        const after = Date.now();
        expect(entry.updatedAt).toBeGreaterThanOrEqual(before);
        expect(entry.updatedAt).toBeLessThanOrEqual(after);
    });

    it('allows a null branch (used while git extension is loading)', () => {
        const entry = InstanceEntryBuilder.make().branch(null).updatedAt(1).build();
        expect(entry.branch).toBeNull();
    });

    it('produces independent results across builds', () => {
        const builder = InstanceEntryBuilder.make().group('acme-app');
        const a = builder.branch('main').updatedAt(1).build();
        const b = builder.branch('feat/x').updatedAt(2).build();
        expect(a.branch).toBe('main');
        expect(b.branch).toBe('feat/x');
        // Mutating the builder after the first build should not retroactively
        // change the already-built entry.
        expect(a.updatedAt).toBe(1);
    });
});
