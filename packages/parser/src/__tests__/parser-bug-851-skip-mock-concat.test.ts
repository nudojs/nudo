/**
 * Bug 851 回归：同一贪婪切片在 `@nudo:skip` / `@nudo:mock` **声明面**。
 *
 * `@nudo:skip => "a" + "b"` 的声明返回类型、`@nudo:mock` 载荷里的字符串值
 * 都走同一套字符串分支 ⇒ 旧实现把 `a" + "b` 折成**声明的类型 / mock 值**
 * ⇒ 签名与 dts 给出**错误的类型声明**（谁也没写过的字符串）。
 *
 * 修法：与 Bug 849 同源——字符串分支的词法边界判定单源在
 * `directives/string-literal.ts`；非单个字面量 ⇒ unknown（不折错值）。
 */
import { describe, it, expect } from "vitest";
import { extractDirectives } from "../directives.ts";
import { parseAbsExpr } from "../directives/case-arg.ts";
import { parseSinonExpr } from "../directives/mock-expr.ts";
import { litValue, type Abs } from "@nudojs/core";
import { parse } from "../parse.ts";

describe("Bug 851: skip / mock declaration faces reject non-literals", () => {
  it("@nudo:skip return type is unknown, not a wrong string", () => {
    const fns = extractDirectives(
      parse(`
/**
 * @nudo:skip => "a" + "b"
 */
export function f() { return "ab"; }
`),
    );
    const d = fns[0]?.directives.find((x) => x.kind === "skip");
    expect(d).toBeDefined();
    if (!d || d.kind !== "skip") return;
    const returns = d.returns as Abs | undefined;
    expect(returns).toBeDefined();
    expect(["unknown", "never"]).toContain(returns!.shape.k);
    expect(litValue(returns!).ok).toBe(false);
  });

  it("mock payload value is unknown, not a wrong string", () => {
    const abs = parseAbsExpr('"a" + "b"');
    expect(["unknown", "never"]).toContain(abs.shape.k);
    expect(litValue(abs).ok).toBe(false);
  });

  it("sinon mock return value is unknown, not a wrong string", () => {
    const expr = parseSinonExpr('sinon.stub().returns("a" + "b")');
    expect(expr).not.toBeNull();
    const lv = expr ? litValue(expr.returnValue!) : { ok: false as const };
    expect(lv.ok).toBe(false);
  });

  it("a literal mock payload is unaffected", () => {
    const expr = parseSinonExpr('sinon.stub().returns("ab")');
    expect(expr).not.toBeNull();
    if (!expr) return;
    expect(litValue(expr.returnValue!)).toEqual({ ok: true, value: "ab" });
  });
});
