/**
 * Bug 842 —— `@nudo:as` 的**值格**与**类型格**之间**没有空格**（`@nudo:as(string())`）
 * ⇒ 整条指令被**静默丢弃**（零诊断）⇒ 类型覆盖**不生效**（假绿）。
 *
 * 根因（inline-directives.ts）：`AS_LINE_REGEX`（值格要求**至少一个空白**）与
 * `AS_BARE_RE`（无载荷形态**只认光秃秃**的 `@nudo:as`）**分工不闭合** ⇒ 括号
 * 紧贴形态两条正则**都不匹配** ⇒ 整条 `@nudo:as` 蒸发、零诊断。
 *
 * 修法：标签后**分隔空白可有可无**（`@nudo:as(string())` ≡ `@nudo:as string()`）；
 * 载荷的**外层配平括号**可剥（`(string())` ≡ `string()`）——约束文法的预筛正则
 * 锚定构建器名，括号包裹的等价写法此前被判「不认识」；标签后紧跟标识符字符 ⇒
 * **标签名被延长**（`@nudo:assume` / `@nudo:ascii`）⇒ 不是 `@nudo:as` 指令；
 * 无载荷 ⇒ **显式诊断**（不再静默）。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractInlineDirectives, type DirectiveDiag } from "../directives.ts";

/** 取第一条语句的行内指令 + 其诊断 */
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

describe("Bug 842: `@nudo:as` payload separator is optional (parenthesised form must not evaporate)", () => {
  it("`@nudo:as(string())` (no space) yields a type — not an evaporated directive", () => {
    const { dirs, diags } = inlineOf("// @nudo:as(string())\nconst value = 1;");
    expect(dirs).toHaveLength(1);
    expect(dirs[0]!.kind).toBe("as");
    if (dirs[0]!.kind === "as") {
      expect(dirs[0]!.typeAbs.shape.k).toBe("prim");
      expect(dirs[0]!.typeAbs.shape.k).not.toBe("unknown");
    }
    expect(diags).toEqual([]);
  });

  it("`@nudo:as number()` (spaced form) still yields the same type", () => {
    const { dirs, diags } = inlineOf("// @nudo:as number()\nconst value = 1;");
    expect(dirs).toHaveLength(1);
    if (dirs[0]!.kind === "as") expect(dirs[0]!.typeAbs.shape.k).toBe("prim");
    expect(diags).toEqual([]);
  });

  it("`@nudo:as(shape({ port: number() }))` (nested parens) yields an object type", () => {
    const { dirs, diags } = inlineOf(
      "// @nudo:as(shape({ port: number() }))\nconst value = 1;",
    );
    expect(dirs).toHaveLength(1);
    if (dirs[0]!.kind === "as") expect(dirs[0]!.typeAbs.shape.k).toBe("obj");
    expect(diags).toEqual([]);
  });

  it("bare `@nudo:as` is diagnosed explicitly (never silently ignored)", () => {
    const { dirs, diags } = inlineOf("// @nudo:as\nconst value = 1;");
    expect(dirs).toHaveLength(0);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("@nudo:as requires a type expression");
  });

  it("unrecognised payload is diagnosed instead of evaporating", () => {
    const { dirs, diags } = inlineOf("// @nudo:as(T.number)\nconst value = 1;");
    expect(dirs).toHaveLength(1); // 指令被认出来了（不是被丢弃）
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("Unrecognized type expression in @nudo:as");
  });

  it("tag boundary: `@nudo:asXYZ` / `@nudo:assume` are not `@nudo:as` directives", () => {
    for (const tag of ["@nudo:asXYZ", "@nudo:assume", "@nudo:ascii"]) {
      const { dirs, diags } = inlineOf(`// ${tag}\nconst value = 1;`);
      expect(dirs, tag).toHaveLength(0);
      expect(diags, tag).toEqual([]);
    }
  });
});
