/**
 * Bug 1066 — LSP 的**别名导出**（`export { a as b }`）形态：跨文件 references 丢掉
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
 *   （+ importer 的本地用法）⇒ 改完模块图仍然自洽；
 * - 本地名身份：编辑集 = 本地声明 + 导出说明符的**本地侧**（**不得**连坐
 *   importer 的 imported 侧 —— 那是导出名的身份）。
 * - 导出名位（`export { hidden as visible }` 的 `visible`）不再是死位：
 *   definition / references / prepareRename / rename 都有可导航身份。
 *
 * ⚠ 回归钉**真的落盘 + 真 import** 验（不能只断言编辑集）：改名后必须能被
 * node 以 ESM 真 import 成功、且取到正确的值。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { withLspServer } from "./helpers.ts";

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
/** importer 用点位：`  return visible;` 的 visible */
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

describe("Bug 1066 — 别名导出 export { a as b } 的 rename 改导出名（不改本地名）", () => {
  it("rename @ importer 用点位 ⇒ 改导出名 + importer 的 imported 侧，**不动** hidden 的声明", async () => {
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
  });

  it("rename @ 导出名位 ⇒ 同样改导出名 + importer 的 imported 侧（改前是 null）", async () => {
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
  });

  it("rename @ 本地名位 ⇒ 改本地名（声明 + 导出说明符本地侧），**不连坐** importer", async () => {
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
  });

  it("导出名位不再死位：definition / references / prepareRename 都有身份", async () => {
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
  });
});
