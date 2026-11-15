/**
 * Bug 852 回归：`@nudo:case` 实参 / 期望值的**结构字面量分支**（对象 / 数组）
 * 必须校验**整段**文本。
 *
 * 改前只看首尾两个字符 ⇒ 尾随文本被吞进槽位 / 元素 ⇒ 折出**自信的错值**
 * （`[1][0]` → `[unknown]`、`{ a: 1 } + { b: 2 }` → `{ a: unknown }`）⇒
 * 断言**假红**（期望值原生语义是数字 1）。
 *
 * 改后：整段文本不是（恰好）一个字面量 ⇒ 当「不认识」（unknown）⇒
 * 由既有诊断通道（parseAbsExprDiag / mock 载荷的 silentFallback）报
 * nudo:directive-syntax，不再硬切出错的结构。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import {
  extractDirectives,
  parseCaseArgExpr,
  type CaseDirective,
  type DirectiveDiag,
} from "../directives.ts";

describe("Bug 852: structure literal branches validate the whole text", () => {
  it("trailing member access after an array literal is not folded into the tuple", () => {
    // 改前：`[unknown]`（一个**错的** tuple，不是「不认识」）
    expect(parseCaseArgExpr("[1][0]").shape.k).toBe("unknown");
  });

  it("two object literals joined by + is not folded into one object", () => {
    // 改前：`{ a: unknown }`（错值）
    expect(parseCaseArgExpr("{ a: 1 } + { b: 2 }").shape.k).toBe("unknown");
  });

  it("member access / trailing text on a literal is not folded into a structure", () => {
    expect(parseCaseArgExpr("{ a: 1 }.b").shape.k).toBe("unknown");
    expect(parseCaseArgExpr("[1, 2].length").shape.k).toBe("unknown");
    expect(parseCaseArgExpr("{ a: 1 } tail").shape.k).toBe("unknown");
  });

  it("plain structure literals keep parsing (no regression)", () => {
    const obj = parseCaseArgExpr("{ a: 1 }");
    expect(obj.shape.k).toBe("obj");
    const tuple = parseCaseArgExpr("[1, 2]");
    expect(tuple.shape.k).toBe("tuple");
    expect(parseCaseArgExpr("[]").shape.k).toBe("tuple");
    expect(parseCaseArgExpr("{}").shape.k).toBe("obj");
    // 嵌套结构仍按原口径递归
    expect(parseCaseArgExpr("{ a: { b: [1, 2] } }").shape.k).toBe("obj");
  });

  it("case expected with trailing text → not a folded structure + nudo:directive-syntax", () => {
    const diags: DirectiveDiag[] = [];
    const fns = extractDirectives(
      parse(`/**
 * @nudo:case "d" (1) => [1][0]
 */
function d(x) { return x; }`),
      { diags },
    );
    const cases = fns.flatMap((f) => f.directives.filter((d) => d.kind === "case")) as CaseDirective[];
    expect(cases).toHaveLength(1);
    // 期望值不再是被硬切出来的错 tuple / 错 obj（改前是 `[unknown]`）
    expect(cases[0]!.expected!.shape.k).not.toBe("tuple");
    expect(cases[0]!.expected!.shape.k).not.toBe("obj");
    // 「不认识」必须可诊断（不得静默）
    expect(
      diags.some(
        (d) => d.code === "nudo:directive-syntax" && d.message.includes("[1][0]"),
      ),
    ).toBe(true);
  });
});
