import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Type checking and unused names are left to tsc (tsconfig.json); this catches what tsc cannot,
// mainly React hook rules and dependency lists.

export default tseslint.config(
  { ignores: ['dist', 'public', 'mockup-src', 'src/io/appsScript.gs'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': 'off'
    }
  }
);
