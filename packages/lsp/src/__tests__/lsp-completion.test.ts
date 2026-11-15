/**
 * 模块套件：completion 面（操作符后 / 函数 detail/kind / 词法门 / 指令 / 尾点）。
 */
import { describe, expect, it } from "vitest";
import { openLspDocument, requestCompletion } from "./lsp-harness-d4.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { withTempDir } from "./helpers.ts";
import { getCompletionsAtPosition } from "../lsp-surface/completions.ts";
import { getHoverAtPosition } from "../lsp-surface/hover.ts";

// ---------------------------------------------------------------------------
// Bug 708 — 指令补全只在注释里出
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 708 — 指令补全只在注释里出", () => {
/**
 * Bug 708：指令补全的假阳性——乘号之后也弹 `@nudo:` 指令。
 *
 * 症状：光标在 `x * ` 之后（乘法运算符）时，补全面给出 11 条 `@nudo:` 指令；
 * 旧口径是「前面出现过 `*` 或 `nudo`」的子串匹配（`@?n?u?d?o?:?` 全可选）。
 *
 * 期望：指令面**只在光标确实落在注释里**时出；代码区（乘号之后）⇒ 走变量/
 * 成员补全；字符串字面量里的 `@nudo:` 也不是注释 ⇒ 不出指令。
 * 反向护栏：注释里（`// @nudo:ca`）**仍然**要出指令项。
 */



const isDirective = (label: string): boolean => label.startsWith("@nudo:");

describe("Bug 708 — 指令补全只在注释里出", () => {
  it("乘号之后：不出指令项（出的是变量补全）", async () => {
    const src = "export function f(x, y) {\n  return x * y;\n}\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-bug-708/a.js");
    // 光标在 `* ` 之后、`y` 之前（行内第 13 列）
    const items = requestCompletion(mock, uri, 1, 13);
    expect(items.filter((i) => isDirective(i.label))).toEqual([]);
    expect(items.map((i) => i.label)).toContain("f");
  });

  it("字符串字面量里的 @nudo: 不是注释 ⇒ 不出指令项", async () => {
    const src = 'export const k = 1;\nconst s2 = "@nudo:ca";\n';
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-bug-708/b.js");
    const items = requestCompletion(mock, uri, 1, 19);
    expect(items.filter((i) => isDirective(i.label))).toEqual([]);
  });

  it("注释里：仍然出指令项（不误伤）", async () => {
    const src = "// @nudo:ca\nexport const k = 1;\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-bug-708/c.js");
    const items = requestCompletion(mock, uri, 0, 11);
    expect(items.map((i) => i.label)).toEqual(["@nudo:case"]);
  });

  it("JSDoc 多行注释里：仍然出指令项（跨行块注释词法上下文）", async () => {
    const src = "/**\n * @nudo:ca\n */\nexport const k = 1;\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-bug-708/d.js");
    const items = requestCompletion(mock, uri, 1, 10);
    expect(items.map((i) => i.label)).toContain("@nudo:case");
    expect(items.every((i) => isDirective(i.label))).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// BUG-091 — completion 的函数 detail 与 hover / check 签名同形
// ---------------------------------------------------------------------------
describe("[lsp-] BUG-091 — completion 的函数 detail 与 hover / check 签名同形", () => {
/**
 * BUG-091 —— LSP completion 的函数条目 detail 用 `?` 占位返回值 ⇒ 与同一 LSP 面的
 * hover、以及 `nudo check` 签名给出两种渲染。
 *
 * 症状：同一文件里 `lit` / `obj` 的 detail 是真实类型，而 `ident` 是 `(x) => ?`
 * （`?` 既不是 TS 类型也不是 Nudo 类型）；同一时刻 hover 给
 * `ident(x: any) => any` ⇒ 同一面内部两种口径。
 *
 * 根因：`detail` 整条走 `absDetail`（`formatShape`）—— fn 形态在 `returnType`
 * 槽为空（arity-only fn Abs，未被调用观测过）时回落占位符 `?`
 * （`core/algebra/format.ts` 的 fn 分支），而变量形态走另一条（正确的）路径。
 *
 * 修法：绑定面 detail 的函数形态改走 **check 签名公式**（`fnBindingDetail`）——
 * 形参名 + `formatShape(形参 Abs)`（缺失 = `any`），返回 `formatShape(返回 Abs)`
 * （缺失 = `any`）；非函数形态仍走 `formatShape`。
 *
 * 钉：`ident` 的 detail **逐字**等于 `ident(x: any) => any`（且与 hover 的 check
 * 同口径签名一致），`lit` / `obj` 仍为真实类型。
 */







/** 复现夹具（tmp/repro/bug-091/c.js）：变量 / 函数 / 对象三种形态并排。 */
const SRC = `export const lit = 42;
export function ident(x) { return x; }
export const obj = { a: 1 };
`;

describe("BUG-091 — completion 的函数 detail 与 hover / check 签名同形", () => {
  it("fn 绑定 detail = `ident(x: any) => any`（不是 `(x) => ?`），且与 hover.signature 一致", () => {
    withTempDir("nudo-bug091-", (dir) => {
      const file = join(dir, "c.js");
      writeFileSync(file, SRC, "utf-8");

      // 末行（空行）无成员访问触发点 ⇒ 变量补全面（绑定面）
      const items = getCompletionsAtPosition(file, SRC, 4, 0);
      const detailOf = (label: string): string | undefined =>
        items.find((i) => i.label === label)?.detail;

      // 变量 / 对象形态：仍是真实类型（修复不得改动这两条路径）
      expect(detailOf("lit")).toBe("42");
      expect(detailOf("obj")).toBe("{ a: 1 }");

      // 函数形态：check 同形签名，不是 `(x) => ?`
      const ident = items.find((i) => i.label === "ident");
      expect(ident?.kind).toBe("function");
      expect(detailOf("ident")).toBe("ident(x: any) => any");
      expect(detailOf("ident")).not.toContain("?");

      // 同一面同口径：补全 detail ≡ hover 的 check 签名（BUG-091 的两面矛盾）
      const hover = getHoverAtPosition(file, SRC, 2, 16);
      expect(hover?.signature).toBe("ident(x: any) => any");
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 717 — 模块级函数补全 kind = Function
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 717 — 模块级函数补全 kind = Function", () => {
/**
 * Bug 717：模块级函数的补全 kind 串档。
 *
 * 症状：顶层 `function` / 箭头函数绑定在补全面里是 `CompletionItemKind.Method`
 * （2）——它不是任何对象的成员，IDE 会把它渲染成「方法」。
 * 期望：模块级 fn 绑定 → `CompletionItemKind.Function`（3）；成员函数仍是
 * Method（2）；非函数绑定仍是 Variable（6）。
 */



const KIND_METHOD = 2;
const KIND_FUNCTION = 3;
const KIND_VARIABLE = 6;

const SRC = [
  "export function exportedFn(a) { return a; }",
  "export const exportedArrow = (b) => b;",
  "const localFn = (c) => c;",
  "const localConst = 1;",
  "",
].join("\n");

describe("Bug 717 — 模块级函数补全 kind = Function", () => {
  it("顶层 fn 绑定 → Function(3)，非函数绑定 → Variable(6)", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-717/a.js");
    const items = requestCompletion(mock, uri, 4, 0);
    const byLabel = new Map(items.map((i) => [i.label, i.kind]));
    expect(byLabel.get("exportedFn")).toBe(KIND_FUNCTION);
    expect(byLabel.get("exportedArrow")).toBe(KIND_FUNCTION);
    expect(byLabel.get("localFn")).toBe(KIND_FUNCTION);
    expect(byLabel.get("localConst")).toBe(KIND_VARIABLE);
    expect([...byLabel.values()]).not.toContain(KIND_METHOD);
  });

  it("成员函数补全仍是 Method(2)（不能被一起改掉）", async () => {
    const src = "export const obj = { m() { return 1; } };\nobj.\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-bug-717/b.js");
    const items = requestCompletion(mock, uri, 1, 4);
    const byLabel = new Map(items.map((i) => [i.label, i.kind]));
    expect(byLabel.get("m")).toBe(KIND_METHOD);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 952 — 补全面判词法上下文
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 952 — 补全面判词法上下文", () => {
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
});

// ---------------------------------------------------------------------------
// Bug 700 — @nudo:sample 补全项如实描述
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 700 — @nudo:sample 补全项如实描述", () => {
/**
 * Bug 700：`@nudo:sample` 补全项的 detail / insertText 不实。
 *
 * 症状：detail 吹成「Control loop iteration sampling」，但该指令**只被解析、
 * 不被消费**（reserved / no-op）；insertText 是 `@nudo:sample `（缺 count）
 * ⇒ 接受补全即产生 `nudo:sample-count` 诊断。
 * 期望：detail 如实说明；insertText 带 count 占位 ⇒ 接受即干净。
 */



// JSDoc 里的 ` * @nudo:` —— 光标在 `@nudo:` 之后
const SRC = "/**\n * @nudo:\n */\nexport const k = 1;\n";

describe("Bug 700 — @nudo:sample 补全项如实描述", () => {
  it("detail 说明是 reserved / no-op", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-700/a.js");
    const items = requestCompletion(mock, uri, 1, 9);
    const sample = items.find((i) => i.label === "@nudo:sample");
    expect(sample).toBeDefined();
    expect(sample!.detail).toMatch(/reserved/i);
    expect(sample!.detail).not.toMatch(/sampling/i);
  });

  it("insertText 带 count 占位（接受后不产生诊断）", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-700/b.js");
    const items = requestCompletion(mock, uri, 1, 9);
    const sample = items.find((i) => i.label === "@nudo:sample");
    expect(sample!.insertText).toBe("@nudo:sample 1");
  });

  it("textEdit 区间 = [前缀起点, 光标]（接受后源码恰是 `@nudo:sample 1`）", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-700/c.js");
    // 第 1 行是 ` * @nudo:` —— 光标在第 9 列（行尾）
    const items = requestCompletion(mock, uri, 1, 9);
    const sample = items.find((i) => i.label === "@nudo:sample")!;
    const edit = (sample as unknown as { textEdit: { range: any; newText: string } }).textEdit;
    expect(edit.newText).toBe("@nudo:sample 1");
    expect(edit.range.start).toEqual({ line: 1, character: 3 });
    expect(edit.range.end).toEqual({ line: 1, character: 9 });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 698 — 尾随点号补全不再清零
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 698 — 尾随点号补全不再清零", () => {
/**
 * Bug 698：尾随点号（编辑中间态）⇒ 补全整面清零。
 *
 * 症状：用户刚敲下 `obj.` 时 buffer 文本语法非法 ⇒ 原文分析直接抛
 * （parse 不容错）⇒ completion 返回 [] 并在 console 报错。
 * 期望：尾随点号与「已敲出部分成员名」表现一致（都给出 obj 的成员）。
 */



const SRC = "export const obj = { alpha: 1, beta: 2 };\nobj.\n";

describe("Bug 698 — 尾随点号补全不再清零", () => {
  it("尾随点号：给出 obj 的成员，且不报 console 错", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-698/a.js");
    const items = requestCompletion(mock, uri, 1, 4);
    expect(items.map((i) => i.label)).toEqual(["alpha", "beta"]);
    expect(mock.consoleErrors).toEqual([]);
  });

  it("已敲出部分成员名：行为不变（同样给出成员）", async () => {
    const src = "export const obj = { alpha: 1, beta: 2 };\nobj.al\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-698/b.js");
    const items = requestCompletion(mock, uri, 1, 6);
    expect(items.map((i) => i.label)).toEqual(["alpha", "beta"]);
  });

  it("尾随点号与部分成员名的结果一致（补全面不因编辑中间态塌掉）", async () => {
    const dot = await openLspDocument(SRC, "file:///tmp/nudo-698/c.js");
    const partial = await openLspDocument(
      "export const obj = { alpha: 1, beta: 2 };\nobj.al\n",
      "file:///tmp/nudo-698/d.js",
    );
    expect(requestCompletion(dot.mock, dot.uri, 1, 4)).toEqual(
      requestCompletion(partial.mock, partial.uri, 1, 6),
    );
  });
});
});
