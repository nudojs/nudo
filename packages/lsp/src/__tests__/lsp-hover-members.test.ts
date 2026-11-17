/**
 * 模块套件：lsp-hover-members（LSP 分片；1 文件 = 1 worker）。
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withLspServer } from "./helpers.ts";
import { openLspDocument, requestCompletion } from "./lsp-harness-semantic-tokens.ts";


// ---------------------------------------------------------------------------
// 嵌套成员访问的接收者是整条路径
// ---------------------------------------------------------------------------
describe("嵌套成员访问的接收者是整条路径", () => {
/**
 * 成员补全把嵌套成员访问的接收者取成「最后一段标识符」。
 *
 * 症状：`a = { b: { right: 2 } }` 且模块级另有 `b = { wrong: 1 }` 时，
 * `a.b.` 的候选是**顶层绑定 `b`** 的成员（`wrong`）——`a.b` 上根本没有这个
 * 成员 ⇒ 用户接受补全会得到运行时 `undefined`。
 *
 * 期望：接收者按**整条成员访问链**解析（`a.b`）⇒ 候选 = `a.b` 的成员。
 */



const SRC = [
  `export const b = { wrong: 1 };`,
  `export const a = { b: { right: 2 } };`,
  ``,
  `export function useNested() {`,
  `  return a.b.right;`,
  `}`,
].join("\n");

/** 光标位置：needle（已写出的接收者 + 成员前缀）之后。 */
function cursorAfter(src: string, needle: string): { line: number; character: number } {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i]!.indexOf(needle);
    if (c >= 0) return { line: i, character: c + needle.length };
  }
  throw new Error(`needle not found: ${needle}`);
}


  it("a.b. 的候选是 a.b 的成员，不是同名顶层绑定的成员", async () => {
    await withLspServer({ "nested.js": SRC }, async ({ req, uri }) => {
      const lines = SRC.split("\n");
      let line = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes("return a.b.right")) {
          line = i;
          break;
        }
      }
      expect(line).toBeGreaterThanOrEqual(0);
      const pos = cursorAfter(SRC, "return a.b.right");
      const items = await req("textDocument/completion")({
        textDocument: { uri: uri("nested.js") },
        position: pos,
      });
      const labels = (items as { label: string }[]).map((i) => i.label);
      expect(labels).toContain("right");
      expect(labels).not.toContain("wrong");
    });
  });

  it("三层以上（a.b.c.）：接收者仍是整条链", async () => {
    const deepSrc = [
      `export const c = { wrong: 1 };`,
      `export const b = { c: { deep: 2 } };`,
      `export const a = { b: { c: { deep: 2 } } };`,
      ``,
      `export function useDeep() {`,
      `  return a.b.c.deep;`,
      `}`,
    ].join("\n");
    await withLspServer({ "deep.js": deepSrc }, async ({ req, uri }) => {
      const lines = deepSrc.split("\n");
      const line = lines.findIndex((l) => l.includes("return a.b.c.deep"));
      expect(line).toBeGreaterThanOrEqual(0);
      const items = await req("textDocument/completion")({
        textDocument: { uri: uri("deep.js") },
        position: {
          line,
          character: lines[line]!.indexOf("a.b.c.deep") + "a.b.c.deep".length,
        },
      });
      const labels = (items as { label: string }[]).map((i) => i.label);
      expect(labels).toContain("deep");
      expect(labels).not.toContain("wrong");
    });
  });

});


// ---------------------------------------------------------------------------
// 无契约形参的 hover 回落 design §2 的 `any`
// ---------------------------------------------------------------------------
describe("无契约形参的 hover 回落 design §2 的 `any`", () => {
/**
 * 无契约函数的**形参位置 hover 完全为空**
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



const SRC = `export function add(x, y) {
  return x + y;
}
`;


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


// ---------------------------------------------------------------------------
// 非 ASCII 接收者的成员补全
// ---------------------------------------------------------------------------
describe("非 ASCII 接收者的成员补全", () => {
/**
 * 成员补全对**非 ASCII 接收者**失效。
 *
 * 症状：接收者匹配正则只认 `\w`（ASCII）⇒ `对象.` 匹配失败 ⇒ 回落成
 * **顶层变量表**（`obj` / `对象` / `useAscii` / …），而该对象的成员
 * `alpha` / `beta` 一个都没有 ⇒ 看起来合理、实则完全答非所问。
 *
 * 期望：非 ASCII 接收者与 ASCII 接收者**同口径**——给出该对象的成员。
 */



const SRC = [
  `const obj = { alpha: 1, beta: "x" };`,
  `const 对象 = { alpha: 1, beta: "x" };`,
  ``,
  `export function useAscii() {`,
  `  return obj.alpha;`,
  `}`,
  ``,
  `export function useCjk() {`,
  `  return 对象.alpha;`,
  `}`,
].join("\n");

/** 光标位置：needle（已写出的接收者 + 成员前缀）之后。 */
function cursorAfter(src: string, needle: string): { line: number; character: number } {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i]!.indexOf(needle);
    if (c >= 0) return { line: i, character: c + needle.length };
  }
  throw new Error(`needle not found: ${needle}`);
}

async function labelsAt(
  req: (method: string) => (params: any) => any,
  uri: string,
  needle: string,
): Promise<string[]> {
  const pos = cursorAfter(SRC, needle);
  const items = await req("textDocument/completion")({
    textDocument: { uri },
    position: pos,
  });
  return (items as { label: string }[]).map((i) => i.label);
}


  it("CJK 接收者：给出该对象的成员（不是顶层变量表）", async () => {
    await withLspServer({ "cjk.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("cjk.js"), "return 对象.alpha");
      expect(labels.sort()).toEqual(["alpha", "beta"]);
    });
  });

  it("ASCII 接收者：同口径（对照组——不得被一起改坏）", async () => {
    await withLspServer({ "cjk.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("cjk.js"), "return obj.alpha");
      expect(labels.sort()).toEqual(["alpha", "beta"]);
    });
  });

  it("尾随点形态（`对象.`）：源码消毒也得认非 ASCII ⇒ 仍有成员", async () => {
    // 尾随点使 buffer 文本语法非法 ⇒ 分析走「尾点消毒」后的源码；
    // 消毒器的标识符捕获组 ASCII-only 时不会消毒 `对象.` ⇒ 整文件分析抛
    // ⇒ 绑定面为空 ⇒ 成员补全清零（782 的第二处根因）。
    const dotSrc = [
      `const 对象 = { alpha: 1, beta: "x" };`,
      ``,
      `export function useCjkDot() {`,
      `  return 对象.`,
      `}`,
    ].join("\n");
    await withLspServer({ "dot.js": dotSrc }, async ({ req, uri }) => {
      const lines = dotSrc.split("\n");
      const line = lines.findIndex((l) => l.includes("return 对象."));
      expect(line).toBeGreaterThanOrEqual(0);
      const items = await req("textDocument/completion")({
        textDocument: { uri: uri("dot.js") },
        position: { line, character: lines[line]!.indexOf("对象.") + "对象.".length },
      });
      const labels = (items as { label: string }[]).map((i) => i.label);
      expect(labels.sort()).toEqual(["alpha", "beta"]);
    });
  });

});


// ---------------------------------------------------------------------------
// 字面量 / 括号 / 字符串接收者走内建原型表
// ---------------------------------------------------------------------------
describe("字面量 / 括号 / 字符串接收者走内建原型表", () => {
/**
 * 成员补全的**接收者识别**失败时回落成顶层变量表。
 *
 * 症状：`(42).toF` / `(true).toS` / `"abc".toU` 这类**字面量 / 括号 / 字符串**
 * 接收者不被识别 ⇒ 协议层返回**顶层变量表**（`obj` / `useNum` / …）
 * ——不是「没有候选」，是**给出了完全无关的候选**；用户按 Tab 会插入
 * `obj` 之类的东西。
 *
 * 期望：识别成功 ⇒ 走内建原型表（Number / Boolean / String）；
 * 识别不出接收者 ⇒ **空列表**，绝不回落成顶层变量表。
 */



const SRC = [
  `const obj = { alpha: 1, beta: 2 };`,
  ``,
  `export function useObj() {`,
  `  return obj.a;`,
  `}`,
  ``,
  `export function useNum() {`,
  `  return (42).toF;`,
  `}`,
  ``,
  `export function useBool() {`,
  `  return (true).toS;`,
  `}`,
  ``,
  `export function useStr() {`,
  `  return "abc".toU;`,
  `}`,
].join("\n");

/** 顶层变量表里的名字——出现即说明回落错了分支。 */
const TOP_LEVEL = ["obj", "useObj", "useNum", "useBool", "useStr"];

/** 光标位置：needle（已写出的接收者 + 成员前缀）之后。 */
function cursorAfter(src: string, needle: string): { line: number; character: number } {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i]!.indexOf(needle);
    if (c >= 0) return { line: i, character: c + needle.length };
  }
  throw new Error(`needle not found: ${needle}`);
}

async function labelsAt(
  req: (method: string) => (params: any) => any,
  uri: string,
  needle: string,
): Promise<string[]> {
  const pos = cursorAfter(SRC, needle);
  const items = await req("textDocument/completion")({
    textDocument: { uri },
    position: pos,
  });
  return (items as { label: string }[]).map((i) => i.label);
}


  it("数字字面量接收者 ⇒ Number 的成员，且不含顶层变量", async () => {
    await withLspServer({ "lit.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("lit.js"), "return (42).toF");
      expect(labels).toContain("toFixed");
      expect(labels).toContain("toPrecision");
      for (const name of TOP_LEVEL) expect(labels).not.toContain(name);
    });
  });

  it("布尔字面量接收者 ⇒ Boolean 的成员，且不含顶层变量", async () => {
    await withLspServer({ "lit.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("lit.js"), "return (true).toS");
      expect(labels).toContain("toString");
      expect(labels).toContain("valueOf");
      for (const name of TOP_LEVEL) expect(labels).not.toContain(name);
    });
  });

  it("字符串字面量接收者 ⇒ String 的成员，且不含顶层变量", async () => {
    await withLspServer({ "lit.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("lit.js"), 'return "abc".toU');
      expect(labels).toContain("toUpperCase");
      for (const name of TOP_LEVEL) expect(labels).not.toContain(name);
    });
  });

  it("对象接收者不受影响（对照组）", async () => {
    await withLspServer({ "lit.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("lit.js"), "return obj.a");
      expect(labels.sort()).toEqual(["alpha", "beta"]);
    });
  });

});


// ---------------------------------------------------------------------------
// prim 接收者按类型分派到内建原型表
// ---------------------------------------------------------------------------
describe("prim 接收者按类型分派到内建原型表", () => {
/**
 * 成员补全的 **prim 分支只投影 `String`**。
 *
 * 症状：同一份文件、同一个补全面，只有 string 接收者有候选；
 * `num.`（number）与 `flag.`（boolean）**零候选**——而求值器的内建原型
 * 近似表里 `Number` / `Boolean` 的成员表**齐备**（引擎知道这些方法存在，
 * 补全面却给不出）。
 *
 * 期望：prim 按类型分派到对应的内建原型表
 * （number → Number / boolean → Boolean / bigint → BigInt / symbol → Symbol）。
 */



const SRC = [
  `const num = 42;`,
  `const flag = true;`,
  `const s = "abc";`,
  ``,
  `export function useNumVar() {`,
  `  return num.toF;`,
  `}`,
  ``,
  `export function useBoolVar() {`,
  `  return flag.toS;`,
  `}`,
  ``,
  `export function useStrVar() {`,
  `  return s.toU;`,
  `}`,
].join("\n");

/** 光标位置：needle（已写出的接收者 + 成员前缀）之后。 */
function cursorAfter(src: string, needle: string): { line: number; character: number } {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i]!.indexOf(needle);
    if (c >= 0) return { line: i, character: c + needle.length };
  }
  throw new Error(`needle not found: ${needle}`);
}

async function labelsAt(
  req: (method: string) => (params: any) => any,
  uri: string,
  needle: string,
): Promise<string[]> {
  const pos = cursorAfter(SRC, needle);
  const items = await req("textDocument/completion")({
    textDocument: { uri },
    position: pos,
  });
  return (items as { label: string }[]).map((i) => i.label);
}


  it("number 接收者 ⇒ Number 的成员（不再是零候选）", async () => {
    await withLspServer({ "prim.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("prim.js"), "return num.toF");
      expect(labels.sort()).toEqual(["toFixed", "toPrecision", "toString", "valueOf"]);
    });
  });

  it("boolean 接收者 ⇒ Boolean 的成员（不再是零候选）", async () => {
    await withLspServer({ "prim.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("prim.js"), "return flag.toS");
      expect(labels.sort()).toEqual(["toString", "valueOf"]);
    });
  });

  it("string 接收者不受影响（对照组——String + length）", async () => {
    await withLspServer({ "prim.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("prim.js"), "return s.toU");
      expect(labels).toContain("toUpperCase");
      expect(labels).toContain("length");
    });
  });

});


// ---------------------------------------------------------------------------
// 成员补全的接收者绑定表下沉函数体
// ---------------------------------------------------------------------------
describe("成员补全的接收者绑定表下沉函数体", () => {
/**
 * 成员补全的**接收者绑定表不下沉函数体** ⇒ 函数局部 / 形参接收者
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
