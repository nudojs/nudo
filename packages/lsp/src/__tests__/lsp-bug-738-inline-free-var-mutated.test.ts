/**
 * Bug 738 —— `refactor.inline` 把**会被重新赋值**的变量捕获进被内联的表达式
 * ⇒ 内联后**程序行为改变**（`f()` 从 1 变成 2）。
 *
 * 根因：内联的安全前提是「被捕获的表达式在**声明点 ↔ 使用点**之间取值不变」，
 * 但实现只验了**更弱**的两件事（表达式无副作用 + **被内联的变量自己**没被重赋值）
 * ⇒ **被引用的自由变量**在中间被改写这一情形两道门都挡不住。
 *
 * 修法（`refactor-b2.ts` 的 `freeVarsStable`）：init 里每个**自由引用标识符**的
 * 绑定若存在写入（`binding.constantViolations` 非空）⇒ **放弃内联**；
 * 作用域外未声明的名字（全局）无法证明被写过 ⇒ 放行；自引用（`const x = x`）是 TDZ
 * ⇒ 同样放弃。
 *
 * oracle（动作面 / 语义面）：
 *   改前 title = "Inline variable 'x' (1 use)"，应用后 `f()` = 2（改前源码 `f()` = 1）
 *   改后 result = null（**不提供该动作** ⇒ 行为不变）
 */
import { describe, it, expect } from "vitest";
import { inlineVariableAt } from "../refactor-b2.ts";
import { withLspServer } from "./helpers.ts";
import { applyEdits, runModule } from "./lsp-bug-r90b-harness.ts";

const SRC = `export function f() {
  let a = 1;
  const x = a;
  a = 2;
  return x;
}
`;

/** 光标：第 3 行（1 基）的 `x`（0 基列 8） */
const LINE = 3;
const COLUMN = 8;

describe("Bug 738 · inline 不捕获会被改写的自由变量", () => {
  it("自由变量有写入 ⇒ 不提供 Inline 动作", () => {
    expect(inlineVariableAt(SRC, LINE, COLUMN)).toBeNull();
  });

  it("协议面：codeAction 不含 refactor.inline", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("a.js") },
        range: {
          start: { line: LINE - 1, character: COLUMN },
          end: { line: LINE - 1, character: COLUMN },
        },
        context: { diagnostics: [] },
      }) as Array<{ title: string; kind?: string }>;
      expect(actions.find((a) => a.kind === "refactor.inline")).toBeUndefined();
    });
  });

  it("对照：自由变量**不可变**时仍可内联（门禁不误伤）", () => {
    const stable = `export function f() {
  const a = 1;
  const x = a;
  return x;
}
`;
    const r = inlineVariableAt(stable, 3, 8);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    expect(r.title).toContain("Inline variable 'x'");
    const patched = applyEdits(stable, r.edits);
    expect(patched).toContain("return a;");
    expect(runModule(patched, "M.f()")).toBe("1");
  });

  it("语义面：改前会把 f() 从 1 变成 2（钉住根因形态）", () => {
    // 手工复刻「改前」的动作（无自由变量稳定性检查）：内联 x ⇒ 行为改变
    const before = `export function f() {
  let a = 1;
  const x = a;
  a = 2;
  return x;
}
`;
    const inlined = before.replace("  const x = a;\n", "").replace("return x;", "return a;");
    expect(runModule(before, "M.f()")).toBe("1");
    expect(runModule(inlined, "M.f()")).toBe("2");
  });
});
