/**
 * Self-contained Monarch for `nudo-js` — JS syntax colors without the
 * TypeScript language service (`parameter x: any` noise).
 */
const NUDO_JS_MONARCH = {
  defaultToken: '',
  tokenPostfix: '.js',
  ignoreCase: false,
  keywords: [
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
    'default', 'delete', 'do', 'else', 'export', 'extends', 'false',
    'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
    'let', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw',
    'true', 'try', 'typeof', 'undefined', 'var', 'void', 'while', 'with',
    'yield', 'async', 'await', 'of', 'static', 'get', 'set', 'from', 'as',
  ],
  typeKeywords: [
    'any', 'boolean', 'number', 'object', 'string', 'symbol', 'unknown',
    'void', 'never', 'Array', 'Promise', 'Map', 'Set',
  ],
  operators: [
    '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||',
    '++', '--', '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>', '>>>',
    '+=', '-=', '*=', '/=', '&=', '|=', '^=', '%=', '<<=', '>>=', '>>>=',
    '=>', '...',
  ],
  symbols: /[=><!~?:&|+\-*/^%]+/,
  escapes: /\\(?:[abfnrtv\\"'\n]|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|u\{[0-9A-Fa-f]+\}|[0-7]{1,3})/,
  tokenizer: {
    root: [
      [/\/\*\*(?!\/)/, 'comment.doc', '@jsdoc'],
      [/\/\*/, 'comment', '@comment'],
      [/\/\/.*$/, 'comment'],
      [/[{}()\[\]]/, '@brackets'],
      [/[;,.]/, 'delimiter'],
      [
        /[a-zA-Z_$][\w$]*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@typeKeywords': 'type',
            '@default': 'identifier',
          },
        },
      ],
      { include: '@whitespace' },
      [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
      [/\d+\.\d*([eE][-+]?\d+)?/, 'number.float'],
      [/0[xX][0-9a-fA-F]+/, 'number.hex'],
      [/\d+/, 'number'],
      [/[()]/, '@brackets'],
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/'([^'\\]|\\.)*$/, 'string.invalid'],
      [/"/, 'string', '@string_double'],
      [/'/, 'string', '@string_single'],
      [/`/, 'string', '@string_template'],
    ],
    whitespace: [[/[ \t\r\n]+/, '']],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],
    jsdoc: [
      [/[^/*]+/, 'comment.doc'],
      [/\*\//, 'comment.doc', '@pop'],
      [/[/*]/, 'comment.doc'],
    ],
    string_double: [
      [/[^\\"]+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, 'string', '@pop'],
    ],
    string_single: [
      [/[^\\']+/, 'string'],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/'/, 'string', '@pop'],
    ],
    string_template: [
      [/[^\\`$]+/, 'string'],
      [/\$\{/, { token: 'delimiter', next: '@templateExpression' }],
      [/@escapes/, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/`/, 'string', '@pop'],
    ],
    templateExpression: [
      [/}/, { token: 'delimiter', next: '@pop' }],
      { include: 'root' },
    ],
  },
} as const;

const NUDO_JS_LANG_CONFIG = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string'] },
    { open: "'", close: "'", notIn: ['string', 'comment'] },
    { open: '`', close: '`', notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: '`', close: '`' },
  ],
} as const;

/** Register `nudo-js` with a built-in tokenizer (before models are created). */
export function registerNudoJsLanguage(monaco: any): void {
  const LANG = 'nudo-js';
  const exists = monaco.languages
    .getLanguages()
    .some((l: { id: string }) => l.id === LANG);
  if (!exists) {
    monaco.languages.register({ id: LANG });
  }
  // Prefer a built-in tokenizer so highlighting never depends on JS LSP
  monaco.languages.setMonarchTokensProvider(LANG, NUDO_JS_MONARCH);
  try {
    monaco.languages.setLanguageConfiguration(LANG, NUDO_JS_LANG_CONFIG as any);
  } catch {
    // optional
  }
  // If the stock JS Monarch is available, merge its tokenizer as a richer base
  try {
    const jsMonarch = monaco.languages.getMonarchTokenProvider?.('javascript');
    if (jsMonarch?.tokenizer && jsMonarch !== NUDO_JS_MONARCH) {
      monaco.languages.setMonarchTokensProvider(LANG, {
        ...jsMonarch,
        tokenPostfix: jsMonarch.tokenPostfix ?? '.js',
      } as any);
    }
  } catch {
    // keep embedded monarch
  }
}
