/**
 * Bug 1007 — LSP 的 **definition / references / rename** 对**类私有成员 `#name`**
 * 全部**解析到无关的同名绑定** ⇒ 私有成员**根本没被改名**，反而把**无关的导出
 * 符号跨文件改掉**并毁掉它的导出语句 ⇒ 模块图断裂。
 *
 * 根因：babel 把私有成员的键 / 用点包在 `PrivateName` 里 ⇒
 * - `isBindingIdentifier` 对 `PrivateName` 里的标识符**放行**（当成普通绑定）
 *   ⇒ `#total` 被当成普通标识符 `total`；
 * - 符号表**按名字**收定义 / 引用 ⇒ 同名的模块级 `export const total` 命中。
 * ⇒ definition 跳到无关的模块级 `total`，rename 把它连同 importer 一起改掉。
 *
 * 改后：**私有成员的身份带 `#`**（`#total`）⇒ 在**名字层面**就与同名模块级绑定
 * 分开；作用域 = **所属类**（私有名只在自己类体里可见 ⇒ 永不跨文件）。
 * - `isBindingIdentifier`：`PrivateName` **不是**普通绑定；
 * - 符号表：私有成员按 `#name` 登记定义 / 引用（声明位 + 类内用点）；
 * - `prepareRename`：placeholder 含 `#`（编辑范围仍只覆盖标识符 ⇒ `#` 保留）。
 *
 * 原生 oracle：真 LSP server 的 `textDocument/definition` / `references` /
 * `rename` / `prepareRename`。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

type Loc = {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};
type TextEdit = { range: Loc["range"]; newText: string };

const DEF = `export class Counter {
  #total() {
    return 7;
  }
  use() {
    return this.#total();
  }
}

export const total = 42;
`;

const USE = `import { total } from "./def.js";

export function read() {
  return total;
}
`;

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

/** 私有方法声明位（`  #total() {` ⇒ 标识符 total 在 col 3） */
const PRIV_DECL = offset(posOf(DEF, "#total"), 1);
/** 私有方法用点位（`    return this.#total();` ⇒ 标识符 total 在 col 17） */
const PRIV_USE = offset(posOf(DEF, "this.#total"), 6);
/** 模块级 `export const total`（对照组） */
const MODULE_TOTAL = posOf(DEF, "total = 42");

/** 列偏移 */
function offset(pos: { line: number; character: number }, dx: number): { line: number; character: number } {
  return { line: pos.line, character: pos.character + dx };
}

function rel(uri: string, root: string): string {
  const p = uri.replace(/^file:\/\//, "");
  return p.startsWith(root) ? p.slice(root.length + 1) : p;
}

describe("Bug 1007 — 私有成员 #name 不再解析到无关的同名绑定", () => {
  it("definition @ 私有成员声明位 ⇒ 私有成员自己（改前跳到模块级 export const total）", async () => {
    let defs: Loc[] = [];
    let root = "";
    await withLspServer({ "def.js": DEF, "use.js": USE }, async (ctx) => {
      root = ctx.dir;
      const res = await ctx.req("textDocument/definition")({
        textDocument: { uri: ctx.uri("def.js") },
        position: PRIV_DECL,
      });
      defs = (res ?? []) as Loc[];
    });
    expect(defs.length).toBeGreaterThanOrEqual(1);
    const def = defs[0]!;
    expect(rel(def.uri, root)).toBe("def.js");
    expect(def.range.start.line).toBe(PRIV_DECL.line);
    expect(def.range.start.character).toBe(PRIV_DECL.character);
    // ⚠ 绝不能落到模块级的 `export const total`
    expect(def.range.start.line).not.toBe(MODULE_TOTAL.line);
  });

  it("definition @ 私有成员用点位 ⇒ 私有成员声明位（改前是空）", async () => {
    let defs: Loc[] = [];
    await withLspServer({ "def.js": DEF, "use.js": USE }, async (ctx) => {
      const res = await ctx.req("textDocument/definition")({
        textDocument: { uri: ctx.uri("def.js") },
        position: PRIV_USE,
      });
      defs = (res ?? []) as Loc[];
    });
    expect(defs.length).toBeGreaterThanOrEqual(1);
    expect(defs[0]!.range.start.line).toBe(PRIV_DECL.line);
    expect(defs[0]!.range.start.character).toBe(PRIV_DECL.character);
  });

  it("references @ 私有成员 ⇒ 只有私有成员自己（不含同名模块级绑定 / 它的 importer）", async () => {
    let refs: Loc[] = [];
    let root = "";
    await withLspServer({ "def.js": DEF, "use.js": USE }, async (ctx) => {
      root = ctx.dir;
      const res = await ctx.req("textDocument/references")({
        textDocument: { uri: ctx.uri("def.js") },
        position: PRIV_DECL,
        context: { includeDeclaration: true },
      });
      refs = (res ?? []) as Loc[];
    });
    const where = refs.map((r) => `${rel(r.uri, root)}:${r.range.start.line}:${r.range.start.character}`);
    expect(where).toContain(`def.js:${PRIV_DECL.line}:${PRIV_DECL.character}`);
    expect(where).toContain(`def.js:${PRIV_USE.line}:${PRIV_USE.character}`);
    // ⚠ 同名模块级绑定与它的 importer 都不该出现
    expect(where).not.toContain(`def.js:${MODULE_TOTAL.line}:${MODULE_TOTAL.character}`);
    expect(where.some((w) => w.startsWith("use.js:"))).toBe(false);
  });

  it("rename @ 私有成员 ⇒ 只改私有成员（改前把无关的模块级导出跨文件改掉）", async () => {
    let edits: Record<string, TextEdit[]> = {};
    let root = "";
    await withLspServer({ "def.js": DEF, "use.js": USE }, async (ctx) => {
      root = ctx.dir;
      const res = await ctx.req("textDocument/rename")({
        textDocument: { uri: ctx.uri("def.js") },
        position: PRIV_DECL,
        newName: "renamed",
      });
      edits = (res?.changes ?? {}) as Record<string, TextEdit[]>;
    });
    const touched = Object.entries(edits).map(([uri, list]) => ({
      file: rel(uri, root),
      edits: list.map((e) => `${e.range.start.line}:${e.range.start.character}-${e.range.end.line}:${e.range.end.character}`),
    }));
    // 只动 def.js 里的私有成员（声明位 + 类内用点）
    expect(touched.length).toBe(1);
    expect(touched[0]!.file).toBe("def.js");
    expect(touched[0]!.edits).toContain(`${PRIV_DECL.line}:${PRIV_DECL.character}-${PRIV_DECL.line}:${PRIV_DECL.character + 5}`);
    expect(touched[0]!.edits).toContain(`${PRIV_USE.line}:${PRIV_USE.character}-${PRIV_USE.line}:${PRIV_USE.character + 5}`);
    // ⚠ 无关的模块级 `total` 与它的 importer 一个都不许动
    expect(touched.some((t) => t.file === "use.js")).toBe(false);
    expect(touched[0]!.edits).not.toContain(
      `${MODULE_TOTAL.line}:${MODULE_TOTAL.character}-${MODULE_TOTAL.line}:${MODULE_TOTAL.character + 5}`,
    );
  });

  it("prepareRename @ 私有成员 ⇒ placeholder 含 `#`（编辑范围只覆盖标识符）", async () => {
    let res: { range: Loc["range"]; placeholder: string } | null = null;
    await withLspServer({ "def.js": DEF, "use.js": USE }, async (ctx) => {
      res = (await ctx.req("textDocument/prepareRename")({
        textDocument: { uri: ctx.uri("def.js") },
        position: PRIV_DECL,
      })) as { range: Loc["range"]; placeholder: string } | null;
    });
    expect(res).toBeTruthy();
    expect(res!.placeholder).toBe("#total");
    expect(res!.range.start.character).toBe(PRIV_DECL.character);
    expect(res!.range.end.character).toBe(PRIV_DECL.character + "total".length);
  });

  it("负控制：模块级 `export const total` 仍然指向自己 + 它的 importer", async () => {
    let refs: Loc[] = [];
    let root = "";
    await withLspServer({ "def.js": DEF, "use.js": USE }, async (ctx) => {
      root = ctx.dir;
      const res = await ctx.req("textDocument/references")({
        textDocument: { uri: ctx.uri("def.js") },
        position: MODULE_TOTAL,
        context: { includeDeclaration: true },
      });
      refs = (res ?? []) as Loc[];
    });
    const where = refs.map((r) => `${rel(r.uri, root)}:${r.range.start.line}:${r.range.start.character}`);
    expect(where).toContain(`def.js:${MODULE_TOTAL.line}:${MODULE_TOTAL.character}`);
    // 模块级 total 的 importer 仍在（私有成员的修复不得牵连它）
    expect(where.some((w) => w.startsWith("use.js:"))).toBe(true);
  });
});
