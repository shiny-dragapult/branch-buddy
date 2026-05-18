import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            'coverage/**',
            'node_modules/**',
            'out/**',
            'out-test/**',
            'tests-integration/fixtures/**',
            '**/*.js',
            '**/*.js.map',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],
        },
    },
    {
        files: ['tests/**/*.ts'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.vitest,
            },
        },
    },
    {
        files: ['tests-integration/**/*.ts'],
        languageOptions: {
            globals: {
                ...globals.node,
                suite: 'readonly',
                test: 'readonly',
            },
        },
    },
);
