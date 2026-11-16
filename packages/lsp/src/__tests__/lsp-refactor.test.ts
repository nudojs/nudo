/**
 * 模块套件：refactor 面（extract / inline / applyEdits / whatIf / placeholder）。
 *
 * 编辑结果、零附带修改与占位 range 断言逐字保留；refactor-gold.test.ts 仍为
 * 独立精度门禁。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { applyEdits, extractFunction, extractToWorkspaceEdit } from "../extract-function.ts";
import { applyEdits as applyEditsHarness } from "./lsp-harness-edit-semantics.ts";
import { withLspServer, createMockConnection, withTempDir, makeValidateDeps } from "./helpers.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNudoServer } from "../server.ts";
import { inlineVariableAt } from "../refactor-b2.ts";
import { anyOverlap, nodeCheck, runModule, type Edit } from "./lsp-harness-edit-semantics.ts";
import { checkSource } from "@nudojs/core";
import { defaultLoadModule, injectBindings } from "@nudojs/service";
import { codeActionParams, docEdits, missingFieldDiag, mountCodeActions } from "./lsp-harness-code-actions.ts";
import { validateText, toLspDiagnostic, type LspDiagnostic } from "../validation.ts";
import { DIAG } from "@nudojs/core/internal";
import { whatIf } from "../agent-tools.ts";

// ---------------------------------------------------------------------------
// applyEdits 的区间嵌套
// ---------------------------------------------------------------------------
describe("applyEdits 的区间嵌套", () => {
/**
 * LSP `refactor.extract` 的多 edit 合成：`applyEdits` **排序**用原
 * `source` 的坐标、**应用**时却用 `posToOffset(out, …)` 在**已被前面的 edit
 * 改写过的** `out` 上求坐标 ⇒ 两个区间相互包含（插入点落在替换范围内部）时，
 * 后应用的 edit 落点按**陈旧坐标**漂移 ⇒ 源文件被搅成垃圾。
 *
 * 改前 → 改后（逐字）：
 * source : "AAAA BBBB CCCC"
 * edits : 替换 [5,9) → REPL ; 插入 @6
 * 改前 : "AAAA REPLBBB CCCC" ← 插入文本被吞进替换文本里（垃圾）
 * 改后 : "AAAA INSREPL CCCC" ← 插入文本紧贴替换文本**之前**
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





/** 替换 [5,9) → REPL ；插入 @6（插入点落在替换范围内部）。 */
const NESTED_EDITS = [
  { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 9 } }, newText: "REPL" },
  { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 6 } }, newText: "INS" },
];


  it("插入点落在替换范围内部：插入文本紧贴替换文本之前（改前是垃圾源码）；合成结果与 edit 数组的顺序无关；插入点在替换范围**之后**（不相交）：位置不受影响；插入点与替换范围同起点：插入文本在替换文本之前；两个不相交的替换（既有金标口径）：逐字不变；替换范围真的重叠（部分重叠 / 交叉）：fail-closed，不产出垃圾源码", () => {
  {
    const out = applyEdits("AAAA BBBB CCCC", NESTED_EDITS);
    // 改前是 "AAAA REPLBBB CCCC"（插入文本被吞进替换文本里）
    expect(out).toBe("AAAA INSREPL CCCC");
  }
  {
    const forward = applyEdits("AAAA BBBB CCCC", NESTED_EDITS);
    const backward = applyEdits("AAAA BBBB CCCC", [...NESTED_EDITS].reverse());
    expect(forward).toBe("AAAA INSREPL CCCC");
    expect(backward).toBe(forward);
  }
  {
    const out = applyEdits("AAAA BBBB CCCC", [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, newText: "REPL" },
      { range: { start: { line: 0, character: 10 }, end: { line: 0, character: 10 } }, newText: "INS" },
    ]);
    expect(out).toBe("REPL BBBB INSCCCC");
  }
  {
    const out = applyEdits("AAAA BBBB", [
      { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 9 } }, newText: "REPL" },
      { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } }, newText: "INS" },
    ]);
    expect(out).toBe("AAAA INSREPL");
  }
  {
    const out = applyEdits("abcdef", [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: "X" },
      { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 4 } }, newText: "Y" },
    ]);
    expect(out).toBe("XbcYef");
  }
  {
    expect(() =>
      applyEdits("AAAA BBBB CCCC", [
        { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 9 } }, newText: "REPL" },
        { range: { start: { line: 0, character: 7 }, end: { line: 0, character: 11 } }, newText: "X" },
      ]),
    ).toThrow(RangeError);
  }
});







describe("产品路径（extractFunction 的两个调用点）", () => {
  it("表达式提取路径：对象字面量方法宿主 ⇒ 产物可解析、结构完整；语句序列路径：函数体内的选区 ⇒ 产物可解析、调用点接回；语句序列路径：顶层选区（插入点 == 替换起点）⇒ 产物可解析；协议面：codeAction 下发的整文件替换文本可解析", async () => {
__scenario_1: {
    const source = `export const o = { m() { const y = this.v * 2; return y; }, };
`;
    const r = extractFunction(source, {
      start: { line: 0, character: 31 },
      end: { line: 0, character: 52 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) break __scenario_1;
    expect(() => parse(r.newText)).not.toThrow();
    expect(r.newText).toContain("function extracted()");
    expect(r.newText).toContain("export const o = extracted();");
    // 新函数插在宿主声明**之前**（不在选区内部）
    expect(r.newText.indexOf("function extracted()")).toBeLessThan(
      r.newText.indexOf("export const o"),
    );
  }
__scenario_2: {
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
    if (!r.ok) break __scenario_2;
    expect(() => parse(r.newText)).not.toThrow();
    expect(r.newText).toContain("function extracted(a, b)");
    expect(r.newText).toContain("const u = extracted(a, b);");
  }
__scenario_3: {
    const source = `const t = 1;
const u = t + 1;
console.log(u);
`;
    const r = extractFunction(source, {
      start: { line: 0, character: 0 },
      end: { line: 2, character: 0 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) break __scenario_3;
    expect(() => parse(r.newText)).not.toThrow();
    expect(r.newText).toContain("function extracted()");
    expect(r.newText).toContain("const u = extracted();");
  }
  {
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
  }
});



});
});

// ---------------------------------------------------------------------------
// 顶层选区的 Extract 跳过文件前导区（hashbang）
// ---------------------------------------------------------------------------
describe("顶层选区的 Extract 跳过文件前导区（hashbang）", () => {
/**
 * Extract 在**顶层选区**时把新函数插到**文件第 0 字节** ⇒ 落到 hashbang
 * **之前** ⇒ Node 只认第一行的 `#!` 为 shebang ⇒ 产物
 * `SyntaxError: Invalid or unexpected token` ⇒ 文件不再是可执行脚本。
 *
 * 根因（`packages/lsp/src/extract-function.ts`）：顶层选区时 `containingFnBox.fn` 为空
 * ⇒ `insertAt` 落到兜底值 `{line:0, character:0}`（文件最开头），**不考虑文件前导区**
 * （hashbang / `"use strict"` 指令 / 前导注释）。
 *
 * 修法：顶层选区的插入点 = **选区语句的起点**（天然落在前导区之后）；
 * 没有锚点时退到「文件前导区之后」（`leadingSafeInsertPos`）。
 *
 * oracle（改前 → 改后）：
 * 改前 insertAt = {line:0, character:0} ⇒ newText 第 1 行是 `function extracted() {…}`，
 * hashbang 被挤到第 5 行 ⇒ Babel: Unexpected token (5:0)
 * 改后 insertAt = {line:1, character:0} ⇒ hashbang 仍是第 1 行 ⇒ 产物可解析。
 */





const SRC = `#!/usr/bin/env node
const value = compute();
export function f(a) {
  return a + value;
}
`;

/** 选区 = 第 2 行（0 基）的 `const value = compute();` */
const SEL = { start: { line: 1, character: 0 }, end: { line: 1, character: 24 } };


  it("插入点在 hashbang 之后（不是文件第 0 字节）；产物里 hashbang 仍是第 1 行（可解析、可执行）；协议面：codeAction 下发的文本第 1 行仍是 shebang", async () => {
__scenario_4: {
    const r = extractFunction(SRC, SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) break __scenario_4;
    // 改前是 {line:0, character:0}
    expect(r.insertAt).toEqual({ line: 1, character: 0 });
  }
__scenario_5: {
    const r = extractFunction(SRC, SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) break __scenario_5;
    expect(r.newText.split("\n")[0]).toBe("#!/usr/bin/env node");
    // 改前：Unexpected token (5:0)
    expect(() => parse(r.newText)).not.toThrow();
  }
  {
    await withLspServer({ "m.mjs": SRC }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("m.mjs") },
        range: SEL,
        context: { diagnostics: [] },
      }) as Array<{
        title: string;
        kind?: string;
        edit?: { changes: Record<string, Array<{ newText: string }>> };
      }>;
      const extract = actions.find((a) => a.kind === "refactor.extract");
      expect(extract).toBeDefined();
      const newText = extract!.edit!.changes[uri("m.mjs")]![0]!.newText;
      expect(newText.split("\n")[0]).toBe("#!/usr/bin/env node");
      expect(() => parse(newText)).not.toThrow();
    });
  }
});



});

// ---------------------------------------------------------------------------
// Extract 的赋值写法不引入重复 const 声明
// ---------------------------------------------------------------------------
describe("Extract 的赋值写法不引入重复 const 声明", () => {
/**
 * Extract 在 `capturedWrites` 路径**一律**生成 `const <name> = <call>()`，
 * 不区分「原本是声明」与「原本是赋值」⇒ 被抽出的若是**赋值表达式**
 * （`x = compute();`），调用点就变成 `const x = extracted(...)` ⇒ 与外层已有的
 * `let x` **重复声明** ⇒ `SyntaxError: Identifier 'x' has already been declared`
 * ⇒ 文件彻底不可解析。
 *
 * 根因（`packages/lsp/src/extract-function.ts` 的 capturedWrites 分支）：调用点文本
 * 硬编码 `const`，且 `capturedWrites` 不记录「这一条写到底是声明还是赋值」。
 *
 * 修法：区分两种写 ——
 * - assign（选区内是 `x = …`，x 声明在选区外）⇒ 调用点用**赋值表达式**
 * `x = extracted(...)`，**不得**引入新的 `const`。
 * - declare（选区内是 `const/let/var x = …`）⇒ 调用点还原**同种声明**。
 *
 * oracle（改前 → 改后）：
 * 改前 callText = "const x = extracted(compute);" ⇒ newText 不可解析
 * （Babel: Identifier 'x' has already been declared. (7:8)）
 * 改后 callText = "x = extracted(compute);" ⇒ newText 可解析
 */





const SRC = `export function f(compute) {
  let x = 0;
  x = compute();
  return x;
}
`;

/** 选区 = 第 3 行（0 基）的 `x = compute();` */
const SEL = { start: { line: 2, character: 2 }, end: { line: 2, character: 16 } };


  it("调用点是赋值表达式，不是 const 声明；产物不再有重复声明（可解析）；协议面：codeAction 下发的文本里没有重复 const 声明；对照：原本就是声明时，调用点仍是同种声明（const）", async () => {
__scenario_6: {
    const r = extractFunction(SRC, SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) break __scenario_6;
    // 改前是 "const x = extracted(compute);"
    expect(r.callText).toBe("x = extracted(compute);");
    expect(r.callText).not.toContain("const x");
  }
__scenario_7: {
    const r = extractFunction(SRC, SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) break __scenario_7;
    expect(r.newText).not.toContain("const x = extracted");
    expect(r.newText).toContain("x = extracted(compute);");
    expect(r.newText).toContain("let x = 0;");
    // 改前：Identifier 'x' has already been declared
    expect(() => parse(r.newText)).not.toThrow();
  }
  {
    await withLspServer({ "m.mjs": SRC }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("m.mjs") },
        range: SEL,
        context: { diagnostics: [] },
      }) as Array<{
        title: string;
        kind?: string;
        edit?: { changes: Record<string, Array<{ newText: string }>> };
      }>;
      const extract = actions.find((a) => a.kind === "refactor.extract");
      expect(extract).toBeDefined();
      const newText = extract!.edit!.changes[uri("m.mjs")]![0]!.newText;
      expect(newText).not.toContain("const x = extracted");
      expect(newText).toContain("x = extracted(compute);");
    });
  }
__scenario_8: {
    const src = `function outer(a, b) {
  const t = a + b;
  const u = t * 2;
  return u;
}
`;
    const r = extractFunction(
      src,
      { start: { line: 1, character: 2 }, end: { line: 3, character: 0 } },
      { name: "combine" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) break __scenario_8;
    expect(r.callText).toBe("const u = combine(a, b);");
  }
});




});

// ---------------------------------------------------------------------------
// Extract 不搬走控制流语句、返回值必须接回
// ---------------------------------------------------------------------------
describe("Extract 不搬走控制流语句、返回值必须接回", () => {
/**
 * Extract 把 switch case 里的 `break;` 一起搬进新函数
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
 * （`return extracted();`）⇒ 外层返回值不再被静默丢掉。
 *
 * oracle（改前 → 改后）：
 * 改前 break 选区：ok = true，callText = "extracted(k);"，产物 `Unsyntactic break. (3:8)`
 * 改后 break 选区：ok = false（reason 提到 break）⇒ 协议面 0 个 action
 * 改前 return 选区：callText = "extracted();"（返回值被丢）
 * 改后 return 选区：callText = "return extracted();"（返回值接回）
 */





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


  it("选区含 break：拒绝抽取（不再产出非法 JS）；协议面：含 break 的选区不再给出 refactor.extract；选区末条是 return：返回值接回调用点（外层返回值不再被丢）；对照：单条 return 的抽取仍然接回返回值（既有行为不变）", async () => {
__scenario_9: {
    const r = extractFunction(BREAK_SRC, BREAK_SEL);
    expect(r.ok).toBe(false);
    if (r.ok) break __scenario_9;
    expect(r.reason).toMatch(/break/);
  }
  {
    await withLspServer({ "m.mjs": BREAK_SRC }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("m.mjs") },
        range: BREAK_SEL,
        context: { diagnostics: [] },
      }) as Array<{ title: string; kind?: string }>;
      const extract = actions.find((a) => a.kind === "refactor.extract");
      expect(extract).toBeUndefined();
    });
  }
__scenario_10: {
    const r = extractFunction(RETURN_SRC, RETURN_SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) break __scenario_10;
    // 改前是 "extracted();"（返回值被静默丢掉）
    expect(r.callText).toBe("return extracted();");
    expect(r.returns).toBe("value");
    expect(r.newText).toContain("return extracted();");
    // 外层函数仍然返回该值
    expect(r.newText).toMatch(/export function f\(\) \{[\s\S]*return extracted\(\);/);
    expect(() => parse(r.newText)).not.toThrow();
  }
__scenario_11: {
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
    if (!r.ok) break __scenario_11;
    expect(r.callText).toBe("return inc(x);");
  }
});




});

// ---------------------------------------------------------------------------
// Extract 的新函数只能插在语句位置
// ---------------------------------------------------------------------------
describe("Extract 的新函数只能插在语句位置", () => {
/**
 * `refactor.extract` 把新函数**插到非语句位置**（箭头初始化式 / 对象字面量
 * 方法 / class 方法）⇒ 产物**根本不可解析**（3 宿主全中）。
 *
 * 根因（`packages/lsp/src/extract-function.ts`）：插入点的选取**只考虑了「宿主是函数
 * 声明」这一种情形**（`containingFnBox.fn.loc.start`）⇒ 对 `VariableDeclarator.init`
 * 是箭头 / `ObjectProperty.value` 是方法 / `ClassMethod`，节点起点落在**表达式内部**
 * ⇒ 插一条 `function … {}` 声明就打断了宿主表达式。
 *
 * 修法：插入点取「最近祖先的**语句位置**」（Program / BlockStatement / SwitchCase /
 * StaticBlock 的直接子节点）⇒ 箭头初始化式 ⇒ 整条 `export const f = …` 声明之前；
 * 对象字面量方法 / class 方法 ⇒ 所在声明之前。
 *
 * oracle（改前 → 改后，三宿主）：
 * 改前 insertAt = {0,17} / {1,2} / {1,2}
 * ⇒ Babel: Missing semicolon. (4:3) / Unexpected keyword 'function'. (2:2)
 * / Unexpected token (2:11)
 * 改后 insertAt = {0,0}（三者都落在宿主声明之前）⇒ 产物可解析。
 */





const ARROW_SRC = `export const f = (y) => {
  return y + 1;
};
`;
const OBJECT_SRC = `export const o = {
  m() {
    return this.v * 2;
  },
};
`;
const CLASS_SRC = `export class A {
  m() {
    return secret + 1;
  }
}
`;


  it("箭头初始化式：插在整条声明之前，产物可解析；对象字面量方法：插在宿主声明之前，产物可解析；class 方法：插在宿主声明之前，产物可解析；协议面：codeAction 给箭头宿主下发的文本可解析", async () => {
__scenario_12: {
    const r = extractFunction(ARROW_SRC, {
      start: { line: 1, character: 9 },
      end: { line: 1, character: 14 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) break __scenario_12;
    // 改前是 {line:0, character:17}（`=` 之后的箭头起点）
    expect(r.insertAt).toEqual({ line: 0, character: 0 });
    expect(r.newText.indexOf("function extracted")).toBeLessThan(
      r.newText.indexOf("export const f"),
    );
    expect(() => parse(r.newText)).not.toThrow();
  }
__scenario_13: {
    const r = extractFunction(OBJECT_SRC, {
      start: { line: 2, character: 11 },
      end: { line: 2, character: 21 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) break __scenario_13;
    // 改前是 {line:1, character:2}（对象字面量的 `{` 之后）
    expect(r.insertAt).toEqual({ line: 0, character: 0 });
    expect(r.newText.indexOf("function extracted")).toBeLessThan(
      r.newText.indexOf("export const o"),
    );
    expect(() => parse(r.newText)).not.toThrow();
  }
__scenario_14: {
    const r = extractFunction(CLASS_SRC, {
      start: { line: 2, character: 11 },
      end: { line: 2, character: 21 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) break __scenario_14;
    // 改前是 {line:1, character:2}（class body 里）
    expect(r.insertAt).toEqual({ line: 0, character: 0 });
    expect(r.newText.indexOf("function extracted")).toBeLessThan(
      r.newText.indexOf("export class A"),
    );
    expect(() => parse(r.newText)).not.toThrow();
  }
  {
    await withLspServer({ "m.mjs": ARROW_SRC }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("m.mjs") },
        range: { start: { line: 1, character: 9 }, end: { line: 1, character: 14 } },
        context: { diagnostics: [] },
      }) as Array<{
        title: string;
        kind?: string;
        edit?: { changes: Record<string, Array<{ newText: string }>> };
      }>;
      const extract = actions.find((a) => a.kind === "refactor.extract");
      expect(extract).toBeDefined();
      const newText = extract!.edit!.changes[uri("m.mjs")]![0]!.newText;
      expect(newText.indexOf("function extracted")).toBeLessThan(
        newText.indexOf("export const f"),
      );
      expect(() => parse(newText)).not.toThrow();
    });
  }
});




});

// ---------------------------------------------------------------------------
// Extract 不偷走原函数的 export 关键字
// ---------------------------------------------------------------------------
describe("Extract 不偷走原函数的 export 关键字", () => {
/**
 * 「Extract to function 'extracted'」把原函数的 `export` 关键字**偷给新函数**
 * ⇒ 模块公开 API 静默变（导出集合 `['f']` → `['extracted']`，文件仍可解析 ⇒ IDE 不报错）。
 *
 * 根因（`packages/lsp/src/extract-function.ts`）：插入点用的是 **Babel 节点 `loc.start`**
 * （`export function` 里 `function` 关键字的列 = 7），**不是语句起始列**（`export` 的列 = 0）
 * ⇒ 新函数正好落在 `export` 与 `function` 之间 ⇒ `export` 被新函数认领。
 *
 * 修法：插入点取「最近祖先的**语句起点**」（`export function f` ⇒ ExportNamedDeclaration，
 * 起点 = `export` 的列）⇒ 新函数插在 `export` **之前**，`export` 仍属原函数。
 *
 * oracle（改前 → 改后）：
 * 改前 insertAt = {line:0, character:7} ⇒ newText = "export function extracted(a) {…}\nfunction f(a) {…}"
 * 改后 insertAt = {line:0, character:0} ⇒ newText = "function extracted(a) {…}\nexport function f(a) {…}"
 */





const SRC = `export function f(a) {
  const t = a + 1;
  return t;
}
`;

/** 选区 = 第 2 行（0 基）的 `a + 1` */
const SEL = { start: { line: 1, character: 12 }, end: { line: 1, character: 17 } };


  it("插入点是语句起点（export 的列），不是 function 关键字的列；产物里 export 仍属原函数（模块公开 API 不变）；协议面：codeAction 下发的整文件替换保留 export", async () => {
__scenario_15: {
    const r = extractFunction(SRC, SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) break __scenario_15;
    // 改前是 {line:0, character:7}（`export ` 之后）
    expect(r.insertAt).toEqual({ line: 0, character: 0 });
  }
__scenario_16: {
    const r = extractFunction(SRC, SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) break __scenario_16;
    expect(r.newText).toContain("export function f(a) {");
    expect(r.newText).not.toContain("export function extracted");
    // 新函数排在 export 之前
    expect(r.newText.indexOf("function extracted")).toBeLessThan(
      r.newText.indexOf("export function f"),
    );
    // 产物仍可解析
    expect(() => parse(r.newText)).not.toThrow();
  }
  {
    await withLspServer({ "m.mjs": SRC }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("m.mjs") },
        range: SEL,
        context: { diagnostics: [] },
      }) as Array<{
        title: string;
        kind?: string;
        edit?: { changes: Record<string, Array<{ newText: string }>> };
      }>;
      const extract = actions.find((a) => a.kind === "refactor.extract");
      expect(extract).toBeDefined();
      const newText = extract!.edit!.changes[uri("m.mjs")]![0]!.newText;
      expect(newText).toContain("export function f(a) {");
      expect(newText).not.toContain("export function extracted");
    });
  }
});



});

// ---------------------------------------------------------------------------
// Extract 的新函数名做占用检查（撞名自动改名）
// ---------------------------------------------------------------------------
describe("Extract 的新函数名做占用检查（撞名自动改名）", () => {
/**
 * Extract 把新函数名**写死为 `extracted`**、**不查重名** ⇒ 产物出现两个同名
 * 声明 ⇒ `SyntaxError: Identifier 'extracted' has already been declared`
 * ⇒ 模块整个加载不了（IDE 里整文件标红）。
 *
 * 根因：名字由**调用方硬编码**（`packages/lsp/src/server-code-actions.ts` 的
 * `{ name: "extracted" }`）+ 本体只做**词法**校验（`isValidIdent`）**不做占用检查**；
 * 而插入点通常在顶层，顶层 `function` / `const` / `class` / `import` 共用同一命名空间。
 *
 * 修法：**占用检查做进 `extract-function.ts` 内部**（本片独占该文件）⇒ 调用方零改动。
 * 规则：先取调用方给的名字（非法则退回 `extracted`），若该名字在插入点的作用域链上
 * 已被占用，则依次试 `extracted1` / `extracted2` / …（第一个空闲的胜出）。
 *
 * ⚠ 触发面不止「文件里已有 `extracted`」：**同一文件连续抽取两次**必然撞名。
 *
 * oracle（改前 → 改后）：
 * 改前 functionName = "extracted" ⇒ newText 里两个 `export function extracted`
 * ⇒ Babel: Identifier 'extracted' has already been declared. (5:16)
 * 改后 functionName = "extracted1" ⇒ 产物可解析。
 */





const CLASH_SRC = `export function extracted() {
  return 0;
}

export function f() {
  const x = 1;
  return x + 1;
}
`;
/** 选区 = 第 7 行（0 基）的 `x + 1` */
const SEL = { start: { line: 6, character: 9 }, end: { line: 6, character: 14 } };

const FREE_SRC = `export function f(a) {
  const p = a + 1;
  const q = a + 2;
  return p + q;
}
`;

/** 按文本定位选区（LSP 0-based）。 */
function rangeOf(src: string, needle: string): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  const idx = src.indexOf(needle);
  expect(idx).toBeGreaterThanOrEqual(0);
  const before = src.slice(0, idx);
  const line = before.split("\n").length - 1;
  const character = idx - (before.lastIndexOf("\n") + 1);
  return { start: { line, character }, end: { line, character: character + needle.length } };
}


  it("名字被占用时自动改名（extracted → extracted1）；产物里不再有两个同名声明（可解析）；同一文件连续抽取两次：第二次不会撞名；协议面：action 标题带改后的名字；对照：名字没被占用时仍是 `extracted`", async () => {
__scenario_17: {
    const r = extractFunction(CLASH_SRC, SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) break __scenario_17;
    expect(r.functionName).toBe("extracted1");
    expect(r.callText).toBe("extracted1(x)");
  }
__scenario_18: {
    const r = extractFunction(CLASH_SRC, SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) break __scenario_18;
    expect(r.newText.match(/export function extracted\(/g)?.length).toBe(1);
    expect(r.newText.match(/function extracted1\(/g)?.length).toBe(1);
    // 改前：Identifier 'extracted' has already been declared
    expect(() => parse(r.newText)).not.toThrow();
  }
__scenario_19: {
    const first = extractFunction(FREE_SRC, rangeOf(FREE_SRC, "a + 1"));
    expect(first.ok).toBe(true);
    if (!first.ok) break __scenario_19;
    expect(first.functionName).toBe("extracted");
    // 把第一次的产物当作第二次抽取的输入（抽另一个表达式）
    const second = extractFunction(first.newText, rangeOf(first.newText, "a + 2"));
    expect(second.ok).toBe(true);
    if (!second.ok) break __scenario_19;
    expect(second.functionName).toBe("extracted1");
    expect(() => parse(second.newText)).not.toThrow();
  }
  {
    await withLspServer({ "m.mjs": CLASH_SRC }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("m.mjs") },
        range: SEL,
        context: { diagnostics: [] },
      }) as Array<{
        title: string;
        kind?: string;
        edit?: { changes: Record<string, Array<{ newText: string }>> };
      }>;
      const extract = actions.find((a) => a.kind === "refactor.extract");
      expect(extract).toBeDefined();
      expect(extract!.title).toBe("Extract to function 'extracted1'");
      const newText = extract!.edit!.changes[uri("m.mjs")]![0]!.newText;
      expect(() => parse(newText)).not.toThrow();
    });
  }
__scenario_20: {
    const w = extractToWorkspaceEdit(FREE_SRC, rangeOf(FREE_SRC, "a + 1"));
    expect(w.ok).toBe(true);
    if (!w.ok) break __scenario_20;
    expect(w.functionName).toBe("extracted");
    expect(w.title).toBe("Extract to function 'extracted'");
  }
});





});

// ---------------------------------------------------------------------------
// LSP 门禁面必须与 CLI 同源采集行内指令
// ---------------------------------------------------------------------------
describe("LSP 门禁面必须与 CLI 同源采集行内指令", () => {
/**
 * LSP 面**从不采集**行内指令（`@nudo:as` / `@nudo:replace`）
 * ⇒ CLI 与 LSP 对同一份文件给出**相反**的门禁结论与签名 ⇒ IDE 侧**假红**。
 *
 * 根因：`collectEvalReplacements`（service 的行内指令收集器）在
 * `packages/lsp/src/` **一次都没被调用** ⇒ LSP 的两条 `checkSource` 入口
 * （诊断面 `validation.ts` / agent 工具面 `agent-tools.ts`）拿不到覆盖表；
 * CLI 侧经 `buildCheckInjection`（`packages/nudojs/src/commands/check.ts`）
 * 显式传了 `asOverrides` / `asOverrideTargets` / `replacements` /
 * `replacementTargets` ⇒ 两个产品面跑的不是同一份注入。
 *
 * 修法（片 F）：`packages/lsp/src/agent-tools.ts` 新增**注入装配器**
 * `buildLspInjection`（与 CLI `buildCheckInjection` 同口径，**不从 lsp 反向
 * import nudojs**），agent check 工具面把它交给 `checkSource({ inject })`。
 *
 * 钉（agent 门禁面，本片能改的一侧）：
 * - `@nudo:as number()` 夹具 ⇒ `nudo/check` 判绿（0 error）且签名是
 * `string`（CLI 同款结论），不再 `unknown #partial throws TypeError`；
 * - `@nudo:replace makeRaw() number()` 夹具 ⇒ 同上。
 */







/** `@nudo:as`：把 `raw` 覆盖成 number（源码里是 string） */
const AS_SRC = `// @nudo:as number()
const raw = "abc";

export function usesToFixed() {
  return raw.toFixed(2);
}
`;

/** `@nudo:replace`：把 `makeRaw()` 的调用点覆盖成 number */
const REPL_SRC = `function makeRaw() {
  return "abc";
}

// @nudo:replace makeRaw() number()
const raw = makeRaw();

export function usesToFixed() {
  return raw.toFixed(2);
}
`;

type CheckJsonLike = {
  ok: boolean;
  summary: { errors: number; warnings: number; functions: number };
  signatures: Array<{ name: string; display: string }>;
  issues: Array<{ severity: string; code?: string; message: string }>;
};

function openSession(src: string, name: string): {
  mock: ReturnType<typeof createMockConnection>;
  file: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug785-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: `bug785-${name}`, private: true, type: "module" }),
    "utf-8",
  );
  const file = join(dir, `${name}.js`);
  writeFileSync(file, src, "utf-8");
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri: `file://${file}`, languageId: "javascript", version: 1, text: src },
  });
  return {
    mock,
    file,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function checkJson(
  mock: ReturnType<typeof createMockConnection>,
  file: string,
): Promise<CheckJsonLike> {
  const res: any = await mock.requests.get("nudo/check")!({ file, format: "json" });
  const text = String(res?.content?.[0]?.text ?? "");
  return JSON.parse(text) as CheckJsonLike;
}


  it("@nudo:as：agent nudo/check 判绿且签名与 CLI 同款（string，非 unknown）；@nudo:replace：agent nudo/check 判绿且签名与 CLI 同款", async () => {
  {
    const { mock, file, cleanup } = openSession(AS_SRC, "as");
    try {
      const json = await checkJson(mock, file);
      expect(
        json.issues.filter((i) => i.severity === "error").map((i) => `${i.code} ${i.message}`),
        "行内指令未生效 ⇒ IDE 假红",
      ).toEqual([]);
      expect(json.ok, "nudo/check 未判绿").toBe(true);
      expect(json.summary.errors).toBe(0);
      const sig = json.signatures.find((s) => s.name === "usesToFixed");
      expect(sig?.display, "签名面仍与 CLI 分叉").toContain("string");
      expect(sig?.display).not.toContain("unknown");
    } finally {
      cleanup();
    }
  }
  {
    const { mock, file, cleanup } = openSession(REPL_SRC, "repl");
    try {
      const json = await checkJson(mock, file);
      expect(
        json.issues.filter((i) => i.severity === "error").map((i) => `${i.code} ${i.message}`),
        "行内指令未生效 ⇒ IDE 假红",
      ).toEqual([]);
      expect(json.ok, "nudo/check 未判绿").toBe(true);
      const sig = json.signatures.find((s) => s.name === "usesToFixed");
      expect(sig?.display).toContain("string");
      expect(sig?.display).not.toContain("unknown");
    } finally {
      cleanup();
    }
  }
});


});

// ---------------------------------------------------------------------------
// inline 不产出重叠 edit（导出绑定）
// ---------------------------------------------------------------------------
describe("inline 不产出重叠 edit（导出绑定）", () => {
/**
 * `refactor.inline` 对**导出绑定**产出**互相重叠的两条 TextEdit**
 * ⇒ 客户端应用后**源码被毁**（`node --check` ⇒ SyntaxError），且**两种应用顺序都毁**。
 *
 * 根因（`packages/lsp/src/refactor-b2.ts` 的 `inlineVariableAt` refs 循环）：
 * Babel 对**导出绑定**的 `binding.referencePaths` 里**多塞了「声明本身」**
 * （`ExportNamedDeclaration` / `ExportSpecifier`）⇒ inline 的 refs 循环**不区分
 * 节点类型** ⇒ 为声明本身再生成一条「整条声明 → 初值」的替换 edit，与删除 edit
 * **区间重叠**。
 *
 * 修法（两道）：
 * 1. **收集阶段拒绝导出绑定**（`isExportedBinding`）—— 内联会**删除声明** ⇒
 * 导出绑定被内联 = 模块公开 API 变化 ⇒ 本来就不该内联；
 * 2. refs 循环**跳过非「真正的引用」节点**（只接受 `Identifier` 且父节点不是
 * `ExportSpecifier` / `ExportNamedDeclaration` / `ExportDefaultDeclaration`）；
 * 3. 生成 edits 后加一道**区间重叠自检**（相交即放弃该动作）⇒ 绝不产出非法
 * WorkspaceEdit。
 *
 * oracle（动作面 / 语义面）：
 * 改前 `export const X = 42;` ⇒ 3 条 edit，其中 [0:0→0:20] ∩ [0:0→1:0] **重叠**
 * ⇒ 应用后源码变成 `42) {` ⇒ `node --check` FAIL
 * 改后 result = null（**不提供该动作** ⇒ 不产出重叠 edit，源码不被毁）
 */





/** `export const X = 42;` —— 声明本身被 Babel 塞进 referencePaths */
const SRC_EXPORT_DECL = `export const X = 42;
export function use() {
  return X;
}
`;

/** `const X = 42; export { X };` —— 导出说明符在 referencePaths 里 */
const SRC_EXPORT_SPEC = `const X = 42;
export { X };
export function use() {
  return X;
}
`;

/** 对照：非导出绑定 */
const SRC_PLAIN = `const X = 42;
export function use() {
  return X;
}
`;


  it("`export const X = …` ⇒ 不提供 Inline 动作；`export { X }` ⇒ 不提供 Inline 动作；协议面：导出绑定上 codeAction 不含 refactor.inline；对照：非导出绑定仍可内联，且 edit 集合互不重叠；语义面：改前两条 edit 重叠 ⇒ 应用后源码被毁（钉住根因形态）", async () => {
  {
    expect(inlineVariableAt(SRC_EXPORT_DECL, 1, 13)).toBeNull();
  }
  {
    expect(inlineVariableAt(SRC_EXPORT_SPEC, 1, 7)).toBeNull();
  }
  {
    await withLspServer({ "a.js": SRC_EXPORT_DECL }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("a.js") },
        range: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 13 },
        },
        context: { diagnostics: [] },
      }) as Array<{ title: string; kind?: string }>;
      expect(actions.find((a) => a.kind === "refactor.inline")).toBeUndefined();
    });
  }
__scenario_21: {
    const r = inlineVariableAt(SRC_PLAIN, 1, 7);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) break __scenario_21;
    expect(r.title).toContain("Inline variable 'X'");
    expect(anyOverlap(r.edits)).toBe(false);
    const patched = applyEditsHarness(SRC_PLAIN, r.edits);
    expect(nodeCheck(patched)).toBe("OK");
    expect(runModule(patched, "M.use()")).toBe("42");
  }
  {
    // 改前的 edit 集合：声明本身被当成「一个使用点」⇒ 多一条与删除 edit 重叠的替换
    const before = [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 20 },
        },
        newText: "42",
      },
      {
        range: {
          start: { line: 2, character: 9 },
          end: { line: 2, character: 10 },
        },
        newText: "42",
      },
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: "",
      },
    ];
    expect(anyOverlap(before)).toBe(true);
    const patched = applyEditsHarness(SRC_EXPORT_DECL, before);
    expect(nodeCheck(patched)).not.toBe("OK");
  }
});





});

// ---------------------------------------------------------------------------
// inline 不捕获会被改写的自由变量
// ---------------------------------------------------------------------------
describe("inline 不捕获会被改写的自由变量", () => {
/**
 * `refactor.inline` 把**会被重新赋值**的变量捕获进被内联的表达式
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
 * 改前 title = "Inline variable 'x' (1 use)"，应用后 `f()` = 2（改前源码 `f()` = 1）
 * 改后 result = null（**不提供该动作** ⇒ 行为不变）
 */





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


  it("自由变量有写入 ⇒ 不提供 Inline 动作；协议面：codeAction 不含 refactor.inline；对照：自由变量**不可变**时仍可内联（门禁不误伤）；语义面：改前会把 f() 从 1 变成 2（钉住根因形态）", async () => {
  {
    expect(inlineVariableAt(SRC, LINE, COLUMN)).toBeNull();
  }
  {
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
  }
__scenario_22: {
    const stable = `export function f() {
  const a = 1;
  const x = a;
  return x;
}
`;
    const r = inlineVariableAt(stable, 3, 8);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) break __scenario_22;
    expect(r.title).toContain("Inline variable 'x'");
    const patched = applyEditsHarness(stable, r.edits);
    expect(patched).toContain("return a;");
    expect(runModule(patched, "M.f()")).toBe("1");
  }
  {
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
  }
});




});

// ---------------------------------------------------------------------------
// inline 不删同行兄弟语句
// ---------------------------------------------------------------------------
describe("inline 不删同行兄弟语句", () => {
/**
 * `Inline variable 'x'` 把声明所在**整行**删掉 ⇒ 同行兄弟语句被静默删除。
 *
 * 根因（`packages/lsp/src/refactor-b2.ts` 的 `inlineVariableAt` 删除范围段）：
 * 删除范围被**无条件扩到整行**（`character: 0` → 该行长度）来覆盖「声明独占一行」的
 * 常态 ⇒ 声明与其它语句**同行**时（`const a = 1; doSomething(a);`）同行其余内容被
 * 一并删掉 ⇒ 副作用调用（`doSomething(a);`）**静默消失**（文件仍可解析，IDE 无提示）。
 *
 * 修法：删除范围取**声明语句自身**的区间（`const a = 1;`），只有当声明**独占一行**
 * 时才扩到整行（含换行）；同行兄弟语句保留，并被内联展开为 `doSomething(1);`。
 *
 * oracle（动作面 / 语义面）：
 * 改前 edit[2] = [5:0 → 6:0] "" ⇒ 应用后 `doSomething(a);` 整句消失
 * ⇒ 运行时 `calls` = 0（副作用被静默删掉）
 * 改后 edit[2] = [5:2 → 5:15] "" ⇒ 应用后 `doSomething(1);` 保留
 * ⇒ 运行时 `calls` = 1
 */





const SRC = `export let calls = 0;
export function doSomething(x) {
  calls++;
}
export function f() {
  const a = 1; doSomething(a);
  return a + 2;
}
`;

/** 光标：第 6 行（1 基）的 `a`（0 基列 8） */
const LINE = 6;
const COLUMN = 8;

function inline(): { title: string; edits: Edit[] } | null {
  const r = inlineVariableAt(SRC, LINE, COLUMN);
  if (!r || !("edits" in r)) return null;
  return r;
}


  it("删除范围只覆盖声明语句本身（不扩到整行）；edit 集合互不重叠（LSP WorkspaceEdit 合法性）；应用后：兄弟语句保留并被内联展开，副作用不再丢失；协议面：codeAction 提供的 Inline action 不含整行删除", async () => {
  {
    const r = inline();
    expect(r).not.toBeNull();
    const edits = r!.edits;
    const del = edits.find((e) => e.newText === "");
    expect(del).toBeDefined();
    // 「const a = 1;」在 0 基第 5 行的 2..15
    expect(del!.range).toEqual({
      start: { line: 5, character: 2 },
      end: { line: 5, character: 15 },
    });
    // 不得覆盖整行（整行会把 `doSomething(a);` 一起删掉）
    expect(del!.range.start.character).not.toBe(0);
  }
  {
    const r = inline();
    expect(anyOverlap(r!.edits)).toBe(false);
  }
  {
    const r = inline();
    const patched = applyEditsHarness(SRC, r!.edits);
    expect(patched).toContain("doSomething(1);");
    expect(patched).not.toContain("const a = 1;");
    expect(nodeCheck(patched)).toBe("OK");
    // 改前：`calls` = 0（副作用被静默删掉）；改后：`calls` = 1
    expect(runModule(patched, "[M.f(), M.calls]")).toBe("[3,1]");
  }
  {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("a.js") },
        range: {
          start: { line: LINE - 1, character: COLUMN },
          end: { line: LINE - 1, character: COLUMN },
        },
        context: { diagnostics: [] },
      }) as Array<{
        title: string;
        kind?: string;
        edit?: { changes: Record<string, Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }>> };
      }>;
      const inlineAction = actions.find((a) => a.kind === "refactor.inline");
      expect(inlineAction).toBeDefined();
      const edits = inlineAction!.edit!.changes[uri("a.js")]!;
      const del = edits.find((e) => e.newText === "");
      expect(del!.range.start.character).not.toBe(0);
      expect(anyOverlap(edits)).toBe(false);
    });
  }
});




});

// ---------------------------------------------------------------------------
// inline 不内联成员读（getter / Proxy 陷阱）
// ---------------------------------------------------------------------------
describe("inline 不内联成员读（getter / Proxy 陷阱）", () => {
/**
 * 「Inline variable」把**成员读**（getter）内联 ⇒ 求值 1 次变 2 次
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
 * 改前 title = "Inline variable 'g' (2 uses)"，应用后 `obj.total + obj.total`
 * ⇒ `sum(makeObj())` = 3（getter 求值 2 次；改前源码 = 2）
 * 改后 result = null（**不提供该动作** ⇒ 求值次数不变）
 */





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


  it("成员读 ⇒ 不提供 Inline 动作；协议面：codeAction 不含 refactor.inline；语义面：改前会把 getter 求值次数从 1 变成 2（钉住根因形态）；对照：非成员读的纯表达式仍可内联（门禁不误伤）", async () => {
  {
    expect(inlineVariableAt(SRC, LINE, COLUMN)).toBeNull();
  }
  {
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
  }
  {
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
  }
__scenario_23: {
    const plain = `export function f() {
  const g = 1;
  return g + g;
}
`;
    const r = inlineVariableAt(plain, 2, 8);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) break __scenario_23;
    expect(r.title).toContain("Inline variable 'g'");
    const patched = applyEditsHarness(plain, r.edits);
    expect(patched).toContain("return 1 + 1;");
    expect(runModule(patched, "M.f()")).toBe("2");
  }
});




});

// ---------------------------------------------------------------------------
// inline 保留兄弟 declarator
// ---------------------------------------------------------------------------
describe("inline 保留兄弟 declarator", () => {
/**
 * LSP codeAction「Inline variable 'a'」取**整条 `VariableDeclaration`**
 * 作删除范围 ⇒ **同一声明的兄弟 declarator 被一起删掉** ⇒ 产物**语法合法但运行即
 * `ReferenceError`**（IDE/CI 的语法检查发现不了）。
 *
 * 根因（`packages/lsp/src/refactor-b2.ts` 的 `inlineVariableAt`）：删除范围取自
 * `path.parent`（**整条声明语句**）而不是**被内联的那个 declarator**
 * ⇒ 一条 `const a = 1, b = 2;` 里内联 `a` 时 `b` 的**声明**一起消失
 * ⇒ 兄弟变量变成自由标识符。
 *
 * 修法（`declarationEdit`）：**多 declarator 时改写整条声明** —— 去掉被内联的
 * 那个 declarator（含它的分隔逗号）、**保留兄弟**；逗号手术按 **declarator 节点
 * 区间**（`a = 1` / `b = 2`，不是标识符区间）做 ⇒ 既不留 `const , b = 2;` 的语法错，
 * 也不把兄弟的声明删掉。
 *
 * oracle（动作面 / 语义面）：
 * 改前 edit[1] = [1:0 → 3:0] ""（跨两行 ⇒ 取自 `path.parent`）
 * ⇒ 应用后 `return 1 + b;` ⇒ `node --check` **OK** 但运行即
 * `ReferenceError: b is not defined`
 * 改后 edit[1] = [1:2 → 2:10] "const b = 2;"
 * ⇒ 应用后 `const b = 2;` 保留 ⇒ 运行 `f()` = 3
 */





/** 跨行声明 */
const SRC_MULTILINE = `export function f() {
  const a = 1,
    b = 2;
  return a + b;
}
`;

/** 同行声明 */
const SRC_SAMELINE = `export function f() {
  const a = 1, b = 2;
  return a + b;
}
`;


  it("跨行声明：改写整条声明，保留兄弟；同行声明：改写整条声明，保留兄弟；应用后：兄弟声明仍在，语法合法，运行时不再 ReferenceError；协议面：codeAction 的 inline edit 不删掉兄弟声明；语义面：改前删掉整条声明 ⇒ 语法合法但运行即 ReferenceError（钉住根因形态）", async () => {
__scenario_24: {
    const r = inlineVariableAt(SRC_MULTILINE, 2, 8);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) break __scenario_24;
    const declEdit = r.edits.find((e) => e.newText !== "1")!;
    expect(declEdit.newText).toBe("const b = 2;");
    expect(declEdit.range).toEqual({
      start: { line: 1, character: 2 },
      end: { line: 2, character: 10 },
    });
  }
__scenario_25: {
    const r = inlineVariableAt(SRC_SAMELINE, 2, 8);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) break __scenario_25;
    const declEdit = r.edits.find((e) => e.newText !== "1")!;
    expect(declEdit.newText).toBe("const b = 2;");
  }
__scenario_26: {
    for (const src of [SRC_MULTILINE, SRC_SAMELINE]) {
      const r = inlineVariableAt(src, 2, 8);
      expect(r && "edits" in r).toBe(true);
      if (!r || !("edits" in r)) break __scenario_26;
      expect(anyOverlap(r.edits)).toBe(false);
      const patched = applyEditsHarness(src, r.edits);
      expect(patched).toContain("const b = 2;");
      expect(patched).not.toContain("const , ");
      expect(patched).not.toContain("const a = 1,");
      expect(nodeCheck(patched)).toBe("OK");
      expect(runModule(patched, "M.f()")).toBe("3");
    }
  }
  {
    await withLspServer({ "a.js": SRC_MULTILINE }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("a.js") },
        range: {
          start: { line: 1, character: 8 },
          end: { line: 1, character: 8 },
        },
        context: { diagnostics: [] },
      }) as Array<{
        title: string;
        kind?: string;
        edit?: {
          changes: Record<
            string,
            Array<{
              range: { start: { line: number; character: number }; end: { line: number; character: number } };
              newText: string;
            }>
          >;
        };
      }>;
      const inlineAction = actions.find((a) => a.kind === "refactor.inline");
      expect(inlineAction).toBeDefined();
      const edits = inlineAction!.edit!.changes[uri("a.js")]!;
      const declEdit = edits.find((e) => e.newText !== "1")!;
      expect(declEdit.newText).toBe("const b = 2;");
      expect(anyOverlap(edits)).toBe(false);
    });
  }
  {
    const patched = `export function f() {
  return 1 + b;
}
`;
    expect(nodeCheck(patched)).toBe("OK");
    expect(runModule(patched, "M.f()")).toBe("Error: b is not defined");
  }
});





});

// ---------------------------------------------------------------------------
// 补字段 quickfix 不得把 undefined 当值写进调用点
// ---------------------------------------------------------------------------
describe("补字段 quickfix 不得把 undefined 当值写进调用点", () => {
/**
 * A6「Add missing field 'X' to call」把**待填占位符** `undefined`
 * 当成合法值写进调用点（` ${field}: undefined `）。
 *
 * 占位符不是值：它被写进用户的源码后，「字段缺失」这条违规要么被整条跳过
 * （假绿），要么被换成一条别的诊断（用户拿到的是 `undefined` 而不是自己写的
 * 值）。⇒ 钉：
 * 1. 调用点的插入文本**不得**是 `undefined`；
 * 2. 应用 quickfix 后，**该违规仍被报出**（门禁不许被这个 quickfix 变绿）。
 */








const GREET_JS = `export function greet(u) {
  return u.name + "!";
}

greet({ id: 2 });
`;
const GREET_SC = `import { fn, shape, string } from "@nudojs/core";

export const greet = fn({ u: shape({ name: string() }) }, string());
`;


  it("插入文本不是 undefined（占位不是值）；应用后源码可编译，且该违规仍被报出（门禁不被 quickfix 变绿）", () => {
  {
    withTempDir("nudo-lsp-730-", (dir) => {
      writeFileSync(join(dir, "greet.js"), GREET_JS, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), GREET_SC, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, GREET_JS);
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      const edits = docEdits(actions, uri);
      expect(edits.length).toBeGreaterThan(0);
      for (const e of edits) {
        expect(e.newText).not.toContain("undefined");
        expect(e.newText).toContain("name:");
      }
    });
  }
  {
    withTempDir("nudo-lsp-730b-", (dir) => {
      const srcPath = join(dir, "greet.js");
      writeFileSync(srcPath, GREET_JS, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), GREET_SC, "utf-8");
      const uri = `file://${srcPath}`;
      const handler = mountCodeActions(uri, GREET_JS);
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      const applied = applyEditsHarness(GREET_JS, docEdits(actions, uri));
      writeFileSync(srcPath, applied, "utf-8");
      // 落盘文本里不得出现 undefined 占位
      expect(applied).not.toContain("undefined");
      expect(applied).toContain("name:");
      // 语义面：违规仍在（不是假绿）
      const report = checkSource(srcPath, applied, undefined, {
        loadModule: defaultLoadModule,
      });
      const violated = report.issues.filter((i) => i.code === "nudo:constraint-violated");
      expect(violated.length).toBeGreaterThan(0);
    });
  }
});


});

// ---------------------------------------------------------------------------
// 占位 range 换算后落合法位置（line ≥ 0）
// ---------------------------------------------------------------------------
describe("占位 range 换算后落合法位置（line ≥ 0）", () => {
/**
 * 回归钉：service 侧的**占位 range**（无源码锚点）换算到 LSP 后
 * 必须是合法位置（`Position.line` 是 uinteger，≥ 0），不得落成 -1。
 *
 * 改前：toLspDiagnostic 无条件 `line - 1`，而 service 对「无锚点」的诊断
 * 发 `range: {start:{line:0,column:0}}`（占位，不是「第 0 行」）→ -1。
 * 受影响：`nudo:module-missing` / `nudo:mock-invalid` 等 error 级诊断。
 *
 * 行号基（自读代码确认，与报告描述不同）：service 的 Diagnostic.range 行号
 * 是 **1 基源码行**（Babel `node.loc`；CLI 报告与 check-json-map 直接印它），
 * `line: 0` 是「无锚点」占位。LSP 侧 1 基 → 0 基仍要减 1，但必须钳位 ≥ 0。
 *
 * 负控制：真实 1 基行号仍按原口径换算（不得整体偏移）。
 */






const MOCK_MISSING = `/**
 * @nudo:mock dep from "./nope.js"
 */
export function f(x) {
  return dep(x);
}
`;


  it("toLspDiagnostic：占位 range（line 0）→ line 0（改前：-1）；toLspDiagnostic：真实 1 基行号仍按 1 基 → 0 基换算（负控制）；发布面：nudo:module-missing 落合法位置（改前：line -1）；发布面：所有诊断的 range 位置都合法（负控制：不得有 line < 0）", async () => {
  {
    const d = toLspDiagnostic(
      {
        severity: "error",
        code: DIAG.moduleMissing,
        message: "Mock file not found for 'dep'",
        range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
      },
      "file:///t/d-mock.js",
    );
    expect(d.range.start.line).toBe(0);
    expect(d.range.start.character).toBe(0);
    expect(d.range.end.line).toBe(0);
  }
  {
    const d = toLspDiagnostic(
      {
        severity: "error",
        code: DIAG.entryMayThrow,
        message: "may throw",
        range: { start: { line: 3, column: 7 }, end: { line: 3, column: 8 } },
      },
      "file:///t/a.js",
    );
    expect(d.range.start.line).toBe(2);
    expect(d.range.start.character).toBe(7);
  }
  {
    const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = [];
    const deps = makeValidateDeps({ onPublish: (p) => published.push(p) });
    await validateText("/t/d-mock.js", "file:///t/d-mock.js", MOCK_MISSING, 1, deps, false, true);
    const last = published[published.length - 1]!;
    const missing = last.diagnostics.find((d) => d.code === DIAG.moduleMissing);
    expect(missing).toBeDefined();
    expect(missing!.range.start.line).toBeGreaterThanOrEqual(0);
    expect(missing!.range.start.character).toBeGreaterThanOrEqual(0);
  }
  {
    const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = [];
    const deps = makeValidateDeps({ onPublish: (p) => published.push(p) });
    await validateText("/t/d-mock.js", "file:///t/d-mock.js", MOCK_MISSING, 1, deps, false, true);
    const last = published[published.length - 1]!;
    for (const d of last.diagnostics) {
      expect(d.range.start.line, String(d.code)).toBeGreaterThanOrEqual(0);
      expect(d.range.start.character, String(d.code)).toBeGreaterThanOrEqual(0);
      expect(d.range.end.line, String(d.code)).toBeGreaterThanOrEqual(0);
      expect(d.range.end.character, String(d.code)).toBeGreaterThanOrEqual(0);
    }
  }
});




});

// ---------------------------------------------------------------------------
// 反向钉：whatIf 注入假设后类型**确实**改变（报告为假阳性）
// ---------------------------------------------------------------------------
describe("反向钉：whatIf 注入假设后类型**确实**改变（报告为假阳性）", () => {
/**
 * **报告结论不成立（假阳性）**：反向钉，钉住「当前行为正确」。
 *
 * 报告称 `nudo.whatIf` 注入假设后类型不变（自称「Bindings applied」却类型
 * 没变）。实测（probe-755b / A4 oracle）：`agent-tools.ts` 注入后**分析的
 * 就是注入后的 source**（`injectBindings` → `analyzeFile(注入后的 source)`），
 * 顶层 `const total = 1` + binding `{name:"total",type:"string"}` ⇒ 类型由
 * `1` 变 `string`。
 *
 * 本钉锁住该行为：改前（HEAD）与改后都必须绿。**不改产品代码。**
 */




  it("顶层 const 的类型随 binding 改变（注入后的 source 被真正分析）", async () => {
    const src = "const total = 1;\n";
    const deps = { readFile: () => src };
    const base = await whatIf(
      { file: "/t/a4-755.js", bindings: [], target: "total", source: src },
      deps,
    );
    const assumed = await whatIf(
      {
        file: "/t/a4-755.js",
        bindings: [{ name: "total", type: "string" }],
        target: "total",
        source: src,
      },
      deps,
    );
    // 未注入：字面量 1
    expect(base.content[0].text).toContain('Type of "total": 1');
    // 注入 string ⇒ 类型变（报告声称此处「同型」——实测不成立）
    expect(assumed.content[0].text).toContain('Type of "total": string');
    expect(assumed.content[0].text).not.toBe(base.content[0].text);
    // 「Bindings applied」与类型自洽
    expect(assumed.content[0].text).toContain("Bindings applied: total: string");
  });

});

// ---------------------------------------------------------------------------
// nudo/whatIf 入参校验（畸形请求 ⇒ 工具错误）
// ---------------------------------------------------------------------------
describe("nudo/whatIf 入参校验（畸形请求 ⇒ 工具错误）", () => {
/**
 * `nudo/whatIf` 的入参**零校验**：
 *
 * 1. `target` 缺失 ⇒ 返回 `Type of "undefined": unknown` 的**假成功**——
 * `unknown` 按产品口径是「推断失败」，于是「你根本没传 target」被说成
 * 「这个变量推断不出来」。⇒ 工具错误。
 * 2. `bindings` 不是数组 ⇒ 裸 JS TypeError（`bindings.map is not a
 * function`）当工具错误回给客户端——引擎内部实现细节，不是可诊断信息。
 * ⇒ 工具错误（可诊断文案）。
 * 3. `bindings` 项缺 `name` ⇒ 静默 no-op，且回显行渲染成「…: 」（冒号后
 * 为空）——用户以为「没有未应用的绑定」，实际是自己少传了字段。
 * ⇒ 工具错误。
 *
 * 「target 不是已知绑定」仍是**合法**结果（文档承诺 `unknown`）——只有
 * **请求本身畸形**才走工具错误（对照组）。
 *
 * 协议面回归钉：真 server（mock connection）+ 真协议请求。
 */




const SRC = ["const total = 1;", ""].join("\n");


  it("target 缺失 / bindings 非数组 / binding 缺 name ⇒ isError:true；service 侧 injectBindings 也做形状校验（非数组 ⇒ 可诊断错误）", async () => {
  {
    await withLspServer({ "a4-961.js": SRC }, async ({ req, uri }) => {
      const file = uri("a4-961.js");

      // ① target 缺失 ⇒ 失败（此前是 `Type of "undefined": unknown` 假成功）
      const noTarget = await req("nudo/whatIf")({ file, bindings: [] });
      expect(noTarget.isError).toBe(true);
      expect(noTarget.content[0].text).toContain("target is required");
      expect(noTarget.content[0].text).not.toContain('Type of "undefined"');

      // ② bindings 非数组 ⇒ 失败，且文案可诊断（不是裸 JS TypeError）
      const notArray = await req("nudo/whatIf")({ file, target: "total", bindings: "x" });
      expect(notArray.isError).toBe(true);
      expect(notArray.content[0].text).toContain("bindings must be an array");
      expect(notArray.content[0].text).not.toContain("is not a function");

      // ③ binding 缺 name ⇒ 失败
      const noName = await req("nudo/whatIf")({
        file,
        target: "total",
        bindings: [{ type: "string" }],
      });
      expect(noName.isError).toBe(true);
      expect(noName.content[0].text).toContain("bindings[0]");

      // 对照组：target 不是已知绑定 ⇒ 合法成功面（unknown），不是错误
      const unknownTarget = await req("nudo/whatIf")({ file, target: "nope", bindings: [] });
      expect(unknownTarget.isError).toBeFalsy();
      expect(unknownTarget.content[0].text).toContain('Type of "nope": unknown');

      // 对照组：合法请求 ⇒ 成功面
      const ok = await req("nudo/whatIf")({ file, target: "total", bindings: [] });
      expect(ok.isError).toBeFalsy();
      expect(ok.content[0].text).toContain('Type of "total": 1');
    });
  }
  {
    // 形状校验下沉到 service（CLI --what-if 与其它调用方同样受益）
    expect(() => injectBindings("const total = 1;\n", "x" as never)).toThrow(
      /bindings must be an array/,
    );
    // 缺 name 的项：具名提示（此前是空串 ⇒ 提示行渲染成「…: 」）
    const out = injectBindings("const total = 1;\n", [{ type: "string" } as never]);
    expect(out.unapplied).toEqual(["<missing name>"]);
  }
});


});
