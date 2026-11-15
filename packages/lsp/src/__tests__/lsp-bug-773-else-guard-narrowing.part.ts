/**
 * Bug 773 —— hover 的「早退守卫去 nullish」**忽略 `else` 分支**
 * ⇒ 窄化出**不成立**的类型（与 `nudo check` 自相矛盾）。
 *
 * 改前：`applyStmtFact` 只看 `if` 的 then 分支是否以 return/throw 结束 ⇒
 * `if (!p) { return 0; } else { void 0; }` 之后也置 `nonNullish` ⇒
 * hover 把 `p` 窄化成非空（`p: number()`）——**else 分支会继续往下走**，
 * 该路径上 `p` 仍可能是 nullish。
 *
 * oracle（协议面 `textDocument/hover`）：
 * - 带 else 的 `f`：`return p;` 处的形参**不得**被剥掉 nullish 包装；
 * - 不带 else 的 `g`（对照组）：早退守卫成立 ⇒ 剥离是对的（保持原行为）。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = `export function f(p) {
  if (!p) {
    return 0;
  } else {
    void 0;
  }
  return p;
}

export function g(p) {
  if (!p) {
    return 0;
  }
  return p;
}
`;

const SIDECAR = `import { fn, number, nullable } from "@nudojs/core";
export const f = fn({ p: nullable(number()) }, number());
export const g = fn({ p: nullable(number()) }, number());
`;

/** hover 协议响应的纯文本（```nudo 围栏内的内容） */
function hoverText(value: string | undefined): string {
  return value ?? "";
}

describe("Bug 773 —— 早退守卫的 else 分支不得被当成「其后非空」", () => {
  it("带 else 的早退守卫：其后形参保持 nullish（改前被窄化成非空）", async () => {
    await withLspServer(
      { "hover773.js": SRC, "hover773.nudo.js": SIDECAR },
      async ({ req, uri }) => {
        const hover = req("textDocument/hover");
        // f 的 `return p;`（第 7 行，列 9）
        const res = (await hover({
          textDocument: { uri: uri("hover773.js") },
          position: { line: 6, character: 9 },
        })) as { contents: { value: string } } | null;
        const text = hoverText(res?.contents?.value);
        expect(text).toContain("p: nullable(number())");
        // 改前这里是 `p: number()`（else 分支被忽略 ⇒ 窄化不成立）
        expect(text).not.toMatch(/p: number\(\)/);
      },
    );
  });

  it("对照组：不带 else 的早退守卫仍剥离 nullish（既有行为不回归）", async () => {
    await withLspServer(
      { "hover773.js": SRC, "hover773.nudo.js": SIDECAR },
      async ({ req, uri }) => {
        const hover = req("textDocument/hover");
        // g 的 `return p;`（第 14 行，列 9）
        const res = (await hover({
          textDocument: { uri: uri("hover773.js") },
          position: { line: 13, character: 9 },
        })) as { contents: { value: string } } | null;
        const text = hoverText(res?.contents?.value);
        expect(text).toContain("p: number()");
      },
    );
  });
});
