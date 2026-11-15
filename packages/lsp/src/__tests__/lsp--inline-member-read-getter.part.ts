/**
 * Bug 741 —— 「Inline variable」把**成员读**（getter）内联 ⇒ 求值 1 次变 2 次
 * ⇒ 程序行为改变；而 `nudo check` 前后签名**完全相同** ⇒ 门禁对这次语义改变无感。
 *
 * 根因（`packages/lsp/src/refactor-b2.ts` 的 `isPureExpr`）：`MemberExpression`
 * 被判成**纯**（无副作用），但成员读**可能是 getter / Proxy get 陷阱**
 * ⇒ 内联把一次读换成 N 次读 ⇒ 副作用次数与结果都变。
 *
 * 修法：只有 AST、没有类型信息 ⇒ 无法证明「该对象上没有访问器」⇒ **成员读一律判为
 * 可能有副作用**（不内联）。
 *
 * oracle（动作面 / 语义面）：
 *   改前 title = "Inline variable 'g' (2 uses)"，应用后 `obj.total + obj.total`
 *        ⇒ `sum(makeObj())` = 3（getter 求值 2 次；改前源码 = 2）
 *   改后 result = null（**不提供该动作** ⇒ 求值次数不变）
 */
import { describe, it, expect } from "vitest";
import { inlineVariableAt } from "../refactor-b2.ts";
import { withLspServer } from "./helpers.ts";
import { applyEdits, runModule } from "./lsp-bug-r90b-harness.ts";

const SRC = `export function makeObj() {
  let calls = 0;
  return { get total() { calls++; return calls; } };
}
export function sum(obj) {
  const g = obj.total;
  return g + g;
}
`;

/** 光标：第 6 行（1 基）的 `g`（0 基列 8） */
const LINE = 6;
const COLUMN = 8;

describe("Bug 741 · inline 不内联成员读（getter / Proxy 陷阱）", () => {
  it("成员读 ⇒ 不提供 Inline 动作", () => {
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

  it("语义面：改前会把 getter 求值次数从 1 变成 2（钉住根因形态）", () => {
    const before = `export function makeObj() {
  let calls = 0;
  return { get total() { calls++; return calls; } };
}
export function sum(obj) {
  const g = obj.total;
  return g + g;
}
`;
    const inlined = before.replace("  const g = obj.total;\n", "").replace(
      "return g + g;",
      "return obj.total + obj.total;",
    );
    expect(runModule(before, "M.sum(M.makeObj())")).toBe("2");
    expect(runModule(inlined, "M.sum(M.makeObj())")).toBe("3");
  });

  it("对照：非成员读的纯表达式仍可内联（门禁不误伤）", () => {
    const plain = `export function f() {
  const g = 1;
  return g + g;
}
`;
    const r = inlineVariableAt(plain, 2, 8);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    expect(r.title).toContain("Inline variable 'g'");
    const patched = applyEdits(plain, r.edits);
    expect(patched).toContain("return 1 + 1;");
    expect(runModule(patched, "M.f()")).toBe("2");
  });
});
