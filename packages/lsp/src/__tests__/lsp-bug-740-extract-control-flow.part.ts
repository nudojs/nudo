/**
 * Bug 740 —— Extract 把 switch case 里的 `break;` 一起搬进新函数
 * ⇒ `SyntaxError: Illegal break statement`（Babel 措辞 `Unsyntactic break. (3:8)`），
 * 且原来的 `break` **消失** ⇒ case 贯穿到下一个分支（语义也变了）。
 *
 * 报告追加的**第二个形态**（选区末条是 `return` ⇒ 返回值被静默丢掉）实测也成立：
 * 产物是**合法 JS**、`nudo check` 判 `OK / 0 error` ⇒ 门禁对一次语义被破坏的重构
 * 完全放行 ⇒ 外层函数返回值从 `2` 变 `undefined`。
 *
 * 根因（`packages/lsp/src/extract-function.ts` 的 `Statement(path)` 访问器）：语句收集是
 * **纯位置**判断（选区是否覆盖整条语句），**没有任何控制流感知** ⇒ `break` / `continue` /
 * `return` 被与普通表达式语句同等对待。
 *
 * 修法：
 * - `break` / `continue`：新函数里没有循环/开关可跳 ⇒ **拒绝**该选区（不出 action）。
 * - `return`：只允许出现在选区**末尾**；末尾的 `return` 必须把返回值**接回调用点**
 *   （`return extracted();`）⇒ 外层返回值不再被静默丢掉。
 *
 * oracle（改前 → 改后）：
 *   改前 break 选区：ok = true，callText = "extracted(k);"，产物 `Unsyntactic break. (3:8)`
 *   改后 break 选区：ok = false（reason 提到 break）⇒ 协议面 0 个 action
 *   改前 return 选区：callText = "extracted();"（返回值被丢）
 *   改后 return 选区：callText = "return extracted();"（返回值接回）
 */
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { extractFunction } from "../extract-function.ts";
import { withLspServer } from "./helpers.ts";

const BREAK_SRC = `export function choose(k) {
  switch (k) {
    case 1:
      act(k);
      break;
    default:
      other(k);
  }
}
`;
/** 选区 = `act(k);` + `break;` */
const BREAK_SEL = { start: { line: 3, character: 6 }, end: { line: 4, character: 12 } };

const RETURN_SRC = `export function f() {
  const a = 1;
  return a + 1;
}
`;
/** 选区 = `const a = 1;` + `return a + 1;`（整条覆盖 return） */
const RETURN_SEL = { start: { line: 1, character: 2 }, end: { line: 2, character: 15 } };

describe("Bug 740 · Extract 不搬走控制流语句、返回值必须接回", () => {
  it("选区含 break：拒绝抽取（不再产出非法 JS）", () => {
    const r = extractFunction(BREAK_SRC, BREAK_SEL);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/break/);
  });

  it("协议面：含 break 的选区不再给出 refactor.extract", async () => {
    await withLspServer({ "m.mjs": BREAK_SRC }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("m.mjs") },
        range: BREAK_SEL,
        context: { diagnostics: [] },
      }) as Array<{ title: string; kind?: string }>;
      const extract = actions.find((a) => a.kind === "refactor.extract");
      expect(extract).toBeUndefined();
    });
  });

  it("选区末条是 return：返回值接回调用点（外层返回值不再被丢）", () => {
    const r = extractFunction(RETURN_SRC, RETURN_SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 改前是 "extracted();"（返回值被静默丢掉）
    expect(r.callText).toBe("return extracted();");
    expect(r.returns).toBe("value");
    expect(r.newText).toContain("return extracted();");
    // 外层函数仍然返回该值
    expect(r.newText).toMatch(/export function f\(\) \{[\s\S]*return extracted\(\);/);
    expect(() => parse(r.newText)).not.toThrow();
  });

  it("对照：单条 return 的抽取仍然接回返回值（既有行为不变）", () => {
    const src = `function f(x) {
  return x + 1;
}
`;
    const r = extractFunction(
      src,
      { start: { line: 1, character: 2 }, end: { line: 1, character: 15 } },
      { name: "inc" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.callText).toBe("return inc(x);");
  });
});
