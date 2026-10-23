/**
 * Bug 971 —— Extract 把新函数名**写死为 `extracted`**、**不查重名** ⇒ 产物出现两个同名
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
 *   改前 functionName = "extracted" ⇒ newText 里两个 `export function extracted`
 *        ⇒ Babel: Identifier 'extracted' has already been declared. (5:16)
 *   改后 functionName = "extracted1" ⇒ 产物可解析。
 */
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { extractFunction, extractToWorkspaceEdit } from "../extract-function.ts";
import { withLspServer } from "./helpers.ts";

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

describe("Bug 971 · Extract 的新函数名做占用检查（撞名自动改名）", () => {
  it("名字被占用时自动改名（extracted → extracted1）", () => {
    const r = extractFunction(CLASH_SRC, SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.functionName).toBe("extracted1");
    expect(r.callText).toBe("extracted1(x)");
  });

  it("产物里不再有两个同名声明（可解析）", () => {
    const r = extractFunction(CLASH_SRC, SEL);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newText.match(/export function extracted\(/g)?.length).toBe(1);
    expect(r.newText.match(/function extracted1\(/g)?.length).toBe(1);
    // 改前：Identifier 'extracted' has already been declared
    expect(() => parse(r.newText)).not.toThrow();
  });

  it("同一文件连续抽取两次：第二次不会撞名", () => {
    const first = extractFunction(FREE_SRC, rangeOf(FREE_SRC, "a + 1"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.functionName).toBe("extracted");
    // 把第一次的产物当作第二次抽取的输入（抽另一个表达式）
    const second = extractFunction(first.newText, rangeOf(first.newText, "a + 2"));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.functionName).toBe("extracted1");
    expect(() => parse(second.newText)).not.toThrow();
  });

  it("协议面：action 标题带改后的名字", async () => {
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
  });

  it("对照：名字没被占用时仍是 `extracted`", () => {
    const w = extractToWorkspaceEdit(FREE_SRC, rangeOf(FREE_SRC, "a + 1"));
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.functionName).toBe("extracted");
    expect(w.title).toBe("Extract to function 'extracted'");
  });
});
