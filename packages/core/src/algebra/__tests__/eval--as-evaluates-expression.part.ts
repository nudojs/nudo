/**
 * Bug 164 回归（core 转译层）：`@nudo:as` 是**类型覆盖**（文档口径）——
 * 被断言的表达式**仍要求值**：副作用与 throws 域保留，**结果**取断言值。
 *
 * 修复前：`asVar` 分支在**转译期**把 init / return 实参整段换成注入常量
 * ⇒ 原表达式根本不进转译 ⇒ ① 副作用丢失（`bump()` 不被调用）；② 原表达式
 * 的抛错域消失（`JSON.parse` 的 SyntaxError 被吞 ⇒ L2 `nudo:entry-may-throw`
 * 门禁**假绿**）；③ 运行时值被换掉 ⇒ 下游观测到错值。
 *
 * 修复后：发射 `(原表达式, 注入值)`——原表达式求值一次（副作用与 throws 域
 * 保留），本次的值取注入值（与 @nudo:replace / Bug 165 同款修法）。
 *
 * 负控制钉住：未被标注的语句照常求值；无指令的对照源码行为不变。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { $lit } from "../exec/runtime/state.ts";
import { litValue, type Abs } from "../index.ts";
import { throwsError } from "./eval-helpers.ts";
import { parseSource } from "../parse-source.ts";

/** 断言值（exact number） */
const NUMBER_ABS: Abs = $lit(42) as Abs;

/** 结果字面量值（非字面量 → "not-lit"） */
function lit(a: Abs): unknown {
  const r = litValue(a);
  return r.ok ? r.value : "not-lit";
}

/**
 * `@nudo:as` 的命中面（与 service 侧 collectEvalReplacements 同口径）：
 * 承载指令的那条**语句**（AST 节点身份 = 源文本字符区间）。
 */
function asTargets(src: string): { varName: string; stmtStart: number; stmtEnd: number }[] {
  const ast = parseSource(src);
  const out: { varName: string; stmtStart: number; stmtEnd: number }[] = [];
  let i = 0;
  const visit = (stmts: unknown[]): void => {
    for (const s of stmts as Array<Record<string, unknown>>) {
      const t = s?.type as string | undefined;
      if (t === "VariableDeclaration" || t === "ReturnStatement") {
        const comments = ((s.leadingComments as Array<{ value?: string }>) ?? [])
          .map((c) => c.value ?? "")
          .join("\n");
        if (/@nudo:as\b/.test(comments)) {
          out.push({
            varName: `__as${i++}`,
            stmtStart: s.start as number,
            stmtEnd: s.end as number,
          });
        }
      }
      if (t === "BlockStatement") visit(s.body as unknown[]);
      if (t === "ExportNamedDeclaration" && s.declaration) visit([s.declaration]);
      if (t === "FunctionDeclaration" && s.body) {
        visit((s.body as { body: unknown[] }).body);
      }
    }
  };
  visit((ast.program.body as unknown[]) ?? []);
  return out;
}

/** 带 @nudo:as 注入表转译 + 调用导出函数 */
function callAs(src: string, fnName = "f", args: Abs[] = []) {
  const targets = asTargets(src);
  const exports = runTranspiled(src, {
    mode: "analyze",
    asOverrideTargets: targets.length ? targets : undefined,
    asOverrides: targets.length
      ? Object.fromEntries(targets.map((t) => [t.varName, NUMBER_ABS]))
      : undefined,
  });
  return callTranspiledExportFull(exports, fnName, args);
}

describe("Bug 164: @nudo:as 命中的表达式仍求值（副作用 + throws 域保留）", () => {
  it("副作用保留：被断言的调用仍被调用", () => {
    const src = `let counter = 0;
function bump() { counter = counter + 1; return counter; }
export function f() {
  // @nudo:as number()
  const x = bump();
  return counter;
}
`;
    // 修复前：bump() 整段被替换 → 从不调用 → counter 停在 0
    expect(lit(callAs(src).result)).toBe(1);
  });

  it("throws 域保留：被断言调用的抛错不被吞", () => {
    const src = `export function f() {
  // @nudo:as number()
  const x = JSON.parse("not json at all");
  return x;
}
`;
    // 修复前：JSON.parse 整段被替换 → 不抛 → throws 面空（L2 门禁假绿）
    expect(throwsError(callAs(src).throws, "SyntaxError")).toBe(true);
  });

  it("return 位的 @nudo:as 同样仍求值", () => {
    const src = `export function f() {
  // @nudo:as number()
  return JSON.parse("not json at all");
}
`;
    expect(throwsError(callAs(src).throws, "SyntaxError")).toBe(true);
  });

  it("结果取断言值（类型覆盖生效）", () => {
    const src = `export function f() {
  // @nudo:as number()
  const x = 1;
  return x;
}
`;
    expect(lit(callAs(src).result)).toBe(42);
  });

  it("负控制：未被标注的相邻语句照常求值", () => {
    const src = `let counter = 0;
function bump() { counter = counter + 1; return counter; }
export function f() {
  // @nudo:as number()
  const x = bump();
  const y = bump();
  return counter;
}
`;
    // 被断言的 bump() 求值一次（副作用保留），未被标注的 bump() 照常求值
    expect(lit(callAs(src).result)).toBe(2);
  });

  it("负控制：同样的源码无指令时行为不变（对照）", () => {
    const src = `let counter = 0;
function bump() { counter = counter + 1; return counter; }
export function f() {
  const x = bump();
  return counter;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const rec = callTranspiledExportFull(exports, "f", []);
    expect(lit(rec.result)).toBe(1);
  });
});
