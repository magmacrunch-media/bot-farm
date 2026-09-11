// Flat config, the family standard (consolidated in sprite-forge).
//
// Three kinds of file:
//   app/        classic scripts attaching to window.BotFarm — sourceType
//               "script", an `import` here is an error (see AGENTS.md)
//   tests/      ESM on Node, browser shimmed by the kit harness
//   scripts/    ESM on Node, dev-time only
//
// app/shell/ (vendored chrome) and app/kit/ (vendored kit — generated, edit
// in magma-kit) are not linted here; their upstreams lint them.

const browser = {
    window: 'writable', document: 'readonly', console: 'readonly',
    setTimeout: 'readonly', clearTimeout: 'readonly',
    setInterval: 'readonly', clearInterval: 'readonly',
    requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
    Image: 'readonly', ImageData: 'readonly', URL: 'readonly', Blob: 'readonly',
    FileReader: 'readonly', fetch: 'readonly', navigator: 'readonly',
    localStorage: 'readonly', location: 'readonly', alert: 'readonly',
    confirm: 'readonly', prompt: 'readonly',
    KeyboardEvent: 'readonly', MouseEvent: 'readonly', Event: 'readonly',
    MutationObserver: 'readonly', CustomEvent: 'readonly',
    BotFarm: 'writable', MagmaKit: 'readonly', Toast: 'readonly',
};

const node = {
    console: 'readonly', process: 'readonly', Buffer: 'readonly',
    __dirname: 'readonly', __filename: 'readonly',
    setTimeout: 'readonly', clearTimeout: 'readonly',
    setInterval: 'readonly', clearInterval: 'readonly',
    URL: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
};

const rules = {
    'no-unused-vars': ['warn', { args: 'none' }],
    'no-undef': 'error',
    'no-redeclare': 'warn',
    'no-duplicate-case': 'error',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-unreachable': 'error',
    'no-constant-condition': 'warn',
    'no-extra-semi': 'error',
    'no-dupe-keys': 'error',
    'no-shadow-restricted-names': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
    eqeqeq: ['warn', 'smart'],
    'no-caller': 'error',
    'no-eval': 'warn',
    'no-implied-eval': 'warn',
    'no-new-wrappers': 'error',
    'no-throw-literal': 'warn',
    'no-self-compare': 'warn',
    'no-unused-expressions': 'warn',
    'no-useless-call': 'warn',
    'no-useless-concat': 'warn',
    'no-useless-escape': 'warn',
    'no-with': 'error',
    'no-loop-func': 'warn',
    'no-new-func': 'warn',
};

export default [
    {
        ignores: ['node_modules/**', 'desktop/**', '.claude/**', 'app/shell/**', 'app/kit/**'],
    },
    {
        files: ['app/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: browser,
        },
        rules,
    },
    {
        files: ['tests/**/*.mjs', 'scripts/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: node,
        },
        rules,
    },
];
