/**
 * Bug 774 —— 无契约函数的**形参位置 hover 完全为空**
 * （同一 hover 的函数名面却显示 `x: any`）。
 *
 * 改前：形参位 hover 的两条路径都要求「有契约 / 有 entryShape」
 * ——无契约形参在两条路上都拿不到值 ⇒ 整个 hover 返回 `null`。
 * design §2 的「入口无约束 = `any`」只在函数名位的签名面有兜底，
 * 形参位没有。
 *
 * 修法：`projectParamAbs`（resolve.ts）在**命中形参但没有契约条目**时
 * 回落 `any`（与函数名面同口径）；非形参标识符仍诚实降级为「无信息」。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = `export function add(x, y) {
  return x + y;
}
`;

describe("Bug 774 —— 无契约形参的 hover 回落 design §2 的 `any`", () => {
  it("形参声明位：`x: any`（改前整个 hover 为空）", async () => {
    await withLspServer({ "hover774.js": SRC }, async ({ req, uri }) => {
      const hover = req("textDocument/hover");
      // `add(x, y)` 的 `x`（第 1 行，列 20）
      const res = (await hover({
        textDocument: { uri: uri("hover774.js") },
        position: { line: 0, character: 20 },
      })) as { contents: { value: string } } | null;
      expect(res).not.toBeNull();
      expect(res?.contents?.value ?? "").toContain("x: any");
    });
  });

  it("体内引用位：`x: any`（改前整个 hover 为空）", async () => {
    await withLspServer({ "hover774.js": SRC }, async ({ req, uri }) => {
      const hover = req("textDocument/hover");
      // `return x + y;` 的 `x`（第 2 行，列 9）
      const res = (await hover({
        textDocument: { uri: uri("hover774.js") },
        position: { line: 1, character: 9 },
      })) as { contents: { value: string } } | null;
      expect(res).not.toBeNull();
      expect(res?.contents?.value ?? "").toContain("x: any");
    });
  });

  it("函数名面同口径：`add(x: any, y: any) => number | string`", async () => {
    await withLspServer({ "hover774.js": SRC }, async ({ req, uri }) => {
      const hover = req("textDocument/hover");
      // `add`（第 1 行，列 16）
      const res = (await hover({
        textDocument: { uri: uri("hover774.js") },
        position: { line: 0, character: 16 },
      })) as { contents: { value: string } } | null;
      expect(res?.contents?.value ?? "").toContain("add(x: any, y: any)");
    });
  });
});
