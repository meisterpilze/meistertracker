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
        // Used to bound outbound requests (harvest-feed.js) so a receiver that
        // accepts the connection and then goes quiet cannot pin a timer open.
        AbortController: 'readonly',
        // Its sibling. channels.js and shipping.js call `AbortSignal.timeout(...)`
        // on every eBay/Etsy/Sendcloud request; both files were outside the lint
        // scope until now, so the missing declaration never surfaced.
        AbortSignal: 'readonly',
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
    // Browser-side files. app.js is 18k lines of UI and business logic that was
    // outside the lint script until now — the config already globbed it, only the
    // npm script left it out, so every rule below was being computed and thrown
    // away. Declaring the browser globals is what makes `no-undef` usable here:
    // without them it reports ~1300 hits for `document`/`window`/etc. and buries
    // the real ones.
    //
    // Note on `no-unused-vars` (a warning, so it does not fail CI): of its 61 hits
    // in app.js, 14 are handlers reached only from inline `onclick="fn()"` strings
    // that ESLint cannot see — but 17 are defined once and referenced nowhere, so
    // the rule is pointing at real dead code and is worth reading, not dismissing.
    // It stays a warning only because clearing 61 judgement calls does not belong
    // in the commit that turns linting on.
    files: ['app.js', 'login.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        // Flat config MERGES globals across every matching block, and the base
        // `**/*.js` block above declares the Node set — so without switching them
        // off here, `require`, `process`, `Buffer`, `module` and friends count as
        // defined in browser code. `no-undef` is the one rule set to 'error' and
        // the entire point of this block, yet a server idiom pasted into app.js
        // would lint clean and then throw ReferenceError in the browser on first
        // execution. 'off' removes an inherited global.
        require: 'off',
        module: 'off',
        exports: 'off',
        __dirname: 'off',
        __filename: 'off',
        process: 'off',
        Buffer: 'off',
        setImmediate: 'off',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'writable',
        localStorage: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        fetch: 'readonly',
        crypto: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        EventSource: 'readonly',
        BroadcastChannel: 'readonly',
        MutationObserver: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly',
        Image: 'readonly',
        CSS: 'readonly',
        // Vendor libs injected on demand by loadVendorLibs() from /lib/, which is
        // in `ignores` — so they are genuinely global-at-runtime, not typos.
        Chart: 'readonly',
        QRCode: 'readonly',
        JsBarcode: 'readonly',
        Html5Qrcode: 'readonly'
      }
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
        // Used to bound the app-shell network-first fetch so a hung request
        // falls back to cache instead of blocking the page.
        AbortSignal: 'readonly',
      }
    }
  },
  prettier
];
