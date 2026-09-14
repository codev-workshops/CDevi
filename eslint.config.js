// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

const DR07 =
  'DR-07: inline styles are not allowed. Use component props, or a `--cd-*` custom-property prop for dynamic values (packages/design-system/DESIGN.md §6).';

/** Rules that apply to application UI code and to the violation fixtures. */
export const designSystemRules = {
  'react/forbid-dom-props': ['error', { forbid: [{ propName: 'style', message: DR07 }] }],
  'react/forbid-component-props': ['error', { forbid: [{ propName: 'style', message: DR07 }] }],
  'jsx-a11y/no-static-element-interactions': 'error',
  'jsx-a11y/click-events-have-key-events': 'error',
  'jsx-a11y/no-noninteractive-element-interactions': 'error',
  'jsx-a11y/control-has-associated-label': [
    'error',
    { ignoreElements: ['audio', 'canvas', 'embed', 'input', 'textarea', 'tr', 'video'] },
  ],
  'jsx-a11y/no-autofocus': 'error',
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/gallery-dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.next/**',
      'apps/web/next-env.d.ts',
      'packages/design-system/reference-screens/**',
      'packages/design-system/tailwind/preset.cjs',
      'packages/design-system/src/tokens.generated.ts',
      // Fixtures are linted by tools/lint-fixtures/fixtures.test.ts and are expected to fail.
      'tools/lint-fixtures/*.tsx',
      'tools/lint-fixtures/*.css',
      'specs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['**/*.{jsx,tsx}'],
    ...react.configs.flat.recommended,
    ...react.configs.flat['jsx-runtime'],
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.strict.rules,
      // WAI-ARIA Authoring Practices: a tabpanel is in the tab sequence so keyboard users reach its content.
      'jsx-a11y/no-noninteractive-tabindex': ['error', { roles: ['tabpanel'] }],
      'react/prop-types': 'off',
    },
  },
  // Design-system enforcement for application code (apps/**) and fixtures.
  {
    files: ['apps/**/*.{jsx,tsx}', 'tools/lint-fixtures/**/*.{jsx,tsx}'],
    plugins: { react, 'jsx-a11y': jsxA11y },
    rules: designSystemRules,
  },
  // The package itself may set `--cd-*` custom properties via style (the single allow-listed mechanism).
  {
    files: ['packages/design-system/src/**/*.{jsx,tsx}'],
    plugins: { react, 'jsx-a11y': jsxA11y },
    rules: {
      ...designSystemRules,
      'react/forbid-dom-props': 'off',
      'react/forbid-component-props': 'off',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/tests/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
