import * as fs from 'fs';
import * as path from 'path';
import { DisposableLike, Registry } from '../types';

/**
 * Filesystem-backed shared registry, one JSON file under the OS temp dir.
 *
 * Pure I/O — no `vscode` dependency. The class is constructed via the static
 * factory `RegistryStore.at(filePath)`. Setup methods (`ensureDir`,
 * `ensureFile`) chain so call sites can read like a sentence:
 *
 *     RegistryStore.at(p).ensureDir().ensureFile().write({ instances: {} });
 */
export class RegistryStore {
    private constructor(private readonly filePath: string) {}

    static at(filePath: string): RegistryStore {
        return new RegistryStore(filePath);
    }

    get path(): string {
        return this.filePath;
    }

    ensureDir(): this {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return this;
    }

    ensureFile(): this {
        this.ensureDir();
        if (!fs.existsSync(this.filePath)) {
            this.write({ instances: {} });
        }
        return this;
    }

    read(): Registry {
        try {
            if (!fs.existsSync(this.filePath)) return { instances: {} };
            const raw = fs.readFileSync(this.filePath, 'utf8');
            const parsed = JSON.parse(raw) as Registry;
            if (!parsed || typeof parsed !== 'object' || !parsed.instances) {
                return { instances: {} };
            }
            return parsed;
        } catch {
            return { instances: {} };
        }
    }

    /** Best-effort atomic write via temp file + rename. Last-write-wins. */
    write(reg: Registry): void {
        this.ensureDir();
        const tmp = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
        try {
            fs.writeFileSync(tmp, JSON.stringify(reg, null, 2), 'utf8');
            fs.renameSync(tmp, this.filePath);
        } catch {
            // On rare contention (e.g. Windows file locking), fall back to
            // direct write. Registry sync is best-effort by design.
            try {
                fs.writeFileSync(this.filePath, JSON.stringify(reg, null, 2), 'utf8');
            } catch {
                // swallow
            }
            try {
                fs.unlinkSync(tmp);
            } catch {
                // ignore
            }
        }
    }

    /**
     * Watch the registry file for changes. Returns a disposable, or `undefined`
     * if the watcher could not be installed (callers should fall back to
     * polling).
     */
    watch(cb: () => void): DisposableLike | undefined {
        try {
            this.ensureFile();
            const w = fs.watch(this.filePath, { persistent: false }, () => cb());
            return { dispose: () => w.close() };
        } catch {
            return undefined;
        }
    }
}
