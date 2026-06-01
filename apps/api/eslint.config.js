// @ts-check
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Apply recommended TS rules to all TS source files
  {
    files: ['src/**/*.ts'],
    extends: [
      ...tseslint.configs.recommended,
    ],
    rules: {
      // Allow `any` in service-boundary code (e.g. Fastify reply types)
      '@typescript-eslint/no-explicit-any': 'warn',
      // Unused variables are errors (catches dead imports)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Avoid accidental floating promises in async route handlers
      '@typescript-eslint/no-floating-promises': 'error',
      // Consistent type import style (required by verbatimModuleSyntax)
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Ignore built output and node_modules
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
)
