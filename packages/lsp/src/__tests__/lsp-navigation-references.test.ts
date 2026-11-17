/**
 * 模块套件：lsp-navigation-references（LSP 分片；1 文件 = 1 worker）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@nudojs/parser";
import { collectMethodReferences, collectBindingReferences, buildRenameEdits } from "../symbols.ts";
import { createNudoServer } from "../server.ts";
import { createMockConnection, withLspServer } from "./helpers.ts";
import { startLspWithFiles, locationsOf, editsOf, type LspHarness } from "./lsp-harness-navigation.ts";


// ---------------------------------------------------------------------------
// rename 导出绑定不得毁掉声明（编辑范围 / 重叠）
// ---------------------------------------------------------------------------
describe("rename 导出绑定不得毁掉声明（编辑范围 / 重叠）", () => {
/**
 * 回归钉：LSP `textDocument/rename` 改一个**导出绑定**时，不得把
 * 声明本身毁掉。
 *
 * 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）：
 * rename `total` → `renamed`，返回两条编辑
 * [0:13-0:18] -> "renamed" （标识符）
 * [0:0-0:24] -> "renamed" （**整条 `export const total = 42;` 声明**）
 * ⇒ 两条 range 重叠（LSP 规定同一份 edit 列表里 range 不得重叠），
 * 且第二条会把整条声明替换成一个标识符 ⇒ 文件被改坏。
 *
 * 根因：babel 把 `ExportNamedDeclaration` **语句节点**放进导出绑定的
 * `referencePaths`（实测：`export const total = 42;` 的 binding.referencePaths
 * = [ExportNamedDeclaration@1:0-1:24]），`collectBindingReferences` 把它当
 * 引用收进来 ⇒ 变成一个「宽于单个标识符」的编辑目标。
 *
 * 修法：
 * 1) `collectBindingReferences` 的 referencePaths **只收 Identifier 节点**；
 * 2) `buildRenameEdits` 兜底：编辑范围宽于一个标识符 ⇒ 挡掉；编辑区间
 * 互相重叠 ⇒ 只留窄的一条。不得把协议非法的 edit 列表发给客户端。
 */





const DEF_SRC = `export const total = 42;\n`;


  it("collectBindingReferences：导出绑定的 referencePaths 只收标识符（语句节点不进）；buildRenameEdits：宽于单个标识符的编辑被挡掉（语句级目标）；buildRenameEdits：重叠的编辑只留窄的一条（协议合法性兜底）；协议面：rename 导出绑定只产出标识符编辑，且无重叠", async () => {
  {
    const ast = parse(DEF_SRC);
    const refs = collectBindingReferences(ast, "total", { line: 1, column: 14 }, "file:///t/d.js");
    // 声明位保留；语句级节点（ExportNamedDeclaration）不得出现
    expect(refs.length).toBe(1);
    expect(refs[0]!.loc.start.line).toBe(1);
    expect(refs[0]!.loc.start.column).toBe(13);
    expect(refs[0]!.loc.end.column).toBe(18);
  }
  {
    const edits = buildRenameEdits("renamed", [
      // 标识符（合法）
      { uri: "file:///t/d.js", loc: { start: { line: 1, column: 13 }, end: { line: 1, column: 18 } } },
      // 整条 export 声明（非法：宽于标识符）
      { uri: "file:///t/d.js", loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 24 } } },
    ]);
    expect(edits["file:///t/d.js"]!.length).toBe(1);
    expect(edits["file:///t/d.js"]![0]!.newText).toBe("renamed");
    expect(edits["file:///t/d.js"]![0]!.range).toEqual({
      start: { line: 0, character: 13 },
      end: { line: 0, character: 18 },
    });
  }
  {
    const edits = buildRenameEdits("renamed", [
      { uri: "file:///t/d.js", loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 24 } } },
      { uri: "file:///t/d.js", loc: { start: { line: 1, column: 13 }, end: { line: 1, column: 18 } } },
    ]);
    expect(edits["file:///t/d.js"]!.length).toBe(1);
    expect(edits["file:///t/d.js"]![0]!.range.start.character).toBe(13);
  }
  {
    await withLspServer(
      { "def.js": DEF_SRC, "use.js": `import { total } from "./def.js";\n\nexport function read() {\n  return total;\n}\n` },
      async ({ req, uri }) => {
        const res = req("textDocument/rename")({
          textDocument: { uri: uri("def.js") },
          position: { line: 0, character: 13 },
          newName: "renamed",
        });
        const edits = (res as any)?.changes?.[uri("def.js")] as any[] | undefined;
        expect(edits, "rename 必须有编辑").toBeDefined();
        // 只有标识符一处：声明不得被整段替换
        expect(edits!.length).toBe(1);
        expect(edits![0]!.range).toEqual({
          start: { line: 0, character: 13 },
          end: { line: 0, character: 18 },
        });
        expect(edits![0]!.newText).toBe("renamed");
        // 负控制：不得出现宽于标识符 / 与上面重叠的编辑
        for (const e of edits!) {
          const width =
            e.range.start.line === e.range.end.line
              ? e.range.end.character - e.range.start.character
              : Number.MAX_SAFE_INTEGER;
          expect(width).toBe(5);
        }
      },
      "nudo-lsp-699-",
    );
  }
});




});


// ---------------------------------------------------------------------------
// 简写属性改名必须保留 key（`{ x }` → `{ x: y }`）
// ---------------------------------------------------------------------------
describe("简写属性改名必须保留 key（`{ x }` → `{ x: y }`）", () => {
/**
 * 回归钉：rename 遇到**对象字面量简写属性**（`{ x }`）时，编辑文本
 * 必须是 `x: <新名>`（**保留 key、只换 value**），不得把整段替换成新名字
 * —— 否则对象的**形状被静默改掉**（`{ x }` → `{ y }`）。
 *
 * 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）：
 * rename `x` → `y`，返回
 * [1:8-1:9] -> "y" （声明）
 * [2:11-2:12] -> "y" （**简写属性** ⇒ 变成 `{ y }`，key 被改掉 ❌）
 *
 * 根因：babel 8 里简写属性的 key 与 value 是**两个节点、同一段源码**
 * （实测 `{ x }` 的 `prop.key` 与 `prop.value` 相等位置但不同节点）⇒ 把这段
 * 源码替换成新名字，key 与 value 一起变。
 *
 * 修法：引用/声明位识别出「简写属性的 value」⇒ 位置带上 `shorthandKey`
 * 元数据，`buildRenameEdits` 据此生成 `x: <新名>`。
 * 解构模式（`function f({ x })`）同理：key 是被解构出来的属性名，必须保留。
 */





const SHORT_SRC = `export function mk() {
  const x = 1;
  return { x };
}
`;


  it("collectBindingReferences：简写属性的引用位带上 key 元数据；buildRenameEdits：简写属性的编辑文本是 `x: <新名>`；解构模式的简写属性同样保留 key（`function f({ x })` → `{ x: y }`）；协议面：rename 简写属性产出 `x: y`，key 不被改掉", async () => {
  {
    const ast = parse(SHORT_SRC);
    const refs = collectBindingReferences(ast, "x", { line: 2, column: 9 }, "file:///t/s.js");
    const shorthand = refs.find((r) => r.loc.start.line === 3);
    expect(shorthand, "简写属性的引用位必须在").toBeDefined();
    expect((shorthand!.loc as any).shorthandKey).toBe("x");
  }
  {
    const ast = parse(SHORT_SRC);
    const refs = collectBindingReferences(ast, "x", { line: 2, column: 9 }, "file:///t/s.js");
    const edits = buildRenameEdits("y", refs.map((r) => ({ uri: "file:///t/s.js", loc: r.loc })));
    const list = edits["file:///t/s.js"]!;
    expect(list.length).toBe(2);
    // 声明位：普通改名
    expect(list[0]!.newText).toBe("y");
    // 简写属性位：保留 key
    expect(list[1]!.newText).toBe("x: y");
    expect(list[1]!.range).toEqual({
      start: { line: 2, character: 11 },
      end: { line: 2, character: 12 },
    });
  }
  {
    const ast = parse(`export function f({ x }) {\n  return x;\n}\n`);
    const refs = collectBindingReferences(ast, "x", { line: 1, column: 20 }, "file:///t/p.js");
    const decl = refs.find((r) => r.loc.start.line === 1);
    expect(decl).toBeDefined();
    expect((decl!.loc as any).shorthandKey).toBe("x");
    const edits = buildRenameEdits("y", refs.map((r) => ({ uri: "file:///t/p.js", loc: r.loc })));
    expect(edits["file:///t/p.js"]![0]!.newText).toBe("x: y");
  }
  {
    await withLspServer({ "short.js": SHORT_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("short.js") },
        position: { line: 1, character: 8 },
        newName: "y",
      });
      const edits = (res as any)?.changes?.[uri("short.js")] as any[] | undefined;
      expect(edits, "rename 必须有编辑").toBeDefined();
      expect(edits!.length).toBe(2);
      expect(edits![0]!.newText).toBe("y");
      expect(edits![0]!.range).toEqual({
        start: { line: 1, character: 8 },
        end: { line: 1, character: 9 },
      });
      // 简写属性：编辑文本保留 key
      expect(edits![1]!.newText).toBe("x: y");
      expect(edits![1]!.range).toEqual({
        start: { line: 2, character: 11 },
        end: { line: 2, character: 12 },
      });
    });
  }
});




});


// ---------------------------------------------------------------------------
// 命名空间 import 的引用面
// ---------------------------------------------------------------------------
describe("命名空间 import 的引用面", () => {
/**
 * 命名空间 import 的**裸** `ns` 出现处被当成具名导出的引用。
 *
 * 症状：`import * as ns from "./def.js"` 之后，def.js 里**从未被提及**的
 * 导出 alpha 的 references 里出现了 ns-user.js 的 `ns` 出现处（假引用）；
 * 真正用到的 `ns.beta` 反而不是 beta 的引用。
 */



let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const DEF = `export function alpha(n) {
  return n + 1;
}
export function beta(n) {
  return n * 2;
}
`;
const USER = `import * as ns from "./ns-def.js";

export function go() {
  return ns.beta(1);
}
`;


  it("未被命名空间引用的导出，其 references 不含命名空间导入方；命名空间成员访问 `ns.beta` 是 beta 的引用位点", async () => {
  {
    h = await startLspWithFiles({ "ns-def.js": DEF, "ns-user.js": USER });
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("ns-def.js") },
        position: { line: 0, character: 16 }, // alpha
        context: { includeDeclaration: true },
      }),
    );
    expect(refs.filter((r) => r.file === "ns-user.js")).toEqual([]);
  }
  {
    h = await startLspWithFiles({ "ns-def.js": DEF, "ns-user.js": USER });
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("ns-def.js") },
        position: { line: 3, character: 16 }, // beta
        context: { includeDeclaration: true },
      }),
    );
    // 成员属性 beta（不是裸 ns）
    expect(refs).toContainEqual({
      file: "ns-user.js",
      line: 3,
      character: 12,
      endLine: 3,
      endCharacter: 16,
    });
    // 裸 ns 不是引用
    expect(refs).not.toContainEqual({
      file: "ns-user.js",
      line: 0,
      character: 12,
      endLine: 0,
      endCharacter: 14,
    });
  }
});


});


// ---------------------------------------------------------------------------
// 类方法的 references / definition 不再返回空
// ---------------------------------------------------------------------------
describe("类方法的 references / definition 不再返回空", () => {
/**
 * LSP references / definition 对**类方法**返回空（IDE 显示「无引用 / 无定义」）。
 *
 * 改前：类方法键不是绑定标识符（`isBindingIdentifier` 对 ClassMethod 键返回 false）
 * ⇒ 绑定面（`collectBindingReferences`）找不到绑定目标直接返回空；
 * 已经写好的方法面（`collectMethodReferences`）**没有**被 references /
 * definition 通道接入 ⇒ 两个请求都答「没有」。
 * 改后：references / definition 通道**改走方法面**（方法键 + 同源成员访问）。
 *
 * 原生 oracle：真 LSP server 驱动 `textDocument/references` 与 `textDocument/definition`
 * ⇒ Location 数组 / 跳转目标。
 */









type Loc = {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

const SRC = `export class K {
  m(p) { return p; }
}
export const k = new K();
export const r = k.m(1);
`;

/** 0-based 行列 */
function posOf(src: string, needle: string, occurrence = 0): { line: number; character: number } {
  const lines = src.split("\n");
  let seen = 0;
  for (let line = 0; line < lines.length; line++) {
    let from = 0;
    for (;;) {
      const idx = lines[line]!.indexOf(needle, from);
      if (idx < 0) break;
      if (seen === occurrence) return { line, character: idx };
      seen++;
      from = idx + 1;
    }
  }
  throw new Error(`needle not found: ${needle}`);
}

async function withServer<T>(
  src: string,
  fn: (mock: ReturnType<typeof createMockConnection>, uri: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b705-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src, "utf-8");
  try {
    const uri = `file://${file}`;
    const mock = createMockConnection();
    createNudoServer(mock as unknown as never);
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: { uri, languageId: "javascript", version: 1, text: src },
    });
    await new Promise((r) => setTimeout(r, 200));
    return await fn(mock, uri);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const KEY_POS = posOf(SRC, "m(p)");
// `k.m(1)` 里的 `m`（不是 `k`）
const USE_POS = { line: posOf(SRC, "k.m").line, character: posOf(SRC, "k.m").character + 2 };


  it("纯函数面：方法面能收齐类方法键 + 同源成员访问；协议面（真 server）：references @ 类方法键 ⇒ 至少 1 条引用（k.m(1)）；协议面（真 server）：definition @ k.m(1) ⇒ 跳到类里的方法键；协议面（真 server）：references 的 includeDeclaration=false 只剩使用位；负控制：普通变量的 references 通道不受影响", async () => {
  {
    const hits = collectMethodReferences(parse(SRC), "m");
    expect(hits.some((h) => h.kind === "key")).toBe(true);
    expect(hits.some((h) => h.kind === "member")).toBe(true);
    // 归属：类 K
    expect(hits.every((h) => h.owner?.name === "K")).toBe(true);
  }
  {
    const refs = await withServer(SRC, async (mock, uri) => {
      const handler = mock.requests.get("textDocument/references");
      expect(handler, "references handler not registered").toBeTruthy();
      const res = handler!({
        textDocument: { uri },
        position: KEY_POS,
        context: { includeDeclaration: true },
      });
      return (res ?? []) as Loc[];
    });
    const lines = refs.map((r) => r.range.start.line).sort((a, b) => a - b);
    // 改前：[] （一条都没有）
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(lines).toContain(KEY_POS.line); // 定义位（类方法键）
    expect(lines).toContain(USE_POS.line); // 使用位（k.m(1)）
    // 使用位落在 `m` 本身（不是整条表达式）
    const use = refs.find((r) => r.range.start.line === USE_POS.line)!;
    expect(use.range.start.character).toBe(USE_POS.character);
    expect(use.range.end.character).toBe(USE_POS.character + 1);
  }
  {
    const defs = await withServer(SRC, async (mock, uri) => {
      const handler = mock.requests.get("textDocument/definition");
      expect(handler, "definition handler not registered").toBeTruthy();
      const res = handler!({ textDocument: { uri }, position: USE_POS });
      return (res ?? []) as Loc[];
    });
    // 改前：[] （跳不过去）
    expect(defs.length).toBeGreaterThanOrEqual(1);
    const def = defs[0]!;
    expect(def.range.start.line).toBe(KEY_POS.line);
    expect(def.range.start.character).toBe(KEY_POS.character);
    expect(def.range.end.character).toBe(KEY_POS.character + 1);
  }
  {
    const refs = await withServer(SRC, async (mock, uri) => {
      const handler = mock.requests.get("textDocument/references")!;
      const res = handler!({
        textDocument: { uri },
        position: KEY_POS,
        context: { includeDeclaration: false },
      });
      return (res ?? []) as Loc[];
    });
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs.map((r) => r.range.start.line)).toContain(USE_POS.line);
    expect(refs.map((r) => r.range.start.line)).not.toContain(KEY_POS.line);
  }
  {
    const src = `export const v = 1;
export function use() { return v; }
`;
    const refs = await withServer(src, async (mock, uri) => {
      const handler = mock.requests.get("textDocument/references")!;
      const res = handler!({
        textDocument: { uri },
        position: posOf(src, "v ="),
        context: { includeDeclaration: true },
      });
      return (res ?? []) as Loc[];
    });
    expect(refs.length).toBeGreaterThanOrEqual(2);
  }
});





});


// ---------------------------------------------------------------------------
// definition 对方法形参 / catch 形参不再返回 null
// ---------------------------------------------------------------------------
describe("definition 对方法形参 / catch 形参不再返回 null", () => {
/**
 * LSP `definition` 对**类方法形参** / **对象方法形参** / **`catch` 形参**
 * 返回 `null`，而**同一位置**的 `references` 却**返回声明位点**
 * ⇒ 同一个 LSP、同一个坐标，两个面自相矛盾。
 *
 * 根因：`buildSymbolTable` 的访问器清单只覆盖 `FunctionDeclaration` /
 * `FunctionExpression` / `ArrowFunctionExpression` 三种函数的 `params`
 * ⇒ 类方法 / 对象方法 / `catch` 的形参**不进 `definitions`** ⇒
 * `findDefinition` 落空 ⇒ definition 返回 `null`；
 * 而 `references` 走 babel binding 面（`collectBindingReferences`）
 * ⇒ 不受符号表影响 ⇒ 照常返回声明位 ⇒ **两个面自相矛盾**。
 *
 * 改后：补 `ClassMethod` / `ObjectMethod` / `ClassPrivateMethod` /
 * `ClassPrivateProperty` / `CatchClause` 五个访问器，各自
 * `registerParam(..., scopeRangeOf(path.scope))`
 * ⇒ 形参进 `definitions` ⇒ definition 命中声明位。
 * ⚠ `catch` 形参的作用域是 **CatchClause 自身作用域**（不是外层）。
 *
 * 原生 oracle：真 LSP server 的 `textDocument/definition` / `textDocument/references`。
 */



type Loc = {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

const SRC = `export class K {
  method(cp) {
    return cp + 1;
  }
}

const obj = {
  om(op) {
    return op + 1;
  },
};

try {
  throw new Error("x");
} catch (ep) {
  console.log(ep);
}

export function plain(fp) {
  return fp + 1;
}
`;

/** 0-based 行列（needle 的第 occurrence 次出现） */
function posOf(src: string, needle: string, occurrence = 0): { line: number; character: number } {  const lines = src.split("\n");
  let seen = 0;
  for (let line = 0; line < lines.length; line++) {
    let from = 0;
    for (;;) {
      const idx = lines[line]!.indexOf(needle, from);
      if (idx < 0) break;
      if (seen === occurrence) return { line, character: idx };
      seen++;
      from = idx + 1;
    }
  }
  throw new Error(`needle not found: ${needle}`);
}

/** 形参位（声明位） */
const CLASS_PARAM = posOf(SRC, "cp)");
const OBJECT_PARAM = posOf(SRC, "op)");
const CATCH_PARAM = { line: posOf(SRC, "(ep)").line, character: posOf(SRC, "(ep)").character + 1 };
/** 普通函数形参（对照组：改前就是好的） */
const PLAIN_PARAM = posOf(SRC, "fp)");

async function definitionAt(pos: { line: number; character: number }): Promise<Loc[]> {
  let out: Loc[] = [];
  await withLspServer({ "src.js": SRC }, async (ctx) => {
    const handler = ctx.req("textDocument/definition");
    const res = await handler({
      textDocument: { uri: ctx.uri("src.js") },
      position: pos,
    });
    out = (res ?? []) as Loc[];
  });
  return out;
}

async function referencesAt(pos: { line: number; character: number }): Promise<Loc[]> {
  let out: Loc[] = [];
  await withLspServer({ "src.js": SRC }, async (ctx) => {
    const handler = ctx.req("textDocument/references");
    const res = await handler({
      textDocument: { uri: ctx.uri("src.js") },
      position: pos,
      context: { includeDeclaration: true },
    });
    out = (res ?? []) as Loc[];
  });
  return out;
}


  it("类方法形参：definition ⇒ 形参声明位（改前是 null）；对象方法形参：definition ⇒ 形参声明位（改前是 null）；catch 形参：definition ⇒ 形参声明位（改前是 null）；同一坐标：definition 与 references 的声明位**一致**（不再自相矛盾）；负控制：普通函数形参的 definition 不受影响", async () => {
  {
    const defs = await definitionAt(CLASS_PARAM);
    expect(defs.length).toBeGreaterThanOrEqual(1);
    const def = defs[0]!;
    expect(def.range.start.line).toBe(CLASS_PARAM.line);
    expect(def.range.start.character).toBe(CLASS_PARAM.character);
    expect(def.range.end.character).toBe(CLASS_PARAM.character + "cp".length);
  }
  {
    const defs = await definitionAt(OBJECT_PARAM);
    expect(defs.length).toBeGreaterThanOrEqual(1);
    const def = defs[0]!;
    expect(def.range.start.line).toBe(OBJECT_PARAM.line);
    expect(def.range.start.character).toBe(OBJECT_PARAM.character);
    expect(def.range.end.character).toBe(OBJECT_PARAM.character + "op".length);
  }
  {
    const defs = await definitionAt(CATCH_PARAM);
    expect(defs.length).toBeGreaterThanOrEqual(1);
    const def = defs[0]!;
    expect(def.range.start.line).toBe(CATCH_PARAM.line);
    expect(def.range.start.character).toBe(CATCH_PARAM.character);
    expect(def.range.end.character).toBe(CATCH_PARAM.character + "ep".length);
  }
  {
    for (const pos of [CLASS_PARAM, OBJECT_PARAM, CATCH_PARAM, PLAIN_PARAM]) {
      const defs = await definitionAt(pos);
      const refs = await referencesAt(pos);
      expect(defs.length, `definition @${pos.line}:${pos.character}`).toBeGreaterThanOrEqual(1);
      const decl = refs.find((r) => r.range.start.line === pos.line)!;
      expect(decl, `references @${pos.line}:${pos.character} 缺声明位`).toBeTruthy();
      expect(defs[0]!.range).toEqual(decl.range);
    }
  }
  {
    const defs = await definitionAt(PLAIN_PARAM);
    expect(defs.length).toBeGreaterThanOrEqual(1);
    expect(defs[0]!.range.start.line).toBe(PLAIN_PARAM.line);
    expect(defs[0]!.range.start.character).toBe(PLAIN_PARAM.character);
  }
});





});


// ---------------------------------------------------------------------------
// [merged] navigation-gate-consistency
// ---------------------------------------------------------------------------
describe("navigation-gate-consistency", () => {
// MERGED (topic-related bug pins): navigation-gate-consistency + sidecar-gate-family + sidecar-gate-parity
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>



{
/**
 * 侧车契约文件（`*.nudo.js`）在导航面上的**门禁各写各的**：
 * `definition` 单独挂了 `isSidecarPath` **逃生口**（放行侧车），
 * `workspace/symbol` 干脆**没有门禁**（反而放行侧车），其余四个请求一律
 * `isNudoFile` 一刀切 ⇒ **同一坐标六种请求三种结论**：definition 说
 * 「这个符号存在」，documentSymbol 说「这个文件里没有任何符号」
 * ⇒ **LSP 内部自相矛盾**。
 *
 * 修法（**最小一致修法**，全部落在 `server-navigation.ts`）：
 * ① 去掉 `definition` 的 `|| isSidecarPath(...)` 逃生口 ⇒ 侧车在所有导航
 * 请求上一律为 null；② 给 `workspace/symbol` **补上同一个门禁**
 * （路径层 `isNudoTargetPath`——`isNudoFile` 的第一层，同样排除侧车）。
 *
 * ⚠ **代价（已裁决：接受）**：丢掉「源码 → 侧车」的 definition 可导航能力。
 * ⚠ `workspace/symbol` 扫的是**文件路径集合**（可能**未打开**）⇒ 不能用
 * `isNudoFile`（它要求文档已打开 ⇒ 会把未打开的文件整片误杀）⇒ 只用
 * **路径层**。
 *
 * ⚠ **共担**：族级不变量钉见 `sidecar-gate-family`
 * （片 C 落，本钉与它同口径）。
 */



const LIB = `export function getName(user) {
  return user.name;
}
`;

/** 侧车契约文件：引擎消费的契约形态（fn({ … }, …) 导出绑定）。 */
const LIB_SIDECAR = `import { fn, shape, string } from "@nudojs/core";

export const getName = fn({ u: shape({ name: string() }) }, string());
`;

/** 侧车里 `getName` 的位置（行 2，列 13）。 */
const SIDECAR_POS = { line: 2, character: 13 };

const isEmptyResult = (v: unknown): boolean =>
  v === null || v === undefined || (Array.isArray(v) && v.length === 0);

describe("导航面门禁一致：侧车在六个请求上不可见", () => {
  it("同一坐标（侧车里的 getName）⇒ 六个导航请求结论一致（都不可见）；负控制：源码侧仍可见（门禁不得过度拦截）", async () => {
  {
    await withLspServer(
      { "lib.js": LIB, "lib.nudo.js": LIB_SIDECAR },
      async ({ req, uri }) => {
        const sidecar = uri("lib.nudo.js");
        const at = { textDocument: { uri: sidecar }, position: SIDECAR_POS };

        expect(
          isEmptyResult(req("textDocument/definition")(at)),
          "definition 仍放行侧车（`|| isSidecarPath(...)` 逃生口未去掉）",
        ).toBe(true);
        expect(
          isEmptyResult(req("textDocument/references")({ ...at, context: { includeDeclaration: true } })),
          "references 仍放行侧车",
        ).toBe(true);
        expect(isEmptyResult(req("textDocument/rename")({ ...at, newName: "renamed" })), "rename 仍放行侧车").toBe(
          true,
        );
        expect(isEmptyResult(req("textDocument/prepareRename")(at)), "prepareRename 仍放行侧车").toBe(true);
        expect(isEmptyResult(req("textDocument/documentSymbol")({ textDocument: { uri: sidecar } })), "documentSymbol 仍放行侧车").toBe(
          true,
        );

        const symbols = req("workspace/symbol")({ query: "getName" }) as Array<{
          name: string;
          location?: { uri?: string };
        }>;
        const sidecarEntries = (symbols ?? []).filter((s) =>
          String(s.location?.uri ?? "").endsWith("lib.nudo.js"),
        );
        expect(sidecarEntries, "workspace/symbol 仍放行侧车条目（无门禁）").toEqual([]);
      },
    );
  }
  {
    await withLspServer(
      { "lib.js": LIB, "lib.nudo.js": LIB_SIDECAR },
      async ({ req, uri }) => {
        const src = uri("lib.js");
        const syms = req("textDocument/documentSymbol")({ textDocument: { uri: src } }) as Array<{
          name: string;
        }>;
        expect(syms.map((s) => s.name)).toContain("getName");

        const ws = req("workspace/symbol")({ query: "getName" }) as Array<{
          name: string;
          location?: { uri?: string };
        }>;
        expect(
          (ws ?? []).some((s) => String(s.location?.uri ?? "").endsWith("lib.js")),
          "workspace/symbol 把源码条目也误杀了",
        ).toBe(true);
      },
    );
  }
});

});
}

describe("sidecar-gate-family", () => {
/**
 * （**共担钉**）—— 族级不变量：侧车契约文件（`*.nudo.js`）在**全部**
 * 导航请求上不可见。
 *
 * ⚠ **共担**：本钉的两条断言落在 `server-navigation.ts` 的两个调用点
 * （`definition` 的 `|| isSidecarPath(...)` 逃生口、`workspace/symbol` 的
 * **无门禁**）⇒ **片 B** 落。⇒ 本钉在 HEAD（未修）上**红**（反向闸证据），
 * 片 B 落地后**转绿**。片 C 的那一半（统一门禁谓词真源 + IDE 侧一致性）
 * 见 `sidecar-gate-parity`。
 *
 * 症状（HEAD）：同一坐标（侧车里的 `getName`）六种请求三种结论——
 * definition **有**、references/rename/prepareRename/documentSymbol 全空、
 * workspace/symbol **反而列出**侧车条目 ⇒ LSP 内部自相矛盾。
 */



const LIB = `export function getName(user) {
  return user.name;
}
`;

/** 侧车契约文件：引擎消费的契约形态（fn({ … }, …) 导出绑定）。 */
const LIB_SIDECAR = `import { fn, shape, string } from "@nudojs/core";

export const getName = fn({ u: shape({ name: string() }) }, string());
`;

/** 侧车里 `getName` 的位置（行 2，列 13）。 */
const SIDECAR_POS = { line: 2, character: 13 };

describe("（族级不变量）— 侧车在全部导航请求上不可见", () => {
  it("definition 不得放行侧车（逃生口已去掉）；workspace/symbol 不得放行侧车条目（门禁已补）", async () => {
  {
    await withLspServer(
      { "lib.js": LIB, "lib.nudo.js": LIB_SIDECAR },
      async ({ req, uri }) => {
        const sidecar = uri("lib.nudo.js");
        const res = req("textDocument/definition")({
          textDocument: { uri: sidecar },
          position: SIDECAR_POS,
        });
        const empty =
          res === null ||
          res === undefined ||
          (Array.isArray(res) && res.length === 0);
        expect(empty, "definition 仍放行侧车（`|| isSidecarPath(...)` 逃生口未去掉）").toBe(true);
      },
    );
  }
  {
    await withLspServer(
      { "lib.js": LIB, "lib.nudo.js": LIB_SIDECAR },
      async ({ req, uri }) => {
        const symbols = req("workspace/symbol")({ query: "getName" }) as Array<{
          name: string;
          location?: { uri?: string };
        }>;
        const sidecarEntries = (symbols ?? []).filter((s) =>
          String(s.location?.uri ?? "").endsWith("lib.nudo.js"),
        );
        expect(sidecarEntries, "workspace/symbol 仍放行侧车条目（无门禁）").toEqual([]);
        // 负控制：源码条目仍在（不得整片误杀）
        expect(
          (symbols ?? []).some((s) => String(s.location?.uri ?? "").endsWith("lib.js")),
          "workspace/symbol 把源码条目也误杀了",
        ).toBe(true);
      },
    );
  }
});

});
});

describe("sidecar-gate-parity", () => {
/**
 * 侧车契约文件（`*.nudo.js`）在导航请求族里的**门禁各写各的**：
 * `definition` 单独挂了 `isSidecarPath` 逃生口（放行侧车），`workspace/symbol`
 * 干脆**没有门禁**（反而放行侧车），其余四个导航请求与 6 个 IDE 请求一律
 * `isNudoFile` 一刀切 ⇒ **同一坐标六种请求三种结论**：definition 说「这个符号
 * 存在」，documentSymbol 说「这个文件里没有任何符号」。
 *
 * 根因：门禁谓词**没有单一事实源**——`server-navigation.ts` 的 5 个请求各写
 * 一份、`server-ide.ts` 的 6 个请求各写一份、`workspace/symbol` 干脆不写。
 *
 * 真源 = `server.ts` 的 `isNudoFile`（底层 `isNudoTargetPath`，**明确排除**
 * `*.nudo.js` / `*.nudo.mjs` / `*.nudo.ts` / `*.nudo.draft.*`）⇒ 导航面与
 * IDE 面共用**同一个谓词实例** ⇒ 两侧口径必然一致。
 *
 * 本钉钉住**已统一的那一半**（统一门禁谓词真源 + IDE 侧一致性）：
 * 侧车契约文件在 IDE 面与「走统一门禁的四个导航请求」上完全不可见。
 *
 * ⚠ 导航面剩下的两处调用点（`definition` 的逃生口、`workspace/symbol` 的无
 * 门禁）在 `server-navigation.ts` ⇒ **片 B** 落 ⇒ 族级不变量钉见
 * `sidecar-gate-family`（共担钉：片 B 落地后转绿）。
 */



const LIB = `export function getName(user) {
  return user.name;
}
`;

/** 侧车契约文件：引擎消费的契约形态（fn({ … }, …) 导出绑定）。 */
const LIB_SIDECAR = `import { fn, shape, string } from "@nudojs/core";

export const getName = fn({ u: shape({ name: string() }) }, string());
`;

/** 侧车里 `getName` 的位置（行 2，列 13）。 */
const SIDECAR_POS = { line: 2, character: 13 };
/** 源码里 `getName` 的位置（行 0，列 16）。 */
const SRC_POS = { line: 0, character: 16 };

describe("统一门禁谓词：侧车在 IDE 面与统一门禁的导航请求上不可见", () => {
  it("侧车上的六个 IDE 请求结论一致（侧车不可见）；侧车上的四个统一门禁导航请求结论一致（侧车不可见）；负控制：源码侧的符号仍可见（门禁不得过度拦截）", async () => {
  {
    await withLspServer(
      { "lib.js": LIB, "lib.nudo.js": LIB_SIDECAR },
      async ({ req, uri }) => {
        const sidecar = uri("lib.nudo.js");
        const at = { textDocument: { uri: sidecar }, position: SIDECAR_POS };

        expect(req("textDocument/hover")(at)).toBeNull();
        expect(req("textDocument/completion")(at)).toEqual([]);
        expect(req("textDocument/codeLens")({ textDocument: { uri: sidecar } })).toEqual([]);
        expect(req("textDocument/inlayHint")({ textDocument: { uri: sidecar } })).toEqual([]);
        expect(req("textDocument/signatureHelp")(at)).toBeNull();
        expect(req("textDocument/semanticTokens/full")({ textDocument: { uri: sidecar } })).toEqual({
          data: [],
        });
      },
    );
  }
  {
    await withLspServer(
      { "lib.js": LIB, "lib.nudo.js": LIB_SIDECAR },
      async ({ req, uri }) => {
        const sidecar = uri("lib.nudo.js");
        const at = { textDocument: { uri: sidecar }, position: SIDECAR_POS };

        expect(
          req("textDocument/references")({ ...at, context: { includeDeclaration: true } }),
          "references 仍放行侧车",
        ).toEqual([]);
        expect(req("textDocument/rename")({ ...at, newName: "renamed" })).toBeNull();
        expect(req("textDocument/prepareRename")(at)).toBeNull();
        expect(req("textDocument/documentSymbol")({ textDocument: { uri: sidecar } })).toEqual([]);
      },
    );
  }
  {
    await withLspServer(
      { "lib.js": LIB, "lib.nudo.js": LIB_SIDECAR },
      async ({ req, uri }) => {
        const src = uri("lib.js");
        const at = { textDocument: { uri: src }, position: SRC_POS };

        const defs = req("textDocument/definition")(at) as Array<{ uri: string }>;
        expect(defs.length, "源码侧 definition 变空了（门禁过度拦截）").toBeGreaterThan(0);
        expect(defs.some((d) => String(d.uri).endsWith("lib.js"))).toBe(true);

        const syms = req("textDocument/documentSymbol")({ textDocument: { uri: src } }) as Array<{
          name: string;
        }>;
        expect(syms.map((s) => s.name)).toContain("getName");
      },
    );
  }
});


});
});
});


// ---------------------------------------------------------------------------
// rename 作用域冲突 ⇒ 拒绝改名（拒绝优于改坏）
// ---------------------------------------------------------------------------
describe("rename 作用域冲突 ⇒ 拒绝改名（拒绝优于改坏）", () => {
/**
 * rename 作用域冲突检测（自认的「独立后续项」，此处落地）。
 *
 * 只做了新名的**语法层**校验（合法标识符 / 非保留字 / 非空）⇒ 合法的
 * 新名仍可与既有绑定撞车 ⇒ 一次改名就把源码改坏：
 * - 同作用域重复声明（`const a` + 改 `f`→`a`）⇒ `SyntaxError`；
 * - 捕获（外层已有 `newName` 且在目标作用域内被引用 / 目标引用落在声明了
 * `newName` 的内层作用域里）⇒ 引用静默指向别的绑定。
 *
 * 修法（哲学与 「歧义接收者拒绝改名」同源：**拒绝优于改坏**）：
 * `renameNameConflicts`（symbols.ts）按目标身份判冲突：
 * - binding：babel 作用域链上三类冲突（重复声明 / 内层遮蔽捕获 / 外层捕获）；
 * 纯遮蔽（外层 `newName` 存在但目标作用域内零引用）**允许**；
 * - method：只查同归属内成员名冲突（方法键不是绑定，同名 key 语义不同）；
 * - private：同类体内已有 `#newName` ⇒ 重复私有名；
 * - export：模块导出名空间里已有 `newName` ⇒ 重复导出。
 * 冲突 ⇒ rename 返回 `null`（不产出任何编辑）。
 *
 * 跨文件：编辑会落到 def 所在文件（import / re-export）⇒ 冲突判定在 def 文件
 * 的作用域里再做一遍（当前文件干净、def 文件撞名 ⇒ 改完照样重复声明）。
 */



type Edit = {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
};

const editsOf = (res: unknown): Edit[] =>
  Object.values((res as { changes?: Record<string, Edit[]> } | null)?.changes ?? {}).flat();

/** 触点同模块作用域：`const a` + `function f` */
const DUP_SRC = `const a = 1;
export function f() {}
`;

/** 嵌套作用域（同层冲突）：函数体内已有 `b` ⇒ 改 `x`→`b` 是重复声明 */
const SHADOW_SAME_SRC = `export const b = 1;
export function f() {
  const x = 2;
  const b = 3;
  return x + b;
}
`;

/** 嵌套作用域（纯遮蔽，不同层级）：目标作用域内零 `b` 引用 ⇒ 允许 */
const SHADOW_OK_SRC = `export const b = 1;
export function f() {
  const x = 2;
  return x;
}
`;

/** 外层捕获：外层 `b` 在目标作用域内被引用 ⇒ 改 `x`→`b` 会截胡那条引用 */
const CAPTURE_SRC = `export const b = 1;
export function f() {
  const x = 2;
  return x + b;
}
`;

/** 内层捕获：目标 `x` 的引用落在声明了 `y` 的内层函数里 */
const INNER_CAPTURE_SRC = `export function f() {
  const x = 1;
  function g() {
    const y = 2;
    return y + x;
  }
  return g() + x;
}
`;

/** 方法臂：同归属（类 K）里已有 `stop` 成员 */
const METHOD_SRC = `export class K {
  run() {
    return 1;
  }
  stop() {
    return 2;
  }
}
export const k = new K();
export function go() {
  return k.run();
}
`;

/** 跨文件：def 文件模块作用域已有 `fresh` */
const XDEF_SRC = `export function old() {
  return 1;
}
export const fresh = 2;
`;
const XUSE_SRC = `import { old } from "./x-def.js";

export function use() {
  return old();
}
`;

/** 私有成员臂：同类里已有 `#other` */
const PRIVATE_SRC = `export class C {
  #total() {
    return 1;
  }
  #other() {
    return 2;
  }
}
`;


  it("同作用域重复声明：`const a` + 改 f→a ⇒ 拒绝（无 WorkspaceEdit）；回归：同文件改 f→bb ⇒ 正常产出编辑；嵌套作用域·同层已有 b：改 x→b ⇒ 拒绝；嵌套作用域·纯遮蔽（不同层级）：改 x→b ⇒ 允许（合法且无语义变化的 JS）；外层捕获：外层 b 在目标作用域内被引用 ⇒ 改 x→b 拒绝；内层捕获：目标 x 的引用落在声明了 y 的内层作用域 ⇒ 改 x→y 拒绝；方法臂：同归属已有同名成员 run→stop ⇒ 拒绝；run→w", async () => {
  {
    await withLspServer({ "dup.js": DUP_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("dup.js") },
        position: { line: 1, character: 16 }, // f（声明位）
        newName: "a",
      });
      expect(res, "改 f→a 会制造 `const a` + `function a` 重复声明，必须拒绝").toBeNull();
    });
  }
  {
    await withLspServer({ "dup.js": DUP_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("dup.js") },
        position: { line: 1, character: 16 },
        newName: "bb",
      });
      const edits = editsOf(res);
      expect(edits, "合法新名被误拒").toHaveLength(1);
      expect(edits[0]!.newText).toBe("bb");
    });
  }
  {
    await withLspServer({ "sh-same.js": SHADOW_SAME_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("sh-same.js") },
        position: { line: 2, character: 8 }, // const x
        newName: "b",
      });
      expect(res, "函数体同层已有 `const b`，改 x→b 是重复声明，必须拒绝").toBeNull();
    });
  }
  {
    await withLspServer({ "sh-ok.js": SHADOW_OK_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("sh-ok.js") },
        position: { line: 2, character: 8 }, // const x
        newName: "b",
      });
      const edits = editsOf(res);
      expect(edits, "纯遮蔽（目标作用域内零 b 引用）被误拒").toHaveLength(2);
      expect(edits.every((e) => e.newText === "b")).toBe(true);
    });
  }
  {
    await withLspServer({ "cap.js": CAPTURE_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("cap.js") },
        position: { line: 2, character: 8 }, // const x
        newName: "b",
      });
      expect(
        res,
        "改后 `x + b` 变 `b + b`，第二项从外层 b 被截胡成本地 x ⇒ 语义静默改变，必须拒绝",
      ).toBeNull();
    });
  }
  {
    await withLspServer({ "inner.js": INNER_CAPTURE_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("inner.js") },
        position: { line: 1, character: 8 }, // const x
        newName: "y",
      });
      expect(
        res,
        "改后 g 体内的 x 变 y、解析到 g 自己的 y（遮蔽捕获）⇒ 语义静默改变，必须拒绝",
      ).toBeNull();
    });
  }
  {
    await withLspServer({ "m.js": METHOD_SRC }, async ({ req, uri }) => {
      const conflict = req("textDocument/rename")({
        textDocument: { uri: uri("m.js") },
        position: { line: 1, character: 2 }, // run 键
        newName: "stop",
      });
      expect(conflict, "类 K 已有 stop 成员，改完 = 重复成员键，必须拒绝").toBeNull();

      const ok = req("textDocument/rename")({
        textDocument: { uri: uri("m.js") },
        position: { line: 1, character: 2 },
        newName: "walk",
      });
      const edits = editsOf(ok);
      // 定义位（run 键）+ 使用位（k.run()）
      expect(edits, "合法方法名被误拒").toHaveLength(2);
      expect(edits.every((e) => e.newText === "walk")).toBe(true);
    });
  }
  {
    await withLspServer({ "x-def.js": XDEF_SRC, "x-use.js": XUSE_SRC }, async ({ req, uri }) => {
      const conflict = req("textDocument/rename")({
        textDocument: { uri: uri("x-use.js") },
        position: { line: 3, character: 9 }, // old() 用点
        newName: "fresh",
      });
      expect(conflict, "x-def.js 已有 `export const fresh`，改完 = 重复导出，必须拒绝").toBeNull();

      const ok = req("textDocument/rename")({
        textDocument: { uri: uri("x-use.js") },
        position: { line: 3, character: 9 },
        newName: "brandNew",
      });
      const edits = editsOf(ok);
      // def 文件声明 + 本文件 imported 侧 + 用点
      expect(edits, "合法跨文件新名被误拒").toHaveLength(3);
    });
  }
  {
    await withLspServer({ "p.js": PRIVATE_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("p.js") },
        position: { line: 1, character: 3 }, // total 标识符段（不含 #）
        newName: "other",
      });
      expect(res, "类 C 已有 #other，改完 = 重复私有名（SyntaxError），必须拒绝").toBeNull();
    });
  }
  {
    await withLspServer({ "dup.js": DUP_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/prepareRename")({
        textDocument: { uri: uri("dup.js") },
        position: { line: 1, character: 16 },
      }) as { range?: unknown; placeholder?: string } | null;
      expect(res, "prepareRename 必须可答（capabilities 声明了 prepareProvider:true）").not.toBeNull();
      expect(res!.range).toEqual({
        start: { line: 1, character: 16 },
        end: { line: 1, character: 17 },
      });
      expect(res!.placeholder).toBe("f");
    });
  }
});










});
