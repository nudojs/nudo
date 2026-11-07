/**
 * Bug 849 回归：`@nudo:case` **期望值**面的字符串字面量**贪婪切片**。
 *
 * 旧实现的守卫只做 `startsWith(quote) && endsWith(quote)` ⇒ `"a" + "b"`
 * 的首引号在 0、末引号在末尾 ⇒ `slice(1, -1)` 把**两个独立字面量之间的
 * 运算符文本**一起吞进值里 ⇒ 折出 `a" + "b`（谁也没写过的**自信错值**）
 * ⇒ 断言假红，诊断里的 expected 是一段无意义文本。
 *
 * 修法：字符串分支先确认整段文本**就是**一个字符串字面量
 * （词法边界判定，见 `directives/string-literal.ts`），否则当「不认识」
 * （unknown + nudo:directive-syntax 诊断），不再折出错值。
 */
import { describe, it, expect } from "vitest";
import {
  extractDirectives,
  parseCaseArgExpr,
  runWithDirectiveDiags,
  type DirectiveDiag,
} from "../directives.ts";
import { litValue, type Abs } from "@nudojs/core";
import { parse } from "../parse.ts";

describe("Bug 849: string concatenation is not a string literal", () => {
  it("does not fold \"a\" + \"b\" into a literal value", () => {
    const abs = parseCaseArgExpr('"a" + "b"');
    expect(["unknown", "never"]).toContain(abs.shape.k);
    expect(abs.term).toBeUndefined();
    expect(litValue(abs).ok).toBe(false);
  });

  it("does not fold longer concatenations either", () => {
    expect(parseCaseArgExpr('"x" + "y" + "z"').shape.k).toBe("unknown");
    expect(parseCaseArgExpr("'a' + 'b'").shape.k).toBe("unknown");
  });

  it("expected value of a case directive is unknown, not a wrong string", () => {
    const src = `
/**
 * @nudo:case "a" () => "a" + "b"
 */
export function a() { return "ab"; }
`;
    const fns = extractDirectives(parse(src));
    const d = fns[0]?.directives.find((x) => x.kind === "case");
    expect(d).toBeDefined();
    if (!d || d.kind !== "case") return;
    const expected = d.expected as Abs | undefined;
    expect(expected).toBeDefined();
    // 「解析失败」的表示：unknown（不认识）或 never（断言面 fail-closed 表示）——
    // 两种都不是**自信的错值**（绝不等于 `a" + "b`）。
    expect(["unknown", "never"]).toContain(expected!.shape.k);
    expect(litValue(expected!).ok).toBe(false);
  });

  it("emits nudo:directive-syntax for the unrecognized expected value", () => {
    const diags: DirectiveDiag[] = [];
    runWithDirectiveDiags(diags, () => {
      extractDirectives(
        parse(`
/**
 * @nudo:case "a" () => "a" + "b"
 */
export function a() { return "ab"; }
`),
      );
    });
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.some((d) => d.code === "nudo:directive-syntax")).toBe(true);
  });

  it("a single literal is still accepted", () => {
    expect(litValue(parseCaseArgExpr('"abc"'))).toEqual({ ok: true, value: "abc" });
  });
});
