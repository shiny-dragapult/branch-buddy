import { defineConfig } from '@vscode/test-cli';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const coverageRoot = root.replaceAll(path.sep, path.posix.sep);

export default defineConfig({
    tests: [{
        label: 'integration',
        files: 'out-test/tests-integration/**/*.test.js',
        version: 'stable',
        srcDir: path.join(root, 'out-test', 'src'),
        workspaceFolder: './tests-integration/fixtures/test-repo',
        env: {
            BRANCH_SYNC_DISABLE_AUTO_START: '1',
        },
        mocha: {
            ui: 'tdd',
            color: true,
            timeout: 20000,
        },
    }],
    coverage: {
        // c8 options (bundled with @vscode/test-cli). The CLI only uses this
        // when invoked with --coverage.
        reporter: ['text', 'html', 'lcov', 'json-summary', 'cobertura'],
        include: [path.posix.join(coverageRoot, 'out-test', 'src', '**', '*.js')],
    },
});
