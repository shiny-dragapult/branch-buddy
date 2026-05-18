"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const InstanceEntryBuilder_1 = require("../../src/registry/InstanceEntryBuilder");
(0, vitest_1.describe)('InstanceEntryBuilder', () => {
    (0, vitest_1.it)('uses sensible defaults when no setters are called', () => {
        const entry = InstanceEntryBuilder_1.InstanceEntryBuilder.make().updatedAt(1000).build();
        (0, vitest_1.expect)(entry.pid).toBe(process.pid);
        (0, vitest_1.expect)(entry.workspace).toBe('<no-folder>');
        (0, vitest_1.expect)(entry.branch).toBeNull();
        (0, vitest_1.expect)(entry.group).toBe('');
        (0, vitest_1.expect)(entry.updatedAt).toBe(1000);
    });
    (0, vitest_1.it)('chains setters in any order', () => {
        const entry = InstanceEntryBuilder_1.InstanceEntryBuilder.make()
            .group('acme-app')
            .branch('main')
            .pid(1234)
            .workspace('/x')
            .updatedAt(42)
            .build();
        (0, vitest_1.expect)(entry).toEqual({
            pid: 1234,
            workspace: '/x',
            branch: 'main',
            group: 'acme-app',
            updatedAt: 42,
        });
    });
    (0, vitest_1.it)('falls back to Date.now() when updatedAt is not supplied', () => {
        const before = Date.now();
        const entry = InstanceEntryBuilder_1.InstanceEntryBuilder.make().build();
        const after = Date.now();
        (0, vitest_1.expect)(entry.updatedAt).toBeGreaterThanOrEqual(before);
        (0, vitest_1.expect)(entry.updatedAt).toBeLessThanOrEqual(after);
    });
    (0, vitest_1.it)('allows a null branch (used while git extension is loading)', () => {
        const entry = InstanceEntryBuilder_1.InstanceEntryBuilder.make().branch(null).updatedAt(1).build();
        (0, vitest_1.expect)(entry.branch).toBeNull();
    });
    (0, vitest_1.it)('produces independent results across builds', () => {
        const builder = InstanceEntryBuilder_1.InstanceEntryBuilder.make().group('acme-app');
        const a = builder.branch('main').updatedAt(1).build();
        const b = builder.branch('feat/x').updatedAt(2).build();
        (0, vitest_1.expect)(a.branch).toBe('main');
        (0, vitest_1.expect)(b.branch).toBe('feat/x');
        // Mutating the builder after the first build should not retroactively
        // change the already-built entry.
        (0, vitest_1.expect)(a.updatedAt).toBe(1);
    });
});
//# sourceMappingURL=InstanceEntryBuilder.test.js.map