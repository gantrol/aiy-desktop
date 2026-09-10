import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'browser-companion/.output/**',
      'browser-companion/.wxt/**',
      '.tmp/**',
      '.electron-vite/**',
      '.webpack/**',
      'coverage/**',
      'dist/**',
      'node_modules/**',
      'out/**',
      'playwright-report/**',
      'release/**',
      'src/renderer/.tmp/**',
      'test-results/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...js.configs.recommended,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: globals.node,
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      complexity: ['error', 30],
      'max-depth': ['error', 5],
      'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 250, skipBlankLines: true, skipComments: true }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^\\.{1,2}/(?!.*\\.(?:css|scss|sass|less|svg|png|jpe?g|webp|gif|mp4|webm|woff2?|json|sql)(?:\\?.*)?$)',
              message: 'Use the @/ source alias for project-internal TypeScript modules.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    files: [
      'src/main/app/media-*.ts',
      'src/main/media/*thumbnail*.ts',
      'src/main/database/assets/gallery*.ts',
      'src/main/database/albums/material-album-{reader,scopes}.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^(node:)?fs$/] ImportSpecifier[imported.name=/Sync$/]',
          message: 'Media and gallery loading must use asynchronous file I/O from node:fs/promises.',
        },
        {
          selector: 'CallExpression[callee.name=/Sync$/]',
          message: 'Synchronous I/O must not block the media or gallery loading path.',
        },
        {
          selector: 'CallExpression[callee.property.name=/Sync$/]',
          message: 'Synchronous I/O must not block the media or gallery loading path.',
        },
      ],
    },
  },
  eslintConfigPrettier,
);
