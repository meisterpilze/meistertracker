const prettier = require('eslint-config-prettier');

module.exports = [
  {
    files: ['**/*.js'],
    ignores: ['lib/**', 'node_modules/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // Node.js globals
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setImmediate: 'readonly',
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-constant-condition': 'warn',
      'no-debugger': 'error',
      'no-duplicate-case': 'error',
      // Empty `catch {}` is an established pattern in this codebase for
      // best-effort cleanup (rmSync, unlinkSync) and optional stat lookups
      // where a missing file is fine. Real silent-error bugs get caught
      // in review.
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-unreachable': 'error',
      'eqeqeq': ['warn', 'smart'],
      'no-var': 'warn',
      'prefer-const': ['warn', { destructuring: 'all' }],
    }
  },
  {
    files: ['sw.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        indexedDB: 'readonly',
        IDBKeyRange: 'readonly',
      }
    }
  },
  prettier
];
