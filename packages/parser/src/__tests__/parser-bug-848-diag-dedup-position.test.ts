/**
 * Bug 848 —— 指令诊断的**去重身份 = 文案**（无位置）⇒ 同文件两处**逐字相同**的
 * 畸形指令**塌缩成一条** ⇒ 第二处**完全不可见**（用户修好第一处后以为已经修完）。
 *
 * 根因（diag.ts `emitDirectiveDiag`）：去重键 = `code \0 message`——`DirectiveDiag`
 * 此前**没有位置字段** ⇒ 无法区分两处不同的出错点。
 *
 * 修法：`DirectiveDiag` 带**位置**（`at: { line, column }`），去重身份 =
 * `code + 文案 + 位置`——**同一处同一问题**仍去重（extract + 再解析共域），
 * **不同位置**的同文案问题各报一条。
 *
 * 未升级的调用点（不传 `at`）保持旧身份（`code + 文案`）——兼容期行为，
 * 这些族的「同文案塌缩」仍存在（需各片按交付报告接线）。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractInlineDirectives, extractDirectives, type DirectiveDiag } from "../directives.ts";
import { emitDirectiveDiag, runWithDirectiveDiags } from "../directives/diag.ts";

describe("Bug 848: diagnostic dedup identity carries the position", () => {
  it("same code+message at two positions → two diagnostics", () => {
    const diags: DirectiveDiag[] = [];
    runWithDirectiveDiags(diags, () => {
      emitDirectiveDiag({
        code: "nudo:directive-syntax",
        message: "Malformed @nudo:case: …",
        at: { line: 2, column: 3 },
      });
      emitDirectiveDiag({
        code: "nudo:directive-syntax",
        message: "Malformed @nudo:case: …",
        at: { line: 7, column: 3 },
      });
    });
    expect(diags).toHaveLength(2);
    expect(diags[0]!.at).toEqual({ line: 2, column: 3 });
    expect(diags[1]!.at).toEqual({ line: 7, column: 3 });
  });

  it("same code+message at the same position → one diagnostic (same defect)", () => {
    const diags: DirectiveDiag[] = [];
    runWithDirectiveDiags(diags, () => {
      emitDirectiveDiag({
        code: "nudo:directive-syntax",
        message: "Malformed @nudo:case: …",
        at: { line: 2, column: 3 },
      });
      emitDirectiveDiag({
        code: "nudo:directive-syntax",
        message: "Malformed @nudo:case: …",
        at: { line: 2, column: 3 },
      });
    });
    expect(diags).toHaveLength(1);
  });

  it("without a position the legacy identity (code+message) still dedups", () => {
    const diags: DirectiveDiag[] = [];
    runWithDirectiveDiags(diags, () => {
      emitDirectiveDiag({ code: "nudo:directive-syntax", message: "same text" });
      emitDirectiveDiag({ code: "nudo:directive-syntax", message: "same text" });
    });
    expect(diags).toHaveLength(1);
  });

  it("two identical `@nudo:as` trailing comments in one block → two diagnostics", () => {
    // 同一注释块内的两条**逐字相同**的畸形指令（同一去重域）⇒ 改前塌缩成一条
    const src = [
      "/**",
      " * @nudo:as string()// why",
      " * @nudo:as string()// why",
      " */",
      "const a = 1;",
      "",
    ].join("\n");
    const ast = parse(src);
    const stmt = ast.program.body[0]!;
    const diags: DirectiveDiag[] = [];
    extractInlineDirectives(stmt, { diags });
    const trailing = diags.filter((d) => d.message.includes("Trailing comment in @nudo:as"));
    expect(trailing).toHaveLength(2);
    expect(trailing[0]!.at).toBeDefined();
    expect(trailing[1]!.at).toBeDefined();
    expect(trailing[0]!.at!.line).not.toBe(trailing[1]!.at!.line);
  });

  it("the same directive scanned twice at the same position → one diagnostic", () => {
    const src = "// @nudo:as string()// why\nconst a = 1;\n";
    const ast = parse(src);
    const stmt = ast.program.body[0]!;
    const diags: DirectiveDiag[] = [];
    // 同一去重域（extract + 再解析共域口径）⇒ 同一处同一问题只报一次
    runWithDirectiveDiags(diags, () => {
      extractInlineDirectives(stmt);
      extractInlineDirectives(stmt);
    });
    expect(diags.filter((d) => d.message.includes("Trailing comment in @nudo:as"))).toHaveLength(1);
  });

  it("two identical malformed `@nudo:case` in different functions → two diagnostics", () => {
    // 848 的**原始复现族**：函数级扫描器（fn-directives）发射的畸形 case 诊断
    // 也必须带位置 ⇒ 两处逐字相同的问题各报一条
    const src = [
      "/**",
      " * @nudo:case 't' (1)",
      " */",
      "function f(x) { return x; }",
      "/**",
      " * @nudo:case 't' (1)",
      " */",
      "function g(x) { return x; }",
      "",
    ].join("\n");
    const diags: DirectiveDiag[] = [];
    extractDirectives(parse(src), { diags });
    const malformed = diags.filter((d) => d.message.includes("Malformed @nudo:case"));
    expect(malformed).toHaveLength(2);
    expect(malformed[0]!.at).toBeDefined();
    expect(malformed[1]!.at).toBeDefined();
    expect(malformed[0]!.at!.line).not.toBe(malformed[1]!.at!.line);
  });
});
