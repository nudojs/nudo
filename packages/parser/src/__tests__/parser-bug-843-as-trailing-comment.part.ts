/**
 * Bug 843 —— `@nudo:as` 的类型表达式里**尾注释前没有空格**（`string()// why`）⇒
 * 注释被并进表达式 ⇒ **合法类型被判「unsafe」并降级为 unknown**（合法类型覆盖
 * 静默失效）。
 *
 * 根因（inline-directives.ts `findTrailingCommentStart`）：尾注释切分以
 * 「**前导空白**」为**唯一信号** ⇒ `string()// why` 不被切走 ⇒ 整串进 AST
 * 白名单 ⇒ 判 unsafe ⇒ 降级 unknown（并附两条误导性诊断）。
 *
 * 修法：尾注释识别改**词法边界**——表达式结束处的 `//` / `/*` 即尾注释
 * （标识符 / `)` 结尾也算）；只排除「整除」形态（左操作数是数值字面量且 `//`
 * 后紧跟数字）；字符串内的 `//` 不算（字符串感知）。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractInlineDirectives, type DirectiveDiag } from "../directives.ts";

function inlineOf(source: string): {
  dirs: ReturnType<typeof extractInlineDirectives>;
  diags: DirectiveDiag[];
} {
  const ast = parse(source);
  const stmt = ast.program.body[0]!;
  const diags: DirectiveDiag[] = [];
  const dirs = extractInlineDirectives(stmt, { diags });
  return { dirs, diags };
}

describe("Bug 843: trailing comment in `@nudo:as` is cut by lexical boundary", () => {
  it("`string()// why` (no space) keeps the type (no unknown downgrade)", () => {
    const { dirs, diags } = inlineOf("// @nudo:as string()// why\nconst value = 1;");
    expect(dirs).toHaveLength(1);
    if (dirs[0]!.kind === "as") {
      expect(dirs[0]!.typeAbs.shape.k).toBe("prim");
      expect(dirs[0]!.typeAbs.shape.k).not.toBe("unknown");
    }
    // 只报「尾注释」一条——不再报「unsafe」/「unrecognized」
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("Trailing comment in @nudo:as type expression");
  });

  it("`string() // why` (spaced form) still behaves the same", () => {
    const { dirs, diags } = inlineOf("// @nudo:as string() // why\nconst value = 1;");
    expect(dirs).toHaveLength(1);
    if (dirs[0]!.kind === "as") expect(dirs[0]!.typeAbs.shape.k).toBe("prim");
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("Trailing comment in @nudo:as type expression");
  });

  it("comment markers inside a string literal are not a trailing comment", () => {
    const { dirs, diags } = inlineOf('// @nudo:as lit("a//b")\nconst value = 1;');
    expect(dirs).toHaveLength(1);
    if (dirs[0]!.kind === "as") expect(dirs[0]!.typeAbs.shape.k).toBe("prim");
    expect(diags).toEqual([]);
  });

  it("`//` right after `)` is a comment (not swallowed into the expression)", () => {
    const { dirs, diags } = inlineOf("// @nudo:as number()//note\nconst value = 1;");
    expect(dirs).toHaveLength(1);
    if (dirs[0]!.kind === "as") expect(dirs[0]!.typeAbs.shape.k).toBe("prim");
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("Trailing comment in @nudo:as type expression");
  });
});
