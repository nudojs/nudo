/**
 * Bug 450 —— LSP `refactor.extract` 的多 edit 合成：`applyEdits` **排序**用原
 * `source` 的坐标、**应用**时却用 `posToOffset(out, …)` 在**已被前面的 edit
 * 改写过的** `out` 上求坐标 ⇒ 两个区间相互包含（插入点落在替换范围内部）时，
 * 后应用的 edit 落点按**陈旧坐标**漂移 ⇒ 源文件被搅成垃圾。
 *
 * 改前 → 改后（逐字）：
 *   source : "AAAA BBBB CCCC"
 *   edits  : 替换 [5,9) → REPL ; 插入 @6
 *   改前   : "AAAA REPLBBB CCCC"     ← 插入文本被吞进替换文本里（垃圾）
 *   改后   : "AAAA INSREPL CCCC"     ← 插入文本紧贴替换文本**之前**
 *
 * 修法（`packages/lsp/src/extract-function.ts` 的 `applyEdits`）：**统一坐标
 * 口径** —— 全部 edit 的偏移都在**原 source** 上算好，再**从后往前**应用；
 * 区间嵌套（插入点落在替换范围内部）按「插入文本并入该范围、紧贴替换文本
 * 之前」**确定性合成**（LSP 规范下这是非法重叠 edit ⇒ 不能按客户端口径直接
 * 应用）；替换范围之间**真的**重叠（部分重叠 / 交叉）⇒ fail-closed（抛
 * `RangeError`，调用方据此不出 action）。
 *
 * 产品面：`extractFunction` 的**两个**调用点（表达式提取路径 / 语句序列路径）
 * 都走 `applyEdits` ⇒ 两条路径都要回归（见下面「产品路径」两组用例）。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { applyEdits, extractFunction } from "../extract-function.ts";
import { withLspServer } from "./helpers.ts";

/** 替换 [5,9) → REPL ；插入 @6（插入点落在替换范围内部）。 */
const NESTED_EDITS = [
  { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 9 } }, newText: "REPL" },
  { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 6 } }, newText: "INS" },
];

describe("Bug 450 · applyEdits 的区间嵌套", () => {
  it("插入点落在替换范围内部：插入文本紧贴替换文本之前（改前是垃圾源码）", () => {
    const out = applyEdits("AAAA BBBB CCCC", NESTED_EDITS);
    // 改前是 "AAAA REPLBBB CCCC"（插入文本被吞进替换文本里）
    expect(out).toBe("AAAA INSREPL CCCC");
  });

  it("合成结果与 edit 数组的顺序无关", () => {
    const forward = applyEdits("AAAA BBBB CCCC", NESTED_EDITS);
    const backward = applyEdits("AAAA BBBB CCCC", [...NESTED_EDITS].reverse());
    expect(forward).toBe("AAAA INSREPL CCCC");
    expect(backward).toBe(forward);
  });

  it("插入点在替换范围**之后**（不相交）：位置不受影响", () => {
    const out = applyEdits("AAAA BBBB CCCC", [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, newText: "REPL" },
      { range: { start: { line: 0, character: 10 }, end: { line: 0, character: 10 } }, newText: "INS" },
    ]);
    expect(out).toBe("REPL BBBB INSCCCC");
  });

  it("插入点与替换范围同起点：插入文本在替换文本之前", () => {
    const out = applyEdits("AAAA BBBB", [
      { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 9 } }, newText: "REPL" },
      { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } }, newText: "INS" },
    ]);
    expect(out).toBe("AAAA INSREPL");
  });

  it("两个不相交的替换（既有金标口径）：逐字不变", () => {
    const out = applyEdits("abcdef", [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "X" },
      { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 4 } }, newText: "Y" },
    ]);
    expect(out).toBe("XbcYef");
  });

  it("替换范围真的重叠（部分重叠 / 交叉）：fail-closed，不产出垃圾源码", () => {
    expect(() =>
      applyEdits("AAAA BBBB CCCC", [
        { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 9 } }, newText: "REPL" },
        { range: { start: { line: 0, character: 7 }, end: { line: 0, character: 11 } }, newText: "X" },
      ]),
    ).toThrow(RangeError);
  });
});

describe("Bug 450 · 产品路径（extractFunction 的两个调用点）", () => {
  it("表达式提取路径：对象字面量方法宿主 ⇒ 产物可解析、结构完整", () => {
    const source = `export const o = { m() { const y = this.v * 2; return y; }, };
`;
    const r = extractFunction(source, {
      start: { line: 0, character: 31 },
      end: { line: 0, character: 52 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(() => parse(r.newText)).not.toThrow();
    expect(r.newText).toContain("function extracted()");
    expect(r.newText).toContain("export const o = extracted();");
    // 新函数插在宿主声明**之前**（不在选区内部）
    expect(r.newText.indexOf("function extracted()")).toBeLessThan(
      r.newText.indexOf("export const o"),
    );
  });

  it("语句序列路径：函数体内的选区 ⇒ 产物可解析、调用点接回", () => {
    const source = `function outer(a, b) {
  const t = a + b;
  const u = t * 2;
  return u;
}
`;
    const r = extractFunction(source, {
      start: { line: 1, character: 2 },
      end: { line: 3, character: 0 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(() => parse(r.newText)).not.toThrow();
    expect(r.newText).toContain("function extracted(a, b)");
    expect(r.newText).toContain("const u = extracted(a, b);");
  });

  it("语句序列路径：顶层选区（插入点 == 替换起点）⇒ 产物可解析", () => {
    const source = `const t = 1;
const u = t + 1;
console.log(u);
`;
    const r = extractFunction(source, {
      start: { line: 0, character: 0 },
      end: { line: 2, character: 0 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(() => parse(r.newText)).not.toThrow();
    expect(r.newText).toContain("function extracted()");
    expect(r.newText).toContain("const u = extracted();");
  });

  it("协议面：codeAction 下发的整文件替换文本可解析", async () => {
    const source = `export const o = { m() { const y = this.v * 2; return y; }, };
`;
    await withLspServer({ "m.mjs": source }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("m.mjs") },
        range: { start: { line: 0, character: 31 }, end: { line: 0, character: 52 } },
        context: { diagnostics: [] },
      }) as Array<{
        title: string;
        kind?: string;
        edit?: { changes: Record<string, Array<{ newText: string }>> };
      }>;
      const extract = actions.find((a) => a.kind === "refactor.extract");
      expect(extract).toBeDefined();
      const newText = extract!.edit!.changes[uri("m.mjs")]![0]!.newText;
      expect(() => parse(newText)).not.toThrow();
      expect(newText).toContain("function extracted()");
    });
  });
});
