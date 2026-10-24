/**
 * Bug 952：LSP `textDocument/completion` **不判词法上下文** ⇒ 光标落在
 * **字符串 / 模板字面量内部**时照样弹出成员候选与指令候选；**接受任一项即把
 * 标识符写进字面量内部** ⇒ 静默改写字符串的运行时值（协议层返回与代码位
 * **逐字节相同**的候选）。
 *
 * 期望：
 * - 光标在字符串 / 模板字面量**内部** ⇒ 成员面与变量面**都不出候选**；
 * - 光标在注释里 ⇒ 同样不出成员 / 变量候选（注释里只走指令面）；
 * - 光标在**代码位** ⇒ 成员候选**照旧**（不得过度拦截）；
 * - 注释里的 `@nudo:` 指令面**照旧**（不得误伤指令补全）。
 */
import { describe, expect, it } from "vitest";
import { openLspDocument, requestCompletion } from "./lsp-bug-d4-harness.ts";

const SRC = [
  `export const modObj = { alpha: 1, beta: "x" };`,
  `export const s1 = "modObj.";`,
  `export const s2 = \`modObj.\`;`,
  `// modObj.`,
  `export const t1 = modObj.alpha;`,
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

describe("Bug 952 — 补全面判词法上下文", () => {
  it("字符串字面量内部 ⇒ 零候选（改前给成员表）", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-952/a.js");
    const at = lineOf(SRC, '"modObj."');
    const items = requestCompletion(mock, uri, at.line, colAfter(at.text, "modObj."));
    expect(labels(items)).toEqual([]);
  });

  it("模板字面量内部 ⇒ 零候选（改前给成员表）", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-952/b.js");
    const at = lineOf(SRC, "`modObj.`");
    const items = requestCompletion(mock, uri, at.line, colAfter(at.text, "modObj."));
    expect(labels(items)).toEqual([]);
  });

  it("注释内部 ⇒ 零成员 / 变量候选（改前给成员表）", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-952/c.js");
    const at = lineOf(SRC, "// modObj.");
    const items = requestCompletion(mock, uri, at.line, colAfter(at.text, "modObj."));
    expect(labels(items)).toEqual([]);
  });

  it("代码位 ⇒ 成员候选照旧（不得过度拦截）", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-952/d.js");
    const at = lineOf(SRC, "modObj.alpha");
    const items = requestCompletion(mock, uri, at.line, colAfter(at.text, "modObj."));
    expect(labels(items).sort()).toEqual(["alpha", "beta"]);
  });

  it("注释里的指令面照旧（不得误伤指令补全）", async () => {
    const src = "// @nudo:ca\nexport const k = 1;\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-bug-952/e.js");
    const items = requestCompletion(mock, uri, 0, 11);
    expect(labels(items)).toEqual(["@nudo:case"]);
  });
});
