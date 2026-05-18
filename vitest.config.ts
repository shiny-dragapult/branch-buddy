import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        exclude: [
            '**/node_modules/**',
            'tests-integration/**',
            'out/**',
            'out-test/**',
        ],
        environment: 'node',
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov', 'json-summary', 'cobertura'],
            reportsDirectory: 'coverage/unit',
            include: [
                'src/config/Config.ts',
                'src/registry/**/*.ts',
                'src/detection/**/*.ts',
            ],
            exclude: [
                '**/node_modules/**',
                'tests/**',
                'tests-integration/**',
                'out/**',
                'out-test/**',
                '**/*.test.ts',
                '**/*.test.js',
            ],
        },
    },
});
