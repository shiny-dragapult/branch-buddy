import { InstanceEntry } from '../types';

/**
 * Fluent builder for `InstanceEntry`. Each setter returns `this` so that
 * call sites read top-to-bottom:
 *
 *     InstanceEntryBuilder.make()
 *         .branch('main')
 *         .group('acme-app')
 *         .workspace('/path/to/repo')
 *         .build();
 */
export class InstanceEntryBuilder {
    private _pid: number = process.pid;
    private _workspace = '<no-folder>';
    private _branch: string | null = null;
    private _group = '';
    private _updatedAt: number | undefined;

    private constructor() {}

    static make(): InstanceEntryBuilder {
        return new InstanceEntryBuilder();
    }

    pid(v: number): this {
        this._pid = v;
        return this;
    }

    workspace(v: string): this {
        this._workspace = v;
        return this;
    }

    branch(v: string | null): this {
        this._branch = v;
        return this;
    }

    group(v: string): this {
        this._group = v;
        return this;
    }

    updatedAt(v: number): this {
        this._updatedAt = v;
        return this;
    }

    build(): InstanceEntry {
        return {
            pid: this._pid,
            workspace: this._workspace,
            branch: this._branch,
            group: this._group,
            updatedAt: this._updatedAt ?? Date.now(),
        };
    }
}
