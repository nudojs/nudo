/**
 * Codegen escaping: one policy for embedding user-controlled strings into
 * generated JS/TS/comments (guard bodies, .d.ts types, schema modules, JSDoc).
 *
 * - object keys: bare JS ident or canonical integer, else JSON-quoted
 * - member access: `recv.key` for idents, `recv["key"]` otherwise
 * - template literal type fixed segments: escape `\` `` ` `` `$`
 * - comment bodies: neutralize block-comment close, line breaks, control chars
 * - binding names (`export const/function`, params): ident + non-reserved
 */

const JS_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Unicode-aware IdentifierStart / IdentifierPart (ES2015+).
 * Binding names may be full Unicode (`计算` is legal); object-key quoting
 * still uses the ASCII `JS_IDENT` and falls back to JSON quotes.
 */
const JS_BINDING_IDENT =
  /^(?:[$_\p{ID_Start}])(?:[$\u200C\u200D\p{ID_Continue}])*$/u;

/**
 * Words that cannot appear as a binding name in module / strict code:
 * keywords, future-reserved, strict-mode reserved, and the two
 * never-legal strict bindings (`eval`, `arguments`).
 */
const JS_BINDING_RESERVED = new Set([
  // ECMA-262 keywords
  "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "enum", "export", "extends", "false",
  "finally", "for", "function", "if", "import", "in", "instanceof", "new",
  "null", "return", "super", "switch", "this", "throw", "true", "try",
  "typeof", "var", "void", "while", "with", "yield",
  // strict mode / module-code reserved
  "let", "static", "await",
  "implements", "interface", "package", "private", "protected", "public",
  // never legal bindings in strict / module code
  "eval", "arguments",
]);

/** ES NumericLiteral without legacy-octal / leading-zero forms (0, 123; not 01). */
const JS_CANONICAL_INT = /^(?:0|[1-9]\d*)$/;

export function isJsIdent(name: string): boolean {
  return JS_IDENT.test(name);
}

/**
 * True when `name` is legal as a `const` / `function` / `class` binding
 * (or a `.d.ts` param / type-param name): IdentifierName shape and not
 * a reserved word. Unlike `isJsIdent`, accepts Unicode identifiers and
 * rejects `class` / `default` / `let` / `eval` / …
 */
export function isJsBindingIdent(name: string): boolean {
  return JS_BINDING_IDENT.test(name) && !JS_BINDING_RESERVED.has(name);
}

/**
 * Binding name for a generated `export const` / `export function` slot.
 *
 * - already a legal binding → unchanged (Unicode names preserved)
 * - reserved word → `_` prefix (`class` → `_class`)
 * - otherwise sanitize: non-ident chars → `_`, leading non-start → `_` prefix
 * - `used` (when given) de-duplicates within one generated module
 *   (`a_b`, `a_b_2`, …) so cleaned names cannot collide
 */
export function toJsBindingIdent(name: string, used?: Set<string>): string {
  let base = name;
  if (!JS_BINDING_IDENT.test(base)) {
    base = base.replace(/[^\p{ID_Continue}$\u200C\u200D]/gu, "_");
    if (base.length === 0) base = "_";
    else if (!/^[$_\p{ID_Start}]/u.test(base)) base = `_${base}`;
  }
  if (JS_BINDING_RESERVED.has(base)) base = `_${base}`;
  if (!used) return base;
  let n = base;
  let i = 2;
  while (used.has(n)) {
    n = `${base}_${i}`;
    i++;
  }
  used.add(n);
  return n;
}

/**
 * Object-literal / type-member key: bare ident or canonical integer,
 * otherwise JSON-quoted. Leading-zero digit keys (`01`) stay quoted — bare
 * `01` is a SyntaxError in modules/TS.
 */
export function formatObjectKey(k: string): string {
  if (JS_IDENT.test(k)) return k;
  if (JS_CANONICAL_INT.test(k)) return k;
  return JSON.stringify(k);
}

/**
 * Member-access expression: `recv.key` for idents, `recv["key"]` otherwise.
 * Bare non-ident keys inject operators (`foo||true||bar`) or SyntaxError.
 */
export function safeMemberAccess(recv: string, key: string): string {
  return JS_IDENT.test(key) ? `${recv}.${key}` : `${recv}[${JSON.stringify(key)}]`;
}

/**
 * Escape a fixed text segment for a TypeScript template literal type.
 * Escapes `\`, `` ` ``, and `$` so `${` cannot open a type interpolation.
 */
export function escapeTemplateTypeFixed(text: string): string {
  return text.replace(/[\\`$]/g, "\\$&");
}

/**
 * Sanitize text destined for a generated comment body (JSDoc `* ` or `//`).
 * Neutralizes the block-comment close sequence, line breaks (U+2028/2029
 * included), and control characters so the comment cannot be broken out of.
 */
export function sanitizeCommentText(text: string): string {
  return text
    .replace(/\*\//g, "*\\/")
    .replace(/[\r\n\u2028\u2029\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ");
}
