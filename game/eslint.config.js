// ESLint flat config.
// Module-boundary rules from the architecture (T0016 §4.2) that need real path
// resolution are enforced by tests/unit/boundaries.test.ts, which runs in `npm test`.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Rule 2: Rapier is imported only in src/physics/rapier/.
    files: ['src/**/*.ts'],
    ignores: ['src/physics/rapier/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@dimforge/*'],
              message: 'Only src/physics/rapier/ may import Rapier. Use PhysicsAPI instead.',
            },
          ],
        },
      ],
    },
  },
  {
    // core/log.ts is the one place allowed to write to the console.
    files: ['src/core/log.ts', 'tools/**', 'tests/**'],
    rules: { 'no-console': 'off' },
  },
);
