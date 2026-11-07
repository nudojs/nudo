/**
 * Bug 840 回归：`@nudo:case` 见证的**字符串转义不解释**。
 *
 * 旧实现按「首尾是引号」原样 slice（`s.slice(1, -1)`），转义序列保持**字面
 * 反斜杠** ⇒ 见证值 `a\tb`（4 字符）与侧车契约（真实 JS 求值 `a<TAB>b`，
 * 3 字符）落在**不同的字符串**上 ⇒ `witness ⊭ contract` 假红。
 *
 * 修法：字符串分支走**词法边界**判定 + JS 语义转义解释
 * （`directives/string-literal.ts` 单源，Babel 的 StringLiteral cooked 值）。
 */
import { describe, it, expect } from "vitest";
import { extractDirectives, parseCaseArgExpr } from "../directives.ts";
import { litValue, type Abs } from "@nudojs/core";
import { parse } from "../parse.ts";

function firstCase(source: string): { name: string; argsAbs: Abs[] } {
  const fns = extractDirectives(parse(source));
  const d = fns[0]?.directives.find((x) => x.kind === "case");
  if (!d || d.kind !== "case") throw new Error("expected case directive");
  return d as { name: string; argsAbs: Abs[] };
}

describe("Bug 840: string literal escapes follow JS semantics", () => {
  it("interprets \\t as TAB", () => {
    expect(litValue(parseCaseArgExpr('"a\\tb"'))).toEqual({ ok: true, value: "a\tb" });
  });

  it("interprets \\n as LF", () => {
    expect(litValue(parseCaseArgExpr('"a\\nb"'))).toEqual({ ok: true, value: "a\nb" });
  });

  it("interprets \\\\ as one backslash", () => {
    expect(litValue(parseCaseArgExpr('"a\\\\b"'))).toEqual({ ok: true, value: "a\\b" });
  });

  it("interprets \\\" as a quote", () => {
    expect(litValue(parseCaseArgExpr('"a\\"b"'))).toEqual({ ok: true, value: 'a"b' });
  });

  it("interprets \\uXXXX", () => {
    expect(litValue(parseCaseArgExpr('"\\u0041"'))).toEqual({ ok: true, value: "A" });
  });

  it("keeps plain strings unchanged", () => {
    expect(litValue(parseCaseArgExpr('"ab"'))).toEqual({ ok: true, value: "ab" });
    expect(litValue(parseCaseArgExpr("'ab'"))).toEqual({ ok: true, value: "ab" });
  });

  it("case witness carries the cooked (escape-interpreted) value", () => {
    const d = firstCase(`
/**
 * @nudo:case "esc" ("a\\tb")
 */
export function f(x) { return x; }
`);
    expect(d.argsAbs).toHaveLength(1);
    expect(litValue(d.argsAbs[0]!)).toEqual({ ok: true, value: "a\tb" });
  });

  it("no literal backslash survives in the witness value", () => {
    const abs = parseCaseArgExpr('"a\\tb"');
    const lv = litValue(abs);
    expect(lv.ok).toBe(true);
    if (!lv.ok) return;
    expect(String(lv.value)).not.toContain("\\");
    expect(String(lv.value).length).toBe(3);
  });
});
