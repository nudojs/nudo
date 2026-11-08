/**
 * Bug 60 回归：`Array.prototype.sort / reverse / fill / copyWithin / concat`
 * 借用给 **nullish 接收者**必须记抛（ES2023 RequireObjectCoercible(this)）。
 * `$lit(null/undefined)` 的 shape.k 是 "unknown" 而非 "prim"，此前绕过
 * prim 守卫 ⇒ sort 一族原样返回 nullish、concat 包成 [null]（假绿 + 错值）。
 */
import { describe, it, expect } from "vitest";
import { call, isNever, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

const CASES: Array<[string, string]> = [
  ["sort", `const s = Array.prototype.sort; return s.call(null);`],
  ["reverse", `const s = Array.prototype.reverse; return s.call(undefined);`],
  ["concat", `return Array.prototype.concat.call(null);`],
  ["fill", `return Array.prototype.fill.call(null, 1);`],
  ["copyWithin", `return Array.prototype.copyWithin.call(undefined, 0, 1);`],
];

describe("Bug 60 — Array 借用方法 nullish 接收者记抛", () => {
  for (const [name, body] of CASES) {
    it(`${name}.call(nullish) ⇒ definite TypeError`, () => {
      const r = call(wrap(body));
      expect(isNever(r.result), name).toBe(true);
      expect(throwsError(r.throws, "TypeError"), name).toBe(true);
    });
  }

  it("负控制：非 nullish 接收者仍不抛（join / sort / concat）", () => {
    for (const body of [
      `return Array.prototype.join.call([1,2]);`,
      `return Array.prototype.sort.call([2,1]);`,
      `return Array.prototype.concat.call([1], 2);`,
      `return Array.prototype.sort.call({a:1});`,
    ]) {
      const r = call(wrap(body));
      expect(isNever(r.result), body).toBe(false);
    }
  });
});
