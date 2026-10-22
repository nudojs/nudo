/**
 * Bug 789：成员补全的**接收者绑定表不下沉函数体** ⇒ 函数局部 / 形参接收者
 * 一律**零候选**（连 `string` 局部量也是 0 项），而**模块级**同类接收者正常。
 *
 * 根因：接收者 Abs 的唯一来源是**模块级**绑定面（`AnalysisResult.bindings`，
 * 由 service 的 `collectBindings` 只遍历**顶层**语句填充）⇒ 函数体内的
 * `const` / 形参**不在表里** ⇒ 成员面走 `default: return []` ⇒ 零候选。
 * ⇒ 决定补全成败的不是「接收者是什么类型」，而是「接收者声明在不在模块顶层」。
 *
 * 期望（**同一份代码只改「接收者声明的位置」**）：
 * - 模块级 `const` 与函数体内 `const` ⇒ **成员候选集完全一致**（string 原型表）；
 * - 函数体内的对象字面量局部量 ⇒ 给出对象槽位；
 * - 形参 ⇒ 按契约种子（侧车 `*.nudo.js` 的 `shape({...})`）给出成员表。
 *
 * 反向护栏：模块级接收者**仍然**有候选（不得因绑定下沉而清零）。
 */
import { describe, expect, it } from "vitest";
import { openLspDocument, requestCompletion } from "./lsp-bug-d4-harness.ts";
import { withLspServer } from "./helpers.ts";

/** 侧车约束模板（形参契约的来源）。 */
const STD = `export const user = shape({ alpha: number(), beta: string() });\n`;

const SRC = [
  `export const modStr = "abc";`,
  `export const modObj = { alpha: 1, beta: "x" };`,
  ``,
  `export function useModuleLevel() {`,
  `  return modStr.toUpperCase();`,
  `}`,
  ``,
  `export function useLocal() {`,
  `  const loc = "abc";`,
  `  return loc.toUpperCase();`,
  `}`,
  ``,
  `export function useLocalObj() {`,
  `  const obj = { alpha: 1, beta: "x" };`,
  `  return obj.alpha;`,
  `}`,
].join("\n");

/** 光标列 = 该行里 needle 之后的列（needle 含尾随点号）。 */
function colAfter(line: string, needle: string): number {
  return line.indexOf(needle) + needle.length;
}

function lineOf(src: string, needle: string): { line: number; text: string } {
  const lines = src.split("\n");
  const line = lines.findIndex((l) => l.includes(needle));
  if (line < 0) throw new Error(`fixture missing ${needle}`);
  return { line, text: lines[line]! };
}

const labels = (items: { label: string }[]): string[] => items.map((i) => i.label);

describe("Bug 789 — 成员补全的接收者绑定表下沉函数体", () => {
  it("函数体内的局部量接收者 ⇒ 与模块级同款候选（string 原型表）", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-789/a.js");
    const mod = lineOf(SRC, "modStr.toUpperCase");
    const loc = lineOf(SRC, "loc.toUpperCase");
    const modItems = requestCompletion(
      mock,
      uri,
      mod.line,
      colAfter(mod.text, "modStr."),
    );
    const locItems = requestCompletion(mock, uri, loc.line, colAfter(loc.text, "loc."));
    // 模块级：string 原型表（非空）
    expect(labels(modItems).length).toBeGreaterThan(0);
    expect(labels(modItems)).toContain("toUpperCase");
    // 函数体内：**完全一致**（改前是 0 项）
    expect(labels(locItems)).toEqual(labels(modItems));
  });

  it("函数体内的对象字面量局部量 ⇒ 给出对象槽位", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-789/b.js");
    const obj = lineOf(SRC, "obj.alpha");
    const items = requestCompletion(mock, uri, obj.line, colAfter(obj.text, "obj."));
    expect(labels(items).sort()).toEqual(["alpha", "beta"]);
  });

  it("形参接收者 ⇒ 按契约种子（侧车 shape）给出成员表", async () => {
    const libSrc = [
      `/// @nudo:import { user } from "./std.nudo.js"`,
      `/**`,
      ` * @nudo:contract obj user`,
      ` */`,
      `export function useParam(obj) {`,
      `  return obj.alpha;`,
      `}`,
    ].join("\n");
    await withLspServer(
      { "std.nudo.js": STD, "lib.js": libSrc },
      async ({ req, uri }) => {
        const line = libSrc.split("\n").findIndex((l) => l.includes("obj.alpha"));
        const text = libSrc.split("\n")[line]!;
        const res = req("textDocument/completion")({
          textDocument: { uri: uri("lib.js") },
          position: { line, character: colAfter(text, "obj.") },
        }) as { label: string }[];
        expect(labels(res).sort()).toEqual(["alpha", "beta"]);
      },
    );
  });
});
