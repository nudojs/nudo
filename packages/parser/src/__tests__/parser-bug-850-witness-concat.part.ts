/**
 * Bug 850 回归：同一贪婪切片在 `@nudo:case` **见证**面。
 *
 * 见证实参走 `parseAbsExprDiag` → `parseCaseArgExpr`；旧实现的字符串分支
 * 只查首尾引号 ⇒ `("a" + "b")` 折成 `a" + "b`（自信的错值）⇒ 见证 ⊭ 契约
 * ⇒ 契约门禁**假红**（用户写的见证恰好就是契约要求的值）。
 *
 * 修法：与 Bug 849 同源（字符串分支的词法边界判定）⇒ 非单个字面量落
 * unknown（诊断给出），不再折出错值。
 *
 * 注：`nudo check` 的见证执法面在 core `algebra/check-case-scan.ts`
 * 的 `parseLitArg`（**自带的**贪婪切片，不读 parser 的结果）——core 侧
 * 的同源收口由主 agent 统一处理（见交付报告「需主 agent 收口」段）。
 */
import { describe, it, expect } from "vitest";
import { extractDirectives, parseCaseArgExpr } from "../directives.ts";
import { litValue, type Abs } from "@nudojs/core";
import { parse } from "../parse.ts";

function caseArgs(source: string): Abs[] {
  const fns = extractDirectives(parse(source));
  const d = fns[0]?.directives.find((x) => x.kind === "case");
  if (!d || d.kind !== "case") throw new Error("expected case directive");
  return d.argsAbs;
}

describe("Bug 850: case witness concatenation is not a literal", () => {
  it("witness argument of a concatenation is unknown, not a wrong string", () => {
    const args = caseArgs(`
/**
 * @nudo:case "c" ("a" + "b")
 */
export function f(x) { return x; }
`);
    expect(args).toHaveLength(1);
    // 「解析失败」的表示：unknown（不认识）或 never（fail-closed 表示）——
    // 两种都不是**自信的错值**（绝不等于 `a" + "b`）。
    expect(["unknown", "never"]).toContain(args[0]!.shape.k);
    expect(args[0]!.term).toBeUndefined();
    expect(litValue(args[0]!).ok).toBe(false);
  });

  it("the wrong value \"a\\\" + \\\"b\" is never produced", () => {
    const abs = parseCaseArgExpr('"a" + "b"');
    const lv = litValue(abs);
    expect(lv.ok).toBe(false);
  });

  it("a literal witness is unaffected", () => {
    const args = caseArgs(`
/**
 * @nudo:case "c" ("ab")
 */
export function f(x) { return x; }
`);
    expect(litValue(args[0]!)).toEqual({ ok: true, value: "ab" });
  });
});
