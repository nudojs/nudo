/**
 * BUG-080 残留（service 指令面）：`@nudo:as` 覆盖只施加在
 * **VariableDeclaration 的 init** 与 **ReturnStatement 的值**上（文档口径）
 * ⇒ 标注在**其它语句形态**（for 头 / for-init / if / 表达式语句 / 函数声明 …）
 * 上的 `@nudo:as` **无适用目标**。
 *
 * 改前：这类指令被**采集**（asTargets 非空）却**静默失效**——类型没变、
 * 零诊断（用户毫无痕迹的假绿）。
 *
 * 改后：按 BUG-080 的修复方向（不许静默）⇒ 目标形态不支持时发一条显式
 * `nudo:directive-syntax`（既有码，不另造新码；warning 级，不制造假红）。
 *
 * 负控制钉住：适用形态（变量声明 / return / export 声明）**零诊断**，且
 * 覆盖照常生效。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, type RunTranspiledOptions } from "@nudojs/core";
import type { DirectiveDiag } from "@nudojs/parser";
import { collectEvalReplacements } from "../eval-run.ts";

/** 收集指令（带诊断通道） */
function collect(src: string): {
  reps: ReturnType<typeof collectEvalReplacements>;
  diags: DirectiveDiag[];
} {
  const diags: DirectiveDiag[] = [];
  const reps = collectEvalReplacements(src, { diags });
  return { reps, diags };
}

/** 收集 → 注入 → 门禁（产品面同口径） */
function check(src: string, file = "/t/as-shape.js") {
  const { reps } = collect(src);
  const inject: RunTranspiledOptions = {
    replacements: reps.values,
    replacementTargets: reps.targets,
    asOverrides: reps.asValues,
    asOverrideTargets: reps.asTargets,
  };
  return checkSource(file, src, pTrue, { inject });
}

/** checkSource 签名显示串 */
function sigOf(r: { signatures: { name: string; display: string }[] }, fn: string): string {
  return r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
}

describe("BUG-080 残留 — @nudo:as 目标形态不支持 ⇒ 显式诊断（不许静默）", () => {
  it("for 头（for-of 解构）：诊断一条，覆盖不生效", () => {
    const src = `export function f(xs) {
  // @nudo:as shape({ a: number() })
  for (const { a } of xs) { return a; }
  return 0;
}
`;
    const { reps, diags } = collect(src);
    const bad = diags.filter((d) => d.code === "nudo:directive-syntax");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.message).toContain("@nudo:as");
    // 不适用 ⇒ 不登记覆盖目标（覆盖值不会被注入）
    expect(reps.asTargets).toHaveLength(0);
  });

  it("表达式语句：诊断一条", () => {
    const src = `export function f(x) {
  // @nudo:as number()
  g(x);
  return 1;
}
`;
    const { diags } = collect(src);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(1);
  });

  it("函数声明：诊断一条", () => {
    const src = `// @nudo:as number()
export function f() { return 1; }
`;
    const { diags } = collect(src);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(1);
  });

  it("负控制：变量声明 / return / export 声明 ⇒ 零诊断，覆盖照常生效", () => {
    const varDecl = `export function f(content) {
  // @nudo:as shape({ port: number(), host: string() })
  const config = JSON.parse(content);
  return config;
}
`;
    const { reps, diags } = collect(varDecl);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
    expect(reps.asTargets).toHaveLength(1);
    expect(sigOf(check(varDecl), "f")).toContain("{ port: number, host: string }");

    const ret = `export function f(content) {
  // @nudo:as shape({ port: number() })
  return JSON.parse(content);
}
`;
    expect(collect(ret).diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
    expect(collect(ret).reps.asTargets).toHaveLength(1);

    const exp = `// @nudo:as number()
export const raw = 1;
`;
    expect(collect(exp).diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
    expect(collect(exp).reps.asTargets).toHaveLength(1);
  });

  it("负控制：解构声明上的 @nudo:as 仍生效（BUG-080 主修复不退化）", () => {
    const src = `export function f(content) {
  // @nudo:as shape({ port: number(), host: string() })
  const { port, host } = JSON.parse(content);
  return { port, host };
}
`;
    const { reps, diags } = collect(src);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toHaveLength(0);
    expect(reps.asTargets).toHaveLength(1);
    expect(sigOf(check(src), "f")).toContain("{ port: number, host: string }");
  });
});
