/**
 * Codegen escaping: one policy for embedding user-controlled strings into
 * generated JS/TS/comments (guard bodies, .d.ts types, schema modules, JSDoc).
 *
 * - object keys: bare JS ident or canonical integer, else JSON-quoted
 * - member access: `recv.key` for idents, `recv["key"]` otherwise
 * - template literal type fixed segments: escape `\` `` ` `` `$`
 * - comment bodies: neutralize block-comment close, line breaks, control chars
 */

const JS_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** ES NumericLiteral without legacy-octal / leading-zero forms (0, 123; not 01). */
const JS_CANONICAL_INT = /^(?:0|[1-9]\d*)$/;

export function isJsIdent(name: string): boolean {
  return JS_IDENT.test(name);
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
