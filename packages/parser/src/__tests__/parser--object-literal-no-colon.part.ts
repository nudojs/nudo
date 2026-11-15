/**
 * Bug 855 回归：对象字面量里**无顶层冒号**的属性（getter / 方法简写 /
 * 简写属性）不得被**静默丢弃**。
 *
 * 改前 `parseObjectLiteral` 对 `findTopLevelColon(entry) === -1` 直接
 * `continue` ⇒ 该属性从 mock 值 / 期望值里**无声消失** ⇒ mock 变成
 * **自信的错值**（`cfg.port` 读出 `undefined` 而不是 8080）且**零诊断**。
 *
 * 改后：点名报 nudo:directive-syntax（属性未被识别）+ 整个字面量判
 * 「不认识」（unknown，fail-closed）——不再悄悄地少掉属性。
 */
import { describe, it, expect } from "vitest";
import { parseCaseArgExpr, runWithDirectiveDiags, type DirectiveDiag } from "../directives.ts";

function parseWithDiags(expr: string): { abs: ReturnType<typeof parseCaseArgExpr>; diags: DirectiveDiag[] } {
  const diags: DirectiveDiag[] = [];
  const abs = runWithDirectiveDiags(diags, () => parseCaseArgExpr(expr));
  return { abs, diags };
}

describe("Bug 855: object literal properties without a top-level colon are not silently dropped", () => {
  it("getter property → unknown + named diagnostic", () => {
    const { abs, diags } = parseWithDiags("{ get port() { return 8080; } }");
    expect(abs.shape.k).toBe("unknown");
    expect(
      diags.some(
        (d) =>
          d.code === "nudo:directive-syntax" &&
          d.message.includes("Unrecognized property") &&
          d.message.includes("get port"),
      ),
    ).toBe(true);
  });

  it("method shorthand → unknown + named diagnostic", () => {
    const { abs, diags } = parseWithDiags('{ hello() { return "hi"; } }');
    expect(abs.shape.k).toBe("unknown");
    expect(
      diags.some(
        (d) =>
          d.code === "nudo:directive-syntax" && d.message.includes("Unrecognized property"),
      ),
    ).toBe(true);
  });

  it("shorthand property → unknown + named diagnostic", () => {
    const { abs, diags } = parseWithDiags("{ ok }");
    expect(abs.shape.k).toBe("unknown");
    expect(
      diags.some(
        (d) =>
          d.code === "nudo:directive-syntax" &&
          d.message.includes("Unrecognized property") &&
          d.message.includes("ok"),
      ),
    ).toBe(true);
  });

  it("a single unsupported property rejects the whole literal (fail-closed, no half-value)", () => {
    const { abs } = parseWithDiags("{ a: 1, ok }");
    expect(abs.shape.k).toBe("unknown");
  });

  it("properties with a top-level colon still parse and stay diagnostic-free", () => {
    const { abs, diags } = parseWithDiags("{ port: 8080 }");
    expect(abs.shape.k).toBe("obj");
    expect(diags).toHaveLength(0);
    const nested = parseWithDiags("{ a: { b: 1 } }");
    expect(nested.abs.shape.k).toBe("obj");
    expect(nested.diags).toHaveLength(0);
  });
});
