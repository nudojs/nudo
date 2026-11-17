/**
 * 模块套件：lsp-navigation-rename-edges（LSP 分片；1 文件 = 1 worker）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { parse } from "@nudojs/parser";
import { collectMethodReferences, hasAmbiguousMethodReceiver, renameTargetAt } from "../symbols.ts";
import { createNudoServer } from "../server.ts";
import { createMockConnection, withLspServer, withTempDir, waitForDiagnostics } from "./helpers.ts";
import { pathToFileURL } from "node:url";
import { defaultLoadModule } from "@nudojs/service";
import { checkToLspDiagnostics } from "../validation.ts";
import { applyEdits, type CodeActionEdit } from "./lsp-harness-code-actions.ts";
import { startLspWithFiles, locationsOf, editsOf, type LspHarness } from "./lsp-harness-navigation.ts";


// ---------------------------------------------------------------------------
// 方法改名以「归属」为界
// ---------------------------------------------------------------------------
describe("方法改名以「归属」为界", () => {
/**
 * LSP 类方法改名**越过无关对象**的成员访问、且**漏掉对象字面量的同名 key**
 * → 改出坏代码（运行时读到 `undefined`）。
 *
 * 改前：`collectMethodReferences` 只按**名字**匹配成员访问（`property.name === name`），
 * 完全不看接收者 ⇒ 改 `a.m` 把 `b.m` 一起改掉；定义位点又只收 ClassMethod /
 * ObjectMethod 键 ⇒ 对象字面量里的同名 key 漏改 ⇒ 定义集与使用集口径不一致。
 * 改后：方法引用**以「归属」为界**——类方法归类、对象字面量方法归对象；
 * 成员访问只在**接收者归属与该方法定义同源**时计入；对象字面量的方法键
 * （`{ m() {} }` / `{ m: fn }`）也算定义位点。
 *
 * 原生 oracle：真 LSP server 驱动 `textDocument/rename` ⇒ WorkspaceEdit 逐条。
 */









type Edit = {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
};

/** 报告 r21 的夹具：类 K 的方法 m + 无关对象 other 的数据属性 m + 形参上的成员访问 */
const R21 = `export class K {
  m(p) {
    return p;
  }
}

export const other = {
  m: 1,
};

export function use(k, o) {
  k.m(1);
  o.m(2);
  return k.m(3);
}
`;

/** 对象字面量的方法：定义位（key）与使用位（成员访问）必须一起改 */
const OBJ_METHOD = `export const helper = {
  m() {
    return 2;
  },
};
export function call() {
  return helper.m();
}
`;

/** 同名但不同类：Alpha.run 与 Beta.run 不许合并 */
const TWO_CLASSES = `export class Alpha {
  run() {
    return 1;
  }
}
export class Beta {
  run() {
    return 2;
  }
}
export const a = new Alpha();
export const b = new Beta();
export function go() {
  a.run();
  b.run();
}
`;

/** 对象字面量的**函数值属性**（`{ m: fn }`）：key 也是方法定义位 */
const OBJ_PROPERTY = `export const helper = {
  m: impl,
};
export function impl() {
  return 2;
}
export function call() {
  return helper.m();
}
`;

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

/** 打开若干文件后驱动一次 rename，返回每个文件的编辑清单 */
async function renameEdits(
  files: Record<string, string>,
  target: { file: string; position: { line: number; character: number } },
  newName: string,
): Promise<Record<string, Array<{ at: string; newText: string }>>> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b712-"));
  try {
    const paths: Record<string, string> = {};
    for (const [name, src] of Object.entries(files)) {
      const p = join(dir, name);
      writeFileSync(p, src, "utf-8");
      paths[name] = p;
    }
    const mock = createMockConnection();
    createNudoServer(mock as unknown as never);
    for (const [name, src] of Object.entries(files)) {
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: {
          uri: `file://${paths[name]}`,
          languageId: "javascript",
          version: 1,
          text: src,
        },
      });
    }
    for (const name of Object.keys(files)) {
      await waitForDiagnostics(mock, `file://${paths[name]}`);
    }
    const handler = mock.requests.get("textDocument/rename");
    expect(handler, "rename handler not registered").toBeTruthy();
    const res = handler!({
      textDocument: { uri: `file://${paths[target.file]}` },
      position: target.position,
      newName,
    }) as { changes?: Record<string, Edit[]> } | null;
    const out: Record<string, Array<{ at: string; newText: string }>> = {};
    for (const [uri, edits] of Object.entries(res?.changes ?? {})) {
      const name = Object.keys(paths).find((k) => uri.endsWith(paths[k]!)) ?? uri;
      out[name] = edits.map((e) => ({
        at: `${e.range.start.line}:${e.range.start.character}-${e.range.end.line}:${e.range.end.character}`,
        newText: e.newText,
      }));
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}


  it("纯函数面：无关对象的同名成员访问不进改名集合；纯函数面：对象字面量的方法键是定义位，且同源成员访问进集合；纯函数面：同名但不同类不合并（显式归属时）；协议面（真 server）：归属歧义 ⇒ **拒绝改名**（不产出任何编辑，代码不被改坏）；纯函数面：归属歧义可被检出（歧义 ⇒ 拒绝；无歧义 ⇒ 可改）；协议面（真 server）：改对象字面量的方法 ⇒ key 与同源成员访问一起改；协议面（真 server）：对象字面量的函数值属性 `{ m: fn }` 的 key 也是", async () => {
  {
    const ast = parse(R21);
    const hits = collectMethodReferences(ast, "m", { owner: { kind: "class", name: "K" } });
    const at = (h: (typeof hits)[number]): string =>
      `${h.loc.start.line}:${h.loc.start.column}`;
    // 定义位：类 K 的方法键（1-based 行 2 / 列 2）
    expect(hits.some((h) => h.kind === "key" && at(h) === "2:2")).toBe(true);
    // 使用位：k.m(1) / k.m(3) 的接收者是**形参**（解析不出归属）⇒ 不计入
    // 无关对象 other 的数据属性 m 与 o.m(2) 同样不进集合
    expect(hits.some((h) => at(h) === "8:2")).toBe(false); // other 的 key
    expect(hits.some((h) => at(h) === "13:4")).toBe(false); // o.m(2)
  }
  {
    const hits = collectMethodReferences(parse(OBJ_METHOD), "m", {
      owner: { kind: "object", name: "helper" },
    });
    const at = (h: (typeof hits)[number]): string => `${h.loc.start.line}:${h.loc.start.column}`;
    expect(hits.some((h) => h.kind === "key" && at(h) === "2:2")).toBe(true);
    expect(hits.some((h) => h.kind === "member")).toBe(true);
  }
  {
    const hits = collectMethodReferences(parse(TWO_CLASSES), "run", {
      owner: { kind: "class", name: "Alpha" },
    });
    const at = (h: (typeof hits)[number]): string => `${h.loc.start.line}:${h.loc.start.column}`;
    expect(hits.some((h) => at(h) === "2:2")).toBe(true); // Alpha.run 键
    expect(hits.some((h) => at(h) === "6:2")).toBe(false); // Beta.run 键
  }
  {
    const edits = await renameEdits(
      { "ren-meth.js": R21 },
      { file: "ren-meth.js", position: posOf(R21, "m(p)") },
      "renamed",
    );
    const list = edits["ren-meth.js"] ?? [];
    // 改前：4 条编辑（类方法键 + k.m(1) + o.m(2) + k.m(3)）
    // ⇒ `o.m(2)` 被改成 `o.renamed(2)`，运行时读到 undefined（静默坏代码）
    // 改后：R21 夹具里 `k` / `o` 都是**无类型形参** ⇒ 接收者归属解析不出来，
    // 而文件内 `other` 有同名成员 `m` ⇒ **归属歧义**。
    // 歧义下只有两种自洽结果：全改（改到无关对象）或全不改（定义改了、
    // 调用点没改 ⇒ 同样坏）——两者都坏 ⇒ 拒绝改名，**一条编辑都不产出**。
    expect(list).toEqual([]);
  }
  {
    // R21：形参接收者 + 同名不同归属成员 ⇒ 歧义
    expect(hasAmbiguousMethodReceiver(parse(R21), "m", { owner: { kind: "class", name: "K" } })).toBe(true);
    // OBJ_METHOD：接收者归属可解析（helper ⇒ 对象字面量）⇒ 无歧义
    expect(hasAmbiguousMethodReceiver(parse(OBJ_METHOD), "m", { owner: { kind: "object", name: "helper" } })).toBe(false);
    // TWO_CLASSES：a / b 都能解析出归属 ⇒ 无歧义
    expect(hasAmbiguousMethodReceiver(parse(TWO_CLASSES), "run", { owner: { kind: "class", name: "Alpha" } })).toBe(false);
  }
  {
    const edits = await renameEdits(
      { "obj-meth.js": OBJ_METHOD },
      { file: "obj-meth.js", position: posOf(OBJ_METHOD, "m()") },
      "renamed",
    );
    const list = edits["obj-meth.js"] ?? [];
    // 定义位：对象字面量的 key
    const key = posOf(OBJ_METHOD, "m()");
    expect(list.some((e) => e.at === `${key.line}:${key.character}-${key.line}:${key.character + 1}`)).toBe(true);
    // 使用位：helper.m()
    const use = posOf(OBJ_METHOD, "helper.m");
    const useCol = use.character + "helper.".length;
    expect(list.some((e) => e.at === `${use.line}:${useCol}-${use.line}:${useCol + 1}`)).toBe(true);
    expect(list.every((e) => e.newText === "renamed")).toBe(true);
  }
  {
    const edits = await renameEdits(
      { "obj-prop.js": OBJ_PROPERTY },
      { file: "obj-prop.js", position: posOf(OBJ_PROPERTY, "m: impl") },
      "renamed",
    );
    const list = edits["obj-prop.js"] ?? [];
    const key = posOf(OBJ_PROPERTY, "m: impl");
    // 改前：ObjectProperty 的 key 不在收集范围 ⇒ 只改调用点，key 留着 m（改出坏代码）
    expect(list.some((e) => e.at === `${key.line}:${key.character}-${key.line}:${key.character + 1}`)).toBe(true);
    const use = posOf(OBJ_PROPERTY, "helper.m");
    const useCol = use.character + "helper.".length;
    expect(list.some((e) => e.at === `${use.line}:${useCol}-${use.line}:${useCol + 1}`)).toBe(true);
  }
  {
    const edits = await renameEdits(
      { "two.js": TWO_CLASSES },
      { file: "two.js", position: posOf(TWO_CLASSES, "run()") },
      "renamed",
    );
    const list = edits["two.js"] ?? [];
    const alphaKey = posOf(TWO_CLASSES, "run()");
    const betaKey = posOf(TWO_CLASSES, "run()", 1);
    const aUse = posOf(TWO_CLASSES, "a.run()");
    const bUse = posOf(TWO_CLASSES, "b.run()");
    expect(list.some((e) => e.at === `${alphaKey.line}:${alphaKey.character}-${alphaKey.line}:${alphaKey.character + 3}`)).toBe(true); // Alpha.run 键
    expect(list.some((e) => e.at.startsWith(`${betaKey.line}:`))).toBe(false); // Beta.run 键
    expect(list.some((e) => e.at.startsWith(`${bUse.line}:`))).toBe(false); // b.run()
    expect(list.some((e) => e.at.startsWith(`${aUse.line}:`))).toBe(true); // a.run()
  }
  {
    const a = `export class Alpha {
  run() {
    return 1;
  }
}
`;
    const b = `export class Beta {
  run() {
    return 2;
  }
}
`;
    const edits = await renameEdits(
      { "a.js": a, "b.js": b },
      { file: "a.js", position: posOf(a, "run()") },
      "renamed",
    );
    // 改前：b.js 的 Beta.run 也被改（跨文件 name-based 扫描）
    expect(edits["b.js"] ?? []).toEqual([]);
    expect((edits["a.js"] ?? []).some((e) => e.at === "1:2-1:5")).toBe(true);
  }
  {
    expect(renameTargetAt(R21, 2, 2)).toMatchObject({ kind: "method", name: "m" });
    // other 的数据属性 m：不可改名
    expect(renameTargetAt(R21, 8, 2)).toMatchObject({ error: expect.any(String) });
  }
});










});


// ---------------------------------------------------------------------------
// 别名导出 export { a as b } 的 rename 改导出名（不改本地名）
// ---------------------------------------------------------------------------
describe("别名导出 export { a as b } 的 rename 改导出名（不改本地名）", () => {
/**
 * LSP 的**别名导出**（`export { a as b }`）形态：跨文件 references 丢掉
 * 部分 importer + **rename 改的是本地名** ⇒ 改完**模块图断裂**
 * （真 node `SyntaxError`，而两个文件语法都合法）。
 *
 * 根因：`export { hidden as visible }` 把**两个身份**压进了同一个说明符 ——
 * 本地名 `hidden`（本地绑定）与导出名 `visible`（本模块对外的名字）。
 * 改名的编辑集按**本地名**收集 ⇒ 改掉 `hidden` 的声明 + 导出说明符的本地侧，
 * 而 importer 的 imported 侧被改成新名 ⇒ 目标模块导出的还是 `visible`
 * ⇒ importer 立刻失联。
 *
 * 改后：**本地名 / 导出名分成两个身份字段**
 * - 导出名身份：编辑集 = 导出说明符的**导出侧** + importer 的 **imported 侧**
 * （+ importer 的本地用法）⇒ 改完模块图仍然自洽；
 * - 本地名身份：编辑集 = 本地声明 + 导出说明符的**本地侧**（**不得**连坐
 * importer 的 imported 侧 —— 那是导出名的身份）。
 * - 导出名位（`export { hidden as visible }` 的 `visible`）不再是死位：
 * definition / references / prepareRename / rename 都有可导航身份。
 *
 * ⚠ 回归钉**真的落盘 + 真 import** 验（不能只断言编辑集）：改名后必须能被
 * node 以 ESM 真 import 成功、且取到正确的值。
 */






type Loc = {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};
type TextEdit = { range: Loc["range"]; newText: string };

const DEF = `const hidden = 1;
export { hidden as visible };
`;
const USE = `import { visible } from "./aexp-def.js";

export function use() {
  return visible;
}
`;
const USE2 = `import { visible } from "./aexp-def.js";

export function use2() {
  return visible;
}
`;

const FILES = {
  "aexp-def.js": DEF,
  "aexp-use.js": USE,
  "aexp-use2.js": USE2,
};

/** 0-based 行列（needle 的第 occurrence 次出现） */
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

/** 列偏移 */
function offset(pos: { line: number; character: number }, dx: number): { line: number; character: number } {
  return { line: pos.line, character: pos.character + dx };
}

/** 本地名位：`const hidden = 1;` 的 hidden */
const LOCAL_POS = posOf(DEF, "hidden = 1");
/** 导出名位：`export { hidden as visible };` 的 visible */
const EXPORT_POS = offset(posOf(DEF, "as visible"), 3);
/** importer 用点位：` return visible;` 的 visible */
const USE_POS = posOf(USE, "visible;");

function rel(uri: string, root: string): string {
  const p = uri.replace(/^file:\/\//, "");
  return p.startsWith(root) ? p.slice(root.length + 1) : p;
}

/** 文本 → 偏移 */
function offsetOf(text: string, line: number, character: number): number {
  const lines = text.split("\n");
  let off = 0;
  for (let i = 0; i < line; i++) off += lines[i]!.length + 1;
  return off + character;
}

/** 把 WorkspaceEdit 落到磁盘（从后往前改，偏移不串位） */
function applyEdits(dir: string, changes: Record<string, TextEdit[]>): void {
  for (const [uri, list] of Object.entries(changes)) {
    const path = uri.replace(/^file:\/\//, "");
    const text = readFileSync(path, "utf-8");
    const edits = list
      .map((e) => ({
        start: offsetOf(text, e.range.start.line, e.range.start.character),
        end: offsetOf(text, e.range.end.line, e.range.end.character),
        newText: e.newText,
      }))
      .sort((a, b) => b.start - a.start);
    let out = text;
    for (const e of edits) out = out.slice(0, e.start) + e.newText + out.slice(e.end);
    writeFileSync(path, out, "utf-8");
  }
}

/** 目录 → ESM（真 import 验模块图） */
function makeEsm(dir: string): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }), "utf-8");
}

/** 落地后真 import（node ESM）⇒ 模块图必须自洽 */
async function importOk(dir: string, file: string, tag: string): Promise<number> {
  const mod = await import(`${pathToFileURL(join(dir, file)).href}?v=${tag}`);
  return typeof mod.use === "function" ? (mod.use() as number) : (mod.use2() as number);
}


  it("rename @ importer 用点位 ⇒ 改导出名 + importer 的 imported 侧，**不动** hidden 的声明；rename @ 导出名位 ⇒ 同样改导出名 + importer 的 imported 侧（改前是 null）；rename @ 本地名位 ⇒ 改本地名（声明 + 导出说明符本地侧），**不连坐** importer；导出名位不再死位：definition / references / prepareRename 都有身份", async () => {
  {
    const where: string[] = [];
    let filesAfter: Record<string, string> = {};
    await withLspServer(FILES, async (ctx) => {
      makeEsm(ctx.dir);
      const res = await ctx.req("textDocument/rename")({
        textDocument: { uri: ctx.uri("aexp-use.js") },
        position: USE_POS,
        newName: "visible2",
      });
      const changes = (res?.changes ?? {}) as Record<string, TextEdit[]>;
      for (const [uri, list] of Object.entries(changes)) {
        const file = rel(uri, ctx.dir);
        for (const e of list) {
          where.push(`${file}:${e.range.start.line}:${e.range.start.character}-${e.range.end.line}:${e.range.end.character}`);
        }
      }
      applyEdits(ctx.dir, changes);
      filesAfter = {
        def: readFileSync(join(ctx.dir, "aexp-def.js"), "utf-8"),
        use: readFileSync(join(ctx.dir, "aexp-use.js"), "utf-8"),
        use2: readFileSync(join(ctx.dir, "aexp-use2.js"), "utf-8"),
      };
      // 真 import：模块图必须仍然自洽（改前会 SyntaxError：
      // The requested module does not provide an export named 'visible2'）
      expect(await importOk(ctx.dir, "aexp-use.js", "1")).toBe(1);
      expect(await importOk(ctx.dir, "aexp-use2.js", "1")).toBe(1);
    });

    // ① 编辑集：导出说明符的**导出侧** + 两个 importer 的 imported 侧 + 用法
    expect(where).toContain(
      `aexp-def.js:${EXPORT_POS.line}:${EXPORT_POS.character}-${EXPORT_POS.line}:${EXPORT_POS.character + 7}`,
    );
    expect(where).toContain(`aexp-use.js:0:9-0:16`);
    expect(where).toContain(`aexp-use2.js:0:9-0:16`);
    // ② ⚠ 本地名 `hidden` 的声明 / 导出说明符的本地侧 **不得**进编辑集
    expect(where).not.toContain(
      `aexp-def.js:${LOCAL_POS.line}:${LOCAL_POS.character}-${LOCAL_POS.line}:${LOCAL_POS.character + 6}`,
    );
    expect(where).not.toContain(`aexp-def.js:1:9-1:15`);

    // ③ 落盘后：导出名改了、本地名没改
    expect(filesAfter.def).toContain("export { hidden as visible2 };");
    expect(filesAfter.def).toContain("const hidden = 1;");
    expect(filesAfter.use).toContain('import { visible2 } from "./aexp-def.js";');
  }
  {
    const where: string[] = [];
    await withLspServer(FILES, async (ctx) => {
      makeEsm(ctx.dir);
      const res = await ctx.req("textDocument/rename")({
        textDocument: { uri: ctx.uri("aexp-def.js") },
        position: EXPORT_POS,
        newName: "visible2",
      });
      const changes = (res?.changes ?? {}) as Record<string, TextEdit[]>;
      for (const [uri, list] of Object.entries(changes)) {
        const file = rel(uri, ctx.dir);
        for (const e of list) where.push(`${file}:${e.range.start.line}:${e.range.start.character}`);
      }
      applyEdits(ctx.dir, changes);
      expect(await importOk(ctx.dir, "aexp-use.js", "2")).toBe(1);
    });
    expect(where).toContain(`aexp-def.js:${EXPORT_POS.line}:${EXPORT_POS.character}`);
    expect(where.some((w) => w.startsWith("aexp-use.js:0:"))).toBe(true);
    expect(where.some((w) => w.startsWith("aexp-use2.js:0:"))).toBe(true);
    expect(where).not.toContain(`aexp-def.js:${LOCAL_POS.line}:${LOCAL_POS.character}`);
  }
  {
    const where: string[] = [];
    await withLspServer(FILES, async (ctx) => {
      makeEsm(ctx.dir);
      const res = await ctx.req("textDocument/rename")({
        textDocument: { uri: ctx.uri("aexp-def.js") },
        position: LOCAL_POS,
        newName: "hidden2",
      });
      const changes = (res?.changes ?? {}) as Record<string, TextEdit[]>;
      for (const [uri, list] of Object.entries(changes)) {
        const file = rel(uri, ctx.dir);
        for (const e of list) where.push(`${file}:${e.range.start.line}:${e.range.start.character}`);
      }
      applyEdits(ctx.dir, changes);
      // 导出名没变 ⇒ importer 不受影响 ⇒ 模块图仍然自洽
      expect(await importOk(ctx.dir, "aexp-use.js", "3")).toBe(1);
    });
    expect(where).toContain(`aexp-def.js:${LOCAL_POS.line}:${LOCAL_POS.character}`);
    // 导出说明符的**本地侧**跟着改
    expect(where).toContain("aexp-def.js:1:9");
    // ⚠ importer 的 imported 侧是**导出名**的身份 ⇒ 不得连坐
    expect(where.some((w) => w.startsWith("aexp-use.js:"))).toBe(false);
    expect(where.some((w) => w.startsWith("aexp-use2.js:"))).toBe(false);
  }
  {
    let defs: Loc[] = [];
    let refs: Loc[] = [];
    let prep: { range: Loc["range"]; placeholder: string } | null = null;
    let where: string[] = [];
    await withLspServer(FILES, async (ctx) => {
      defs = (await ctx.req("textDocument/definition")({
        textDocument: { uri: ctx.uri("aexp-def.js") },
        position: EXPORT_POS,
      })) as Loc[];
      refs = (await ctx.req("textDocument/references")({
        textDocument: { uri: ctx.uri("aexp-def.js") },
        position: EXPORT_POS,
        context: { includeDeclaration: true },
      })) as Loc[];
      prep = (await ctx.req("textDocument/prepareRename")({
        textDocument: { uri: ctx.uri("aexp-def.js") },
        position: EXPORT_POS,
      })) as { range: Loc["range"]; placeholder: string } | null;
      where = refs.map((r) => `${rel(r.uri, ctx.dir)}:${r.range.start.line}:${r.range.start.character}`);
    });
    // definition ⇒ 跳到本地绑定（与停在本地名位一致）
    expect(defs.length).toBeGreaterThanOrEqual(1);
    expect(defs[0]!.range.start.line).toBe(LOCAL_POS.line);
    expect(defs[0]!.range.start.character).toBe(LOCAL_POS.character);
    // references ⇒ 导出侧 + 两个 importer
    expect(where).toContain(`aexp-def.js:${EXPORT_POS.line}:${EXPORT_POS.character}`);
    expect(where.some((w) => w.startsWith("aexp-use.js:"))).toBe(true);
    expect(where.some((w) => w.startsWith("aexp-use2.js:"))).toBe(true);
    // prepareRename ⇒ 非 null，placeholder = 导出名
    expect(prep).toBeTruthy();
    expect(prep!.placeholder).toBe("visible");
  }
});




});


// ---------------------------------------------------------------------------
// 改本地别名不得连坐导出符号与其它 importer
// ---------------------------------------------------------------------------
describe("改本地别名不得连坐导出符号与其它 importer", () => {
/**
 * 跨文件改名：改**本地别名**却把**导出符号**与**其它 importer**一起改掉。
 *
 * 报告说的症状（**假阳性 —— 不复现**）：
 * 在 `xf-use.js`（导入方）把**本地别名** `alias` 改名 ⇒ 报告实测：
 * `xf-def.js` 的导出符号 + `xf-use2.js` 的 import 与用法**被一起改掉**。
 *
 * 实测（HEAD `dd22619e` 上逐字，见 `tmp/probe/fix-r91/D/oracle-before-head.txt`）：
 * 在 `xf-use.js` 改本地别名 ⇒ 编辑集**只有**
 * `xf-use.js:0:20-0:25`（import 说明符的 **local** 侧）+ `xf-use.js:3:9-3:14`（用法处）；
 * `xf-def.js` 与 `xf-use2.js` **零编辑**。
 * 反向（从**定义方**改导出名）⇒ 正确改 `xf-def.js` 的导出名 + 各 importer 的
 * **imported** 侧，**别名 `alias` 不动**。
 *
 * ⇒ 症状已被**更早的族**修掉：**族 22（lsp-signature）的 **
 * （`lsp--alias-import-cross-file-rename.part.ts`）的修复面覆盖本条
 * （`isLocalAliasSymbol` / `resolveReferences` 的「本地别名」分支）。
 *
 * 本文件是**反向守护钉**：钉住「**已修**」的行为 ⇒ **在 HEAD 上必须通过**
 * （闸④ 反向闸，与其它片「必须大面积失败」的口径相反）⇒ 任何人把「本地别名」
 * 与「被导入符号」再混为一谈，本钉立刻变红。
 */



/** 导出方：`oldName` 在 0:16-0:23 */
const DEF = `export function oldName() { return 1; }
`;
/** 导入方（别名形态）：imported 侧 `oldName` 在 0:9-0:16，local 侧 `alias` 在 0:20-0:25，用法在 3:9-3:14 */
const USE = `import { oldName as alias } from "./xf-def.js";

export function use() {
  return alias();
}
`;
/** 另一个 importer（无别名形态）：`oldName` 在 0:9-0:16，用法在 3:9-3:16 */
const USE2 = `import { oldName } from "./xf-def.js";

export function use2() {
  return oldName();
}
`;

type Edit = {
  file: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  newText: string;
};

/** WorkspaceEdit.changes ⇒ 可断言的编辑列表（按 file/line/character 排序） */
function editsOf(result: unknown): Edit[] {
  const changes = (result as any)?.changes;
  if (!changes) return [];
  const out: Edit[] = [];
  for (const [uri, list] of Object.entries(changes as Record<string, any[]>)) {
    for (const e of list as any[]) {
      out.push({
        file: String(uri).split("/").pop() ?? "",
        line: e.range.start.line,
        character: e.range.start.character,
        endLine: e.range.end.line,
        endCharacter: e.range.end.character,
        newText: e.newText,
      });
    }
  }
  return out.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.character - b.character,
  );
}


  it("在别名用法处改名：只改 importer 的本地侧 + 用法处；在 import 说明符的 local 侧改名：同样零连坐（导出方与其它 importer 不动）；反向：从导出方改导出名 ⇒ 改导出方 + 各 importer 的 imported 侧，别名不动", async () => {
  {
    await withLspServer(
      { "xf-def.js": DEF, "xf-use.js": USE, "xf-use2.js": USE2 },
      async ({ req, uri }) => {
        const edits = editsOf(
          await req("textDocument/rename")({
            textDocument: { uri: uri("xf-use.js") },
            position: { line: 3, character: 9 }, // alias() 的用法处
            newName: "z",
          }),
        );
        expect(edits).toEqual([
          {
            file: "xf-use.js",
            line: 0,
            character: 20,
            endLine: 0,
            endCharacter: 25,
            newText: "z",
          },
          {
            file: "xf-use.js",
            line: 3,
            character: 9,
            endLine: 3,
            endCharacter: 14,
            newText: "z",
          },
        ]);
      },
    );
  }
  {
    await withLspServer(
      { "xf-def.js": DEF, "xf-use.js": USE, "xf-use2.js": USE2 },
      async ({ req, uri }) => {
        const edits = editsOf(
          await req("textDocument/rename")({
            textDocument: { uri: uri("xf-use.js") },
            position: { line: 0, character: 21 }, // alias（local 侧）
            newName: "z",
          }),
        );
        // 导出方（xf-def.js）与另一个 importer（xf-use2.js）零编辑
        expect(
          edits.filter((e) => e.file === "xf-def.js" || e.file === "xf-use2.js"),
          "改本地别名不得连坐导出符号与其它 importer",
        ).toEqual([]);
        expect(edits).toEqual([
          {
            file: "xf-use.js",
            line: 0,
            character: 20,
            endLine: 0,
            endCharacter: 25,
            newText: "z",
          },
          {
            file: "xf-use.js",
            line: 3,
            character: 9,
            endLine: 3,
            endCharacter: 14,
            newText: "z",
          },
        ]);
      },
    );
  }
  {
    await withLspServer(
      { "xf-def.js": DEF, "xf-use.js": USE, "xf-use2.js": USE2 },
      async ({ req, uri }) => {
        const edits = editsOf(
          await req("textDocument/rename")({
            textDocument: { uri: uri("xf-def.js") },
            position: { line: 0, character: 16 }, // oldName（定义方）
            newName: "z",
          }),
        );
        expect(edits).toEqual([
          {
            file: "xf-def.js",
            line: 0,
            character: 16,
            endLine: 0,
            endCharacter: 23,
            newText: "z",
          },
          {
            file: "xf-use.js",
            line: 0,
            character: 9,
            endLine: 0,
            endCharacter: 16,
            newText: "z",
          },
          {
            file: "xf-use2.js",
            line: 0,
            character: 9,
            endLine: 0,
            endCharacter: 16,
            newText: "z",
          },
          {
            file: "xf-use2.js",
            line: 3,
            character: 9,
            endLine: 3,
            endCharacter: 16,
            newText: "z",
          },
        ]);
        // 别名 `alias`（local 侧）与其用法处都不该被改（本地名没变）
        expect(
          edits.filter((e) => e.file === "xf-use.js" && e.line === 3),
          "别名 import 的本地名不得被改",
        ).toEqual([]);
      },
    );
  }
});



});


// ---------------------------------------------------------------------------
// 形参与同名遮蔽的顶层变量：两个方向都不连坐
// ---------------------------------------------------------------------------
describe("形参与同名遮蔽的顶层变量：两个方向都不连坐", () => {
/**
 * `rename` 重命名**形参**时，把**同名遮蔽的顶层变量**一起改了。
 *
 * 报告说的症状（**假阳性 —— 不复现**）：
 * 夹具 `const x = 1;` / `export function f(x) { return x + 1; }`
 * 重命名**形参** ⇒ 编辑集**多出一条**真改动（顶层 `const x`）。
 * 报告还指出两个方向**不对称**（形参方向多改、顶层方向正确）。
 *
 * 实测（HEAD `dd22619e` 上逐字，见 `tmp/probe/fix-r91/D/oracle-before-head.txt`）：
 * · 形参声明位（1:18）改名 ⇒ 编辑集**只有** `1:18-1:19` + `1:30-1:31`
 * （顶层 `0:6-0:7` **零编辑**）；
 * · 形参引用位（1:30）改名 ⇒ 同上；
 * · 顶层 `x`（0:6）改名 ⇒ 编辑集**只有** `0:6-0:7`（形参零编辑）。
 * ⇒ **两个方向都不连坐**。
 * `definition`@形参 ⇒ `renfx.js:1:18-1:19`；`references`@形参 ⇒
 * `["1:18-1:19","1:30-1:31"]`（**作用域感知**）。
 *
 * ⇒ 症状已被**更早的族**修掉：**族 22（lsp-signature）的 **
 * （`lsp--shadowed-binding.part.ts`）的修复面覆盖本条 ——
 * 符号表按**作用域路径**存同名绑定（`name@行:列`），`findDefinition` /
 * `findReferences` / `resolveDefinitionLocations` 取**最内层**那条。
 *
 * 本文件是**反向守护钉**：钉住「**已修**」的行为 ⇒ **在 HEAD 上必须通过**
 * （闸④ 反向闸）⇒ 任何人把符号表退回「按名字索引」，本钉立刻变红。
 */



/**
 * 夹具：顶层 `x`（0:6-0:7）与形参 `x`（1:18-1:19）+ 形参引用（1:30-1:31）
 * —— 形参**遮蔽**顶层变量，两者同名但**不同的绑定**。
 */
const SHADOW = `const x = 1;
export function f(x) { return x + 1; }
`;

type Loc = {
  file: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
};

type Edit = Loc & { newText: string };

/** Location[] ⇒ 可断言的位点列表 */
function locsOf(result: unknown): Loc[] {
  if (!Array.isArray(result)) return [];
  return (result as any[]).map((l) => ({
    file: String(l?.uri ?? "").split("/").pop() ?? "",
    line: l?.range?.start?.line ?? -1,
    character: l?.range?.start?.character ?? -1,
    endLine: l?.range?.end?.line ?? -1,
    endCharacter: l?.range?.end?.character ?? -1,
  }));
}

/** WorkspaceEdit.changes ⇒ 可断言的编辑列表（按 file/line/character 排序） */
function editsOf(result: unknown): Edit[] {
  const changes = (result as any)?.changes;
  if (!changes) return [];
  const out: Edit[] = [];
  for (const [uri, list] of Object.entries(changes as Record<string, any[]>)) {
    for (const e of list as any[]) {
      out.push({
        file: String(uri).split("/").pop() ?? "",
        line: e.range.start.line,
        character: e.range.start.character,
        endLine: e.range.end.line,
        endCharacter: e.range.end.character,
        newText: e.newText,
      });
    }
  }
  return out.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.character - b.character,
  );
}

const PARAM_DECL: Loc = {
  file: "renfx.js",
  line: 1,
  character: 18,
  endLine: 1,
  endCharacter: 19,
};
const PARAM_USE: Loc = {
  file: "renfx.js",
  line: 1,
  character: 30,
  endLine: 1,
  endCharacter: 31,
};
const TOP_LEVEL: Loc = {
  file: "renfx.js",
  line: 0,
  character: 6,
  endLine: 0,
  endCharacter: 7,
};


  it("重命名形参声明位：编辑集只有形参声明 + 形参引用，顶层零编辑；重命名形参体内的引用位：同样不连坐顶层变量；反向：重命名顶层变量：只改顶层那处，形参零编辑（两个方向对称）；definition / references 走作用域：形参只认形参那一处绑定", async () => {
  {
    await withLspServer({ "renfx.js": SHADOW }, async ({ req, uri }) => {
      const edits = editsOf(
        await req("textDocument/rename")({
          textDocument: { uri: uri("renfx.js") },
          position: { line: 1, character: 18 },
          newName: "y",
        }),
      );
      expect(edits).toEqual([
        { ...PARAM_DECL, newText: "y" },
        { ...PARAM_USE, newText: "y" },
      ]);
      expect(
        edits.filter((e) => e.line === 0),
        "重命名形参不得连坐顶层同名变量",
      ).toEqual([]);
    });
  }
  {
    await withLspServer({ "renfx.js": SHADOW }, async ({ req, uri }) => {
      const edits = editsOf(
        await req("textDocument/rename")({
          textDocument: { uri: uri("renfx.js") },
          position: { line: 1, character: 30 },
          newName: "y",
        }),
      );
      expect(edits).toEqual([
        { ...PARAM_DECL, newText: "y" },
        { ...PARAM_USE, newText: "y" },
      ]);
      expect(
        edits.filter((e) => e.line === 0),
        "重命名形参不得连坐顶层同名变量",
      ).toEqual([]);
    });
  }
  {
    await withLspServer({ "renfx.js": SHADOW }, async ({ req, uri }) => {
      const edits = editsOf(
        await req("textDocument/rename")({
          textDocument: { uri: uri("renfx.js") },
          position: { line: 0, character: 6 },
          newName: "y",
        }),
      );
      expect(edits).toEqual([{ ...TOP_LEVEL, newText: "y" }]);
    });
  }
  {
    await withLspServer({ "renfx.js": SHADOW }, async ({ req, uri }) => {
      const defs = locsOf(
        await req("textDocument/definition")({
          textDocument: { uri: uri("renfx.js") },
          position: { line: 1, character: 18 },
        }),
      );
      expect(defs).toEqual([PARAM_DECL]);

      const refs = locsOf(
        await req("textDocument/references")({
          textDocument: { uri: uri("renfx.js") },
          position: { line: 1, character: 18 },
          context: { includeDeclaration: true },
        }),
      );
      expect(refs).toEqual([PARAM_DECL, PARAM_USE]);
    });
  }
});




});


// ---------------------------------------------------------------------------
// 侧车契约绑定参与 references / rename
// ---------------------------------------------------------------------------
describe("侧车契约绑定参与 references / rename", () => {
/**
 * `textDocument/rename` / `textDocument/references` 漏掉**侧车契约绑定**
 * （而 `textDocument/definition` 把它报成定义位）
 *
 * 现象：对带侧车契约的导出函数改名 ⇒ 只改源码、侧车契约成孤儿
 * （仍绑定旧名）⇒ 契约档 `hw`→`imp`，**已报的 L1 `nudo:constraint-violated`
 * 诊断静默消失**（门禁结论被 LSP 自己的编辑改掉）。
 *
 * 钉（协议面，同一符号三面必须同口径）：
 * 1. `definition` 报出两个定义位（源码声明 + 侧车契约绑定）；
 * 2. `references` 包含侧车契约绑定位；
 * 3. `rename` 的编辑集包含侧车契约绑定位（= definition 定义位全集的超集）；
 * 4. 把 rename 编辑落到两侧文件后，侧车契约**跟随改名**（不再是孤儿）；
 * 5. 负控制：没有侧车时 references / rename 不产生侧车文件（不凭空造文件）。
 */








const LIB_JS = `export function add(user) {
  return user.name;
}
export function caller() {
  return add({ id: 1 });
}
`;
const LIB_SC = `import { fn, shape, string } from "@nudojs/core";

export const add = fn({ user: shape({ name: string() }) }, string());
`;

type Loc = { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } };

const asLocations = (res: unknown): Loc[] => (Array.isArray(res) ? (res as Loc[]) : res ? [res as Loc] : []);

/** uri → 文件名（测试只关心"哪个文件"） */
const fileOf = (uri: string): string => basename(decodeURIComponent(uri));

/** `file:line:character` 形态，便于集合断言 */
const keyOf = (l: Loc): string =>
  `${fileOf(l.uri)}:${l.range.start.line}:${l.range.start.character}`;


  it("definition / references / rename 对同一符号同口径（含侧车契约绑定）；落盘后契约仍在生效（L1 违约诊断不因改名静默消失）；负控制：没有侧车时 references / rename 只碰源码文件", async () => {
  {
    await withLspServer(
      { "lib.js": LIB_JS, "lib.nudo.js": LIB_SC },
      async ({ req, uri }) => {
        const pos = { textDocument: { uri: uri("lib.js") }, position: { line: 0, character: 16 } };
        const defs = asLocations(req("textDocument/definition")(pos));
        const defKeys = defs.map(keyOf).sort();
        // 侧车契约绑定（`export const add = fn(…)` 的 add，line 2 char 13）
        expect(defKeys).toContain("lib.nudo.js:2:13");

        const refs = asLocations(
          req("textDocument/references")({ ...pos, context: { includeDeclaration: true } }),
        );
        const refKeys = refs.map(keyOf);
        // 源码侧：声明 + 调用点；侧车侧：契约绑定
        expect(refKeys).toContain("lib.js:0:16");
        expect(refKeys).toContain("lib.js:4:9");
        expect(refKeys).toContain("lib.nudo.js:2:13");

        const rename = req("textDocument/rename")({ ...pos, newName: "plus" }) as {
          changes?: Record<string, CodeActionEdit[]>;
        };
        const changes = rename?.changes ?? {};
        const files = Object.keys(changes).map(fileOf).sort();
        // rename 改**两个**文件：侧车不得成孤儿
        expect(files).toEqual(["lib.js", "lib.nudo.js"]);

        // 侧车编辑 = 契约绑定标识符本身（line 2, char 13..16 → "plus"）
        const scKey = Object.keys(changes).find((u) => fileOf(u) === "lib.nudo.js")!;
        const scEdits = changes[scKey]!;
        expect(scEdits).toHaveLength(1);
        expect(scEdits[0]!.range.start).toEqual({ line: 2, character: 13 });
        expect(scEdits[0]!.range.end).toEqual({ line: 2, character: 16 });
        expect(scEdits[0]!.newText).toBe("plus");

        // definition 的定义位全集 ⊆ rename 的编辑集（同一符号不得两套答案）
        const renameKeys = new Set<string>(
          Object.entries(changes).flatMap(([u, edits]) =>
            edits.map((e) => `${fileOf(u)}:${e.range.start.line}:${e.range.start.character}`),
          ),
        );
        for (const k of defKeys) expect(renameKeys).toContain(k);

        // 落盘（内存）：两侧同时改名 ⇒ 契约跟随源码，不成孤儿
        const libEdits = changes[Object.keys(changes).find((u) => fileOf(u) === "lib.js")!]!;
        const landedJs = applyEdits(LIB_JS, libEdits);
        expect(landedJs).toContain("export function plus(user)");
        expect(landedJs).toContain("return plus({ id: 1 });");
        expect(landedJs).not.toContain("function add(");

        const landedSc = applyEdits(LIB_SC, scEdits);
        expect(landedSc).toContain("export const plus = fn({ user: shape({ name: string() }) }, string());");
        expect(landedSc).not.toContain("export const add");
      },
      "nudo-lsp-105-",
    );
  }
  {
    withTempDir("nudo-lsp-105-recheck-", (dir) => {
      const jsPath = join(dir, "lib.js");
      const scPath = join(dir, "lib.nudo.js");
      writeFileSync(jsPath, LIB_JS, "utf-8");
      writeFileSync(scPath, LIB_SC, "utf-8");

      const before = checkToLspDiagnostics(jsPath, LIB_JS, defaultLoadModule);
      expect(before.some((d) => d.code === "nudo:constraint-violated")).toBe(true);

      const renamedJs = LIB_JS.replace(/\badd\b/g, "plus");
      const renamedSc = readFileSync(scPath, "utf-8").replace("export const add =", "export const plus =");

      // 旧行为（对照）：只改源码 ⇒ 契约成孤儿 ⇒ 已报的 L1 违约诊断**消失**
      writeFileSync(jsPath, renamedJs, "utf-8");
      const orphan = checkToLspDiagnostics(jsPath, renamedJs, defaultLoadModule);
      expect(orphan.some((d) => d.code === "nudo:constraint-violated")).toBe(false);

      // 修复后的 rename 编辑集（源码 + 侧车）⇒ 契约仍绑定 ⇒ 违约诊断仍在
      writeFileSync(scPath, renamedSc, "utf-8");
      const synced = checkToLspDiagnostics(jsPath, renamedJs, defaultLoadModule);
      expect(synced.some((d) => d.code === "nudo:constraint-violated")).toBe(true);
    });
  }
  {
    await withLspServer(
      { "lib.js": LIB_JS },
      async ({ req, uri }) => {
        const pos = { textDocument: { uri: uri("lib.js") }, position: { line: 0, character: 16 } };
        const refs = asLocations(
          req("textDocument/references")({ ...pos, context: { includeDeclaration: true } }),
        );
        expect(refs.map(keyOf).sort()).toEqual(["lib.js:0:16", "lib.js:4:9"]);

        const rename = req("textDocument/rename")({ ...pos, newName: "plus" }) as {
          changes?: Record<string, unknown>;
        };
        expect(Object.keys(rename?.changes ?? {}).map(fileOf)).toEqual(["lib.js"]);
      },
      "nudo-lsp-105-neg-",
    );
  }
});



});


// ---------------------------------------------------------------------------
// re-export 边的引用面与改名
// ---------------------------------------------------------------------------
describe("re-export 边的引用面与改名", () => {
/**
 * re-export 边在 references / rename 面不可见。
 *
 * 症状：`export { a } from "./m.js"` 这条边在符号表里根本没被建立 ⇒
 * 引用面看不到 m.js ⇒ 改名只改本地 ⇒ 目标模块没同步 ⇒ 模块图断裂
 * （m.js 改了名、main.js 的 re-export 原样不动 ⇒ SyntaxError）。
 */



let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const M = `export const a = "TAG";
export function helper() {
  return a;
}
`;
const MAIN = `export { a } from "./m.js";

export function use() {
  return a;
}
`;


  it("从 re-export 位置发起 references 覆盖目标模块的定义与内部引用；从目标模块的定义处发起 references 覆盖 re-export 位点；从 re-export 位置发起 rename 同步改目标模块", async () => {
  {
    h = await startLspWithFiles({ "m.js": M, "main.js": MAIN });
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("main.js") },
        position: { line: 0, character: 9 }, // export { a } from "./m.js"
        context: { includeDeclaration: true },
      }),
    );
    // m.js 的定义位点
    expect(refs).toContainEqual({
      file: "m.js",
      line: 0,
      character: 13,
      endLine: 0,
      endCharacter: 14,
    });
    // m.js 内部 helper() 里的引用
    expect(refs).toContainEqual({
      file: "m.js",
      line: 2,
      character: 9,
      endLine: 2,
      endCharacter: 10,
    });
  }
  {
    h = await startLspWithFiles({ "m.js": M, "main.js": MAIN });
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("m.js") },
        position: { line: 0, character: 13 }, // export const a
        context: { includeDeclaration: true },
      }),
    );
    expect(refs).toContainEqual({
      file: "main.js",
      line: 0,
      character: 9,
      endLine: 0,
      endCharacter: 10,
    });
  }
  {
    h = await startLspWithFiles({ "m.js": M, "main.js": MAIN });
    const edits = editsOf(
      h.req("textDocument/rename", {
        textDocument: { uri: h.uri("main.js") },
        position: { line: 0, character: 9 },
        newName: "b",
      }),
    );
    // m.js 的定义 + 内部引用
    expect(edits).toContainEqual({
      file: "m.js",
      line: 0,
      character: 13,
      endLine: 0,
      endCharacter: 14,
      newText: "b",
    });
    expect(edits).toContainEqual({
      file: "m.js",
      line: 2,
      character: 9,
      endLine: 2,
      endCharacter: 10,
      newText: "b",
    });
    // main.js 的 re-export 位点
    expect(edits).toContainEqual({
      file: "main.js",
      line: 0,
      character: 9,
      endLine: 0,
      endCharacter: 10,
      newText: "b",
    });
  }
});



});


// ---------------------------------------------------------------------------
// 别名 import 的跨文件改名口径
// ---------------------------------------------------------------------------
describe("别名 import 的跨文件改名口径", () => {
/**
 * 跨文件改名：别名 import 被改、import 说明符的 imported 侧没被改。
 *
 * 症状：`import { oldName as alias } from "./xf-def.js"` + 在 xf-def.js 改名
 * ⇒ 改出来是 `import { oldName as newName }`（imported 侧没动 ⇒ import 断链，
 * 模块加载即 SyntaxError），而**不该改的别名**被改了。
 *
 * 期望：imported 侧（`oldName`）被改成新名，别名 `alias` 保持不变。
 */



let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const DEF = `export function oldName(n) {
  return n + 1;
}
`;
const USE = `import { oldName as alias } from "./xf-def.js";

export function use() {
  return alias(1);
}
`;
const USE2 = `import { oldName } from "./xf-def.js";

export function use2() {
  return oldName(2);
}
`;


  it("改导出名时：imported 侧被改、别名不被改；改本地别名时：只改本地，不得连坐改目标模块的导出", async () => {
  {
    h = await startLspWithFiles({ "xf-def.js": DEF, "xf-use.js": USE, "xf-use2.js": USE2 });
    const edits = editsOf(
      h.req("textDocument/rename", {
        textDocument: { uri: h.uri("xf-def.js") },
        position: { line: 0, character: 16 }, // oldName
        newName: "newName",
      }),
    );
    // xf-use.js：import 说明符的 imported 侧 oldName → newName
    expect(edits).toContainEqual({
      file: "xf-use.js",
      line: 0,
      character: 9,
      endLine: 0,
      endCharacter: 16,
      newText: "newName",
    });
    // xf-use.js：别名 alias 不得被改
    expect(
      edits.filter((e) => e.file === "xf-use.js" && e.character === 20),
    ).toEqual([]);
    // 别名的调用点也不得被改（本地名没变）
    expect(
      edits.filter((e) => e.file === "xf-use.js" && e.line === 3),
    ).toEqual([]);
    // xf-use2.js（无别名对照）：import 与调用点两处都改
    expect(edits).toContainEqual({
      file: "xf-use2.js",
      line: 0,
      character: 9,
      endLine: 0,
      endCharacter: 16,
      newText: "newName",
    });
    expect(edits).toContainEqual({
      file: "xf-use2.js",
      line: 3,
      character: 9,
      endLine: 3,
      endCharacter: 16,
      newText: "newName",
    });
  }
  {
    h = await startLspWithFiles({ "xf-def.js": DEF, "xf-use.js": USE, "xf-use2.js": USE2 });
    const edits = editsOf(
      h.req("textDocument/rename", {
        textDocument: { uri: h.uri("xf-use.js") },
        position: { line: 0, character: 20 }, // alias
        newName: "newAlias",
      }),
    );
    expect(
      edits.filter((e) => e.file === "xf-def.js" || e.file === "xf-use2.js"),
    ).toEqual([]);
    expect(edits).toContainEqual({
      file: "xf-use.js",
      line: 0,
      character: 20,
      endLine: 0,
      endCharacter: 25,
      newText: "newAlias",
    });
    expect(edits).toContainEqual({
      file: "xf-use.js",
      line: 3,
      character: 9,
      endLine: 3,
      endCharacter: 14,
      newText: "newAlias",
    });
  }
});


});


// ---------------------------------------------------------------------------
// rename 校验新名字（语法层）
// ---------------------------------------------------------------------------
describe("rename 校验新名字（语法层）", () => {
/**
 * `textDocument/rename` **从不校验新名字** ⇒ 一次改名就能把源码
 * 改成**非法 JavaScript**（重复声明 / 非法标识符 / 空名 / 保留字），
 * `node --check` 直接 `SyntaxError`。
 *
 * 根因：`onRenameRequest`（`server-navigation.ts`）拿到 `params.newName` 后
 * **直接**当替换文本用，全程无标识符合法性 / 保留字校验。
 *
 * 修法（**只做语法层**，零跨片）：① 合法 JS 标识符
 * （`/^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u`）；② 非保留字；
 * ③ 非空。⇒ 非法新名**不产出任何编辑**（返回 `null`）。
 *
 * ⚠ **「与同作用域已有绑定冲突」（重复声明）本族不做** —— 它需要作用域模型
 * （`buildSymbolTable`，片 A 的地盘）⇒ 登记为独立后续项。本钉**不断言**
 * 重复声明被拒（那会与 AGENT-CONTEXT §4 的裁决冲突）。
 */



const SRC = `export const alpha = 1;
export const beta = 2;
`;

/** `alpha` 的声明位（行 0，列 13）。 */
const ALPHA_POS = { line: 0, character: 13 };

type RenameResult = { changes: Record<string, Array<{ range: unknown; newText: string }>> } | null;


  it("非法标识符 ⇒ 不产出任何编辑；空名 ⇒ 不产出任何编辑；保留字 ⇒ 不产出任何编辑；合法新名 ⇒ 仍然正常改名（不得误伤）；合法但非常规的标识符（$ / _ / Unicode）⇒ 仍然放行", async () => {
  {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("a.js") },
        position: ALPHA_POS,
        newName: "1bad",
      }) as RenameResult;
      expect(res, "非法标识符 '1bad' 仍产出了编辑").toBeNull();
    });
  }
  {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("a.js") },
        position: ALPHA_POS,
        newName: "",
      }) as RenameResult;
      expect(res, "空名仍产出了编辑").toBeNull();
    });
  }
  {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      for (const word of ["class", "const", "function", "return", "await", "yield"]) {
        const res = req("textDocument/rename")({
          textDocument: { uri: uri("a.js") },
          position: ALPHA_POS,
          newName: word,
        }) as RenameResult;
        expect(res, `保留字 '${word}' 仍产出了编辑`).toBeNull();
      }
    });
  }
  {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("a.js") },
        position: ALPHA_POS,
        newName: "alphaRenamed",
      }) as RenameResult;
      expect(res, "合法新名被误拒").toBeTruthy();
      const changes = res!.changes ?? {};
      const edits = Object.entries(changes).flatMap(([u, list]) =>
        list.map((e) => `${u} ${JSON.stringify(e.newText)}`),
      );
      expect(edits.length, "合法改名没有编辑").toBeGreaterThan(0);
      expect(edits.every((e) => e.includes("alphaRenamed"))).toBe(true);
    });
  }
  {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      for (const name of ["$alpha", "_alpha", "αlpha"]) {
        const res = req("textDocument/rename")({
          textDocument: { uri: uri("a.js") },
          position: ALPHA_POS,
          newName: name,
        }) as RenameResult;
        expect(res, `合法标识符 '${name}' 被误拒`).toBeTruthy();
      }
    });
  }
});





});

// ---------------------------------------------------------------------------
// 改名冲突校验覆盖**编辑集里的每个文件**
// ---------------------------------------------------------------------------
describe("改名冲突：编辑集逐文件校验", () => {
  const LIB = `export const shared = 1;\n`;
  /** 导入方：模块作用域已有同名绑定（与对照组唯一差异 = `const sharedLocal`） */
  const THIRD_COLLIDE = `import { shared } from "./lib.js";

const sharedLocal = 5;

export function h() {
  return shared + sharedLocal;
}
`;
  const THIRD_OK = `import { shared } from "./lib.js";

export function h() {
  return shared;
}
`;
  type RenameResult = { changes?: Record<string, Array<{ newText: string }>> } | null;

  it("导入方已有同名模块级绑定 ⇒ 拒绝改名（不产出会把该文件改成重复声明的编辑集）；对照组：无该绑定 ⇒ 正常编辑（BUG-062）", async () => {
    {
      await withLspServer({ "lib.js": LIB, "third.js": THIRD_COLLIDE }, async ({ req, uri }) => {
        const res = req("textDocument/rename")({
          textDocument: { uri: uri("lib.js") },
          position: { line: 0, character: 13 },
          newName: "sharedLocal",
        }) as RenameResult;
        // 旧实现只校验目标文件 / 定义文件 ⇒ 这里返回一个把 third.js 改成
        // `import { sharedLocal } …` + `const sharedLocal = 5` 的编辑集
        // ⇒ 应用后 `Identifier 'sharedLocal' has already been declared`
        expect(res).toBeNull();
      });
    }
    {
      await withLspServer({ "lib.js": LIB, "third.js": THIRD_OK }, async ({ req, uri }) => {
        const res = req("textDocument/rename")({
          textDocument: { uri: uri("lib.js") },
          position: { line: 0, character: 13 },
          newName: "sharedLocal",
        }) as RenameResult;
        expect(res).not.toBeNull();
        const edits = Object.values(res!.changes ?? {}).flat();
        expect(edits.map((e) => e.newText)).toEqual(["sharedLocal", "sharedLocal", "sharedLocal"]);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// re-export barrel：references / definition / rename 不得在中转处断链
// ---------------------------------------------------------------------------
describe("re-export barrel 的导航与改名面", () => {
/**
 * importer 集合只认「import 边**直接**解析到定义文件」的边。
 *
 * ```js
 * // lib.js
 * export class Box { … }
 * // barrel.js
 * export { Box } from "./lib.js";
 * // app.js
 * import { Box } from "./barrel.js";
 * ```
 *
 * 旧口径在 barrel 处断链：
 * - `references(lib.js 的 Box)` ⇒ 只有 lib + barrel 的说明符，**app 不在**；
 * - `definition(app.js 的 new Box)` ⇒ 报 barrel.js（位置却是 lib 的坐标）；
 * - `rename(lib.js 的 Box)` ⇒ WorkspaceEdit 不含 app.js ⇒ 应用后
 *   `node` 在模块链接期抛 `does not provide an export named 'Box'`
 *   （`node --check` 看不出来）。
 *
 * 钉：三面都必须穿过 barrel；多跳同名 barrel 同样要跟住；别名 re-export
 * （`export { Box as Crate }`）只改那条边、不连坐 `Crate` 的 importer
 * （`Crate` 是另一个身份，与 `export { hidden as visible }` 同口径）。
 */
let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const LIB = `export class Box { constructor(v) { this.v = v; } }
export function make(a) { return new Box(a); }
`;
const BARREL = `export { Box, make } from "./lib.js";
`;
const APP = `import { Box, make } from "./barrel.js";
export const b = new Box(1);
export const m = make(2);
`;

  it("references / definition / rename 穿过同名 barrel；多跳同样跟住", async () => {
  {
    h = await startLspWithFiles({ "lib.js": LIB, "barrel.js": BARREL, "app.js": APP });
    const refs = locationsOf(
      h.req("textDocument/references", {
        textDocument: { uri: h.uri("lib.js") },
        position: { line: 0, character: 13 }, // export class Box
        context: { includeDeclaration: true },
      }),
    );
    // barrel 的说明符
    expect(refs).toContainEqual({ file: "barrel.js", line: 0, character: 9, endLine: 0, endCharacter: 12 });
    // app 的 import 说明符 + 使用处（旧口径两处都不在）
    expect(refs).toContainEqual({ file: "app.js", line: 0, character: 9, endLine: 0, endCharacter: 12 });
    expect(refs).toContainEqual({ file: "app.js", line: 1, character: 21, endLine: 1, endCharacter: 24 });
  }
  {
    h = await startLspWithFiles({ "lib.js": LIB, "barrel.js": BARREL, "app.js": APP });
    const defs = locationsOf(
      h.req("textDocument/definition", {
        textDocument: { uri: h.uri("app.js") },
        position: { line: 1, character: 21 }, // new Box(1)
      }),
    );
    // 真正的声明在 lib.js（旧口径报 barrel.js + lib 的坐标）
    expect(defs[0]).toEqual({ file: "lib.js", line: 0, character: 13, endLine: 0, endCharacter: 16 });
  }
  {
    h = await startLspWithFiles({ "lib.js": LIB, "barrel.js": BARREL, "app.js": APP });
    const edits = editsOf(
      h.req("textDocument/rename", {
        textDocument: { uri: h.uri("lib.js") },
        position: { line: 0, character: 14 },
        newName: "Crate",
      }),
    );
    // 定义 + lib 内部使用 + barrel 说明符 + app 的 import 与使用
    expect(edits).toContainEqual({ file: "lib.js", line: 0, character: 13, endLine: 0, endCharacter: 16, newText: "Crate" });
    expect(edits).toContainEqual({ file: "lib.js", line: 1, character: 37, endLine: 1, endCharacter: 40, newText: "Crate" });
    expect(edits).toContainEqual({ file: "barrel.js", line: 0, character: 9, endLine: 0, endCharacter: 12, newText: "Crate" });
    expect(edits).toContainEqual({ file: "app.js", line: 0, character: 9, endLine: 0, endCharacter: 12, newText: "Crate" });
    expect(edits).toContainEqual({ file: "app.js", line: 1, character: 21, endLine: 1, endCharacter: 24, newText: "Crate" });
  }
  {
    // 多跳 barrel：lib ← inner ← barrel ← app
    const INNER = `export { Box } from "./lib.js";\n`;
    const BARREL2 = `export { Box } from "./inner.js";\n`;
    h = await startLspWithFiles({ "lib.js": LIB, "inner.js": INNER, "barrel.js": BARREL2, "app.js": APP });
    const edits = editsOf(
      h.req("textDocument/rename", {
        textDocument: { uri: h.uri("app.js") },
        position: { line: 1, character: 21 }, // new Box(1)
        newName: "Crate",
      }),
    );
    for (const file of ["lib.js", "inner.js", "barrel.js", "app.js"]) {
      expect(edits.some((e) => e.file === file)).toBe(true);
    }
  }
  }, 120000);

  it("别名 re-export：只改那条边，不连坐别名 importer", async () => {
    const INNER = `export { Box as Crate } from "./lib.js";\n`;
    const APP2 = `import { Crate } from "./inner.js";\nexport const c = new Crate(1);\n`;
    h = await startLspWithFiles({ "lib.js": LIB, "inner.js": INNER, "app.js": APP2 });
    const edits = editsOf(
      h.req("textDocument/rename", {
        textDocument: { uri: h.uri("lib.js") },
        position: { line: 0, character: 14 },
        newName: "Zed",
      }),
    );
    // lib 的声明与内部使用
    expect(edits).toContainEqual({ file: "lib.js", line: 0, character: 13, endLine: 0, endCharacter: 16, newText: "Zed" });
    // inner 的**导入侧**（`Box`）改成 Zed，导出名 `Crate` 不动
    expect(edits).toContainEqual({ file: "inner.js", line: 0, character: 9, endLine: 0, endCharacter: 12, newText: "Zed" });
    // app 的 `Crate` 是另一个身份 ⇒ 不得编辑
    expect(edits.some((e) => e.file === "app.js")).toBe(false);
  }, 120000);
});
