/**
 * 模块套件：hover/接收者边界面（本地/字面量/嵌套/非 ASCII/私有成员/可选参数）。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLspInjection } from "../agent-tools.ts";
import { getHoverAtPosition } from "../lsp-surface/hover.ts";
import { withLspServer, withTempDir } from "./helpers.ts";
import { makeParamOptionalAt } from "../refactor-b2.ts";
import { applyEdits, runNudoCheck, nodeCheck, runModule } from "./lsp-bug-r90b-harness.ts";
import { parse } from "@nudojs/parser";
import { buildSymbolTable, findDefinition, findReferences } from "../symbols.ts";
import { openLspDocument, requestCompletion } from "./lsp-bug-d4-harness.ts";

// ---------------------------------------------------------------------------
// Bug 024 — 协议面 hover 必须带注入包（@nudo:mock 覆盖表）
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 024 — 协议面 hover 必须带注入包（@nudo:mock 覆盖表）", () => {
/**
 * Bug 024 —— LSP **协议面** hover 从不传 `inject` ⇒ `@nudo:mock` 覆盖表缺席
 * ⇒ 推导链塌缩成 `unknown`（Nudo 词汇里 = 「推断失败」），而 `nudo check`
 * 对同一函数给出精确类型。
 *
 * 已有回归 `lsp-bug-786-inject-handoff.test.ts` 只钉了 **agent 工具面**
 * （`buildLspInjection` 产物 + agent hover 载荷）⇒ 协议装配器漏传也没人发现。
 *
 * 修复：`server-ide.ts` 的协议 hover / inlayHint 用
 * `buildLspInjection(filePath, source, …)` 与 agent 面同源装配注入包。
 * 本钉打的是**真实 server 协议面**：hover 签名行必须是
 * `getUser() => { id: 1, name: "ada" }`，不得是 `unknown`。
 */








/** 与 `tmp/repro/bug-024/mockfx.js` 逐字同文（hover 坐标依赖固定行号） */
const SRC = [
  "/**",
  ' * @nudo:mock dep = (x) => ({ id: 1, name: "ada" })',
  " */",
  "export function getUser() {",
  '  return dep("u");',
  "}",
  "",
].join("\n");

/** `nudo check` 签名行（= 注入包在场时的精确类型） */
const PRECISE_SIG = 'getUser() => { id: 1, name: "ada" }';

type Hover = { contents: { value: string } } | null;

/** hover 的 ```nudo 代码块第一行（签名行） */
function nudoSigLine(contents: string): string {
  const lines = contents.split("\n");
  const idx = lines.indexOf("```nudo");
  return idx >= 0 ? (lines[idx + 1] ?? "") : "";
}

describe("Bug 024 — 协议面 hover 必须带注入包（@nudo:mock 覆盖表）", () => {
  it("真实 server 的 hover 签名行 = check 精确类型（不是 unknown）", async () => {
    await withLspServer({ "mockfx.js": SRC }, async ({ req, uri }) => {
      const res = req("textDocument/hover")({
        textDocument: { uri: uri("mockfx.js") },
        position: { line: 3, character: 16 }, // `export function getUser` 的 getUser
      }) as Hover;
      const sig = nudoSigLine(res?.contents.value ?? "");
      expect(sig).toBe(PRECISE_SIG);
      expect(sig).not.toContain("unknown");
    });
  });

  it("纯装配面：注入包是精确类型的唯一来源（缺省 ⇒ unknown，传入 ⇒ 精确）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug024-"));
    try {
      const file = join(dir, "mockfx.js");
      writeFileSync(file, SRC, "utf-8");
      // `getHoverAtPosition` 的 line 参数是 **1-based**（= LSP position.line + 1）
      const withoutInject = getHoverAtPosition(file, SRC, 4, 16)?.signature;
      // 缺省 inject = 行内指令全部缺席 ⇒ 被 mock 的 dep 成未绑定名 ⇒ 推断失败
      expect(withoutInject).toBe("getUser() => unknown  throws ReferenceError");

      const withInject = getHoverAtPosition(file, SRC, 4, 16, undefined, {
        inject: buildLspInjection(file, SRC),
      })?.signature;
      expect(withInject).toBe(PRECISE_SIG);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// Bug 034 — 类方法 hover 的 throws 尾缀与 check 同源
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 034 — 类方法 hover 的 throws 尾缀与 check 同源", () => {
/**
 * Bug 034 —— LSP hover 对**类方法**丢掉 `throws` 尾缀 ⇒ IDE 说「total」
 * 而 `nudo check` 说「may throw」（`f * 2` 里 `f: any` ⇒ ToNumeric 强转 ⇒
 * `TypeError`）。
 *
 * 根因：throws 只从 service 的运行时见证取（`entryThrowsAbs` / `entry@`），
 * 而 service 从不求值类方法体（点号名 `C.m` 的入口求值派发不到）⇒ 证据恒空。
 *
 * 修复：hover 的返回位 + throws 尾缀改读 `checkSource` 的签名（与门禁同源）。
 * 本钉要求类方法 hover 签名行与 `nudo check` 签名行**逐字同形**
 * （`PUBLIC_API.md` 的 “check-identical signature” 承诺）。
 */







/** 与 `tmp/repro/bug-034/cls.js` 逐字同文 */
const SRC = ["export class C {", "  m(f) { return f * 2; }", "}", ""].join("\n");

/** `nudo check` 的签名行（core formatCheckReport）：`name(params) => ret  throws X` */
const CHECK_SIG = "C.m(f: any) => number  throws TypeError";

type Hover = { contents: { value: string } } | null;

/** hover 的 ```nudo 代码块第一行（签名行） */
function nudoSigLine(contents: string): string {
  const lines = contents.split("\n");
  const idx = lines.indexOf("```nudo");
  return idx >= 0 ? (lines[idx + 1] ?? "") : "";
}

describe("Bug 034 — 类方法 hover 的 throws 尾缀与 check 同源", () => {
  it("纯装配面：类方法 hover 签名行 = check 签名行（含 throws 尾缀）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug034-"));
    try {
      const file = join(dir, "cls.js");
      writeFileSync(file, SRC, "utf-8");
      // line 是 **1-based**（= LSP position.line + 1）；column 0-based = 2（`m`）
      const hover = getHoverAtPosition(file, SRC, 2, 2);
      expect(hover?.signature).toBe(CHECK_SIG);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("真实 server 协议面：hover 内容里的签名行同样带 `throws TypeError`", async () => {
    await withLspServer({ "cls.js": SRC }, async ({ req, uri }) => {
      const res = req("textDocument/hover")({
        textDocument: { uri: uri("cls.js") },
        position: { line: 1, character: 2 }, // 0-based 行 1 = `m(f) { … }`；列 2 = `m`
      }) as Hover;
      const sig = nudoSigLine(res?.contents.value ?? "");
      expect(sig).toBe(CHECK_SIG);
      // 尾缀形态：两个空格 + `throws <name>`
      expect(sig).toContain("  throws TypeError");
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 1007 — 私有成员 #name 不再解析到无关的同名绑定
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 1007 — 私有成员 #name 不再解析到无关的同名绑定", () => {
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
});

// ---------------------------------------------------------------------------
// Bug 1024 · make optional 保留 TS 类型标注
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 1024 · make optional 保留 TS 类型标注", () => {
/**
 * Bug 1024 —— 「Change signature: make `'x'` optional」打在 **TypeScript 形参**上
 * ⇒ 编辑范围覆盖 `x: number` **整段** ⇒ **静默删掉用户的类型标注**。
 *
 * 根因（`packages/lsp/src/refactor-b2.ts` 的 `makeParamOptionalAt`）：
 * `strip-types` 剥 TS 时**只删 `TSTypeAnnotation` 节点、不改写 `Identifier` 的
 * `loc`** ⇒ 剥完后区间仍是 `x: number`；而 `makeParamOptionalAt` 把它**当「标识符
 * 区间」**直接用，再用 `${h.name} = undefined` **整段覆盖** ⇒ 类型标注被当作标识符
 * 的一部分一起抹掉。
 *
 * 修法：把类型标注**拼回**新文本 —— 节点上的旁路 `nudoTypeText`（core
 * `strip-types.ts` 挂载，**零新增 core 导出**）给出标注文本 ⇒ 新文本是
 * `x: number = undefined`。
 *
 * ⚠ 勘误（族 23 共享上下文 §4 勘误表第 4 行）：「静默」只指 **LSP 侧**（无提示、
 * 无 diff 预览）；`nudo check` 会从 0 error 翻成 1 error（`scaled(x: any, label:
 * string) => number throws TypeError`）⇒ 本钉**断言门禁不再变红**（改后仍 0 error），
 * 并把「改前会变红」钉成对照。
 *
 * oracle（动作面 / 门禁面）：
 *   改前 edit[0] = [0:23 → 0:32] "x = undefined"（覆盖 "x: number" ⇒ 标注被删）
 *        ⇒ `nudo check` → 1 error（`nudo:entry-may-throw`）
 *   改后 edit[0] = [0:23 → 0:32] "x: number = undefined"（标注保留）
 *        ⇒ `nudo check` → 0 error
 */







const SRC = `export function scaled(x: number, label: string): number {
  return x * 2;
}
`;

/** 光标：第 1 行（1 基）的 `x`（0 基列 23） */
const LINE = 1;
const COLUMN = 23;

describe("Bug 1024 · make optional 保留 TS 类型标注", () => {
  it("新文本把类型标注拼回去", () => {
    const r = makeParamOptionalAt(SRC, LINE, COLUMN);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    expect(r.title).toBe("Change signature: make 'x' optional");
    expect(r.edits[0]!.newText).toBe("x: number = undefined");
    // 区间仍是「标识符（含标注）」的区间 —— 但**不再**用纯标识符文本覆盖它
    expect(r.edits[0]!.range).toEqual({
      start: { line: 0, character: 23 },
      end: { line: 0, character: 32 },
    });
  });

  it("应用后：类型标注仍在（`x: number = undefined`）", () => {
    const r = makeParamOptionalAt(SRC, LINE, COLUMN);
    if (!r || !("edits" in r)) return;
    const patched = applyEdits(SRC, r.edits);
    expect(patched).toContain("scaled(x: number = undefined, label: string): number");
    expect(patched).not.toContain("scaled(x = undefined");
  });

  it("门禁面：应用后 `nudo check` 仍是 0 error（改前会翻成 1 error）", () => {
    const r = makeParamOptionalAt(SRC, LINE, COLUMN);
    if (!r || !("edits" in r)) return;
    const patched = applyEdits(SRC, r.edits);
    withTempDir("nudo-b2-1024-", (dir) => {
      const after = join(dir, "after.ts");
      const before = join(dir, "before.ts");
      writeFileSync(after, patched, "utf-8");
      // 「改前」形态：类型标注被抹掉（`x = undefined`）
      writeFileSync(
        before,
        patched.replace("x: number = undefined", "x = undefined"),
        "utf-8",
      );
      const afterRes = runNudoCheck(after);
      const beforeRes = runNudoCheck(before);
      expect(afterRes.code).toBe(0);
      expect(afterRes.stdout).toContain("0 error");
      // 改前的症状（勘误）：门禁从 0 error 翻成 1 error（`nudo:entry-may-throw`）
      expect(beforeRes.code).toBe(1);
      expect(beforeRes.stdout).toContain("nudo:entry-may-throw");
    });
  });

  it("协议面：codeAction 给出的 rewrite 文本保留标注", async () => {
    await withLspServer({ "a.ts": SRC }, async ({ req, uri }) => {
      const actions = req("textDocument/codeAction")({
        textDocument: { uri: uri("a.ts") },
        range: {
          start: { line: LINE - 1, character: COLUMN },
          end: { line: LINE - 1, character: COLUMN },
        },
        context: { diagnostics: [] },
      }) as Array<{
        title: string;
        kind?: string;
        edit?: { changes: Record<string, Array<{ newText: string }>> };
      }>;
      const rewrite = actions.find((a) => a.kind === "refactor.rewrite");
      expect(rewrite).toBeDefined();
      expect(rewrite!.edit!.changes[uri("a.ts")]![0]!.newText).toBe(
        "x: number = undefined",
      );
    });
  });

  it("对照：纯 JS 形参的行为不变（`x = undefined`）", () => {
    const js = `export function scaled(x, label) {
  return x * 2;
}
`;
    const r = makeParamOptionalAt(js, 1, 23);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    expect(r.edits[0]!.newText).toBe("x = undefined");
  });
});
});

// ---------------------------------------------------------------------------
// Bug 709 — 遮蔽的同名绑定按作用域解析
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 709 — 遮蔽的同名绑定按作用域解析", () => {
/**
 * Bug 709 回归钉：符号表按**名字**索引 ⇒ **遮蔽**的同名局部变量上 F12 /
 * Find-references 会落到**另一个作用域**的声明。
 *
 * 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）：
 *   源：
 *     export function a() {
 *       const v = 1;
 *       return v;
 *     }
 *     export function b() {
 *       const v = 2;
 *       return v;
 *     }
 *   definition on `v`（a 内）⇒ 跳到 **b 里的 v** ❌（应跳 a 里的 v）
 *   references on `v`（a 内）⇒ [b 的 v 声明, a 的 v 声明, a 的 v 用点] ❌
 *     （混进 b 的声明）
 *
 * 根因：`buildSymbolTable` 的 `definitions` 是 `Map<string, SymbolInfo>` ——
 * 无作用域维度，`VariableDeclarator` 无条件 `definitions.set(name, …)`
 * **覆盖**先声明 ⇒ 后声明的 `v`（b 里的）成为唯一入口。
 *
 * 修法：定义按**作用域路径**存（`name@行:列`），同名绑定在不同作用域各存
 * 一条；查定义时按**光标所在作用域**取最内层的那条。
 */





const SHADOW_SRC = `export function a() {
  const v = 1;
  return v;
}

export function b() {
  const v = 2;
  return v;
}
`;

describe("Bug 709 — 遮蔽的同名绑定按作用域解析", () => {
  it("buildSymbolTable：同名绑定各存一条（不被覆盖）", () => {
    const ast = parse(SHADOW_SRC);
    const table = buildSymbolTable(ast, "file:///t/s.js");
    // 作用域路径键：`v@<作用域起点>` —— a 内与 b 内各一条
    const scoped = [...table.definitions.keys()].filter((k) => k.startsWith("v@"));
    expect(scoped.length).toBe(2);
    // 两条指向不同作用域里的不同声明
    const lines = scoped.map((k) => table.definitions.get(k)!.loc.start.line);
    expect(lines.sort()).toEqual([2, 7]);
  });

  it("findDefinition：按光标所在作用域取最内层的定义", () => {
    const ast = parse(SHADOW_SRC);
    const table = buildSymbolTable(ast, "file:///t/s.js");
    // a 内的 v（声明在第 2 行）
    const inA = findDefinition(table, "v", { line: 2, column: 8 });
    expect(inA?.loc.start.line).toBe(2);
    // b 内的 v（声明在第 7 行）
    const inB = findDefinition(table, "v", { line: 7, column: 8 });
    expect(inB?.loc.start.line).toBe(7);
  });

  it("findReferences：只返回光标所在作用域的引用", () => {
    const ast = parse(SHADOW_SRC);
    const table = buildSymbolTable(ast, "file:///t/s.js");
    const refsA = findReferences(table, "v", { line: 2, column: 8 });
    expect(refsA.length).toBeGreaterThanOrEqual(1);
    for (const r of refsA) expect(r.loc.start.line).toBeLessThanOrEqual(3);
  });

  it("协议面：definition on 遮蔽的 `v` 跳到本作用域的声明", async () => {
    await withLspServer({ "shadow.js": SHADOW_SRC }, async ({ req, uri }) => {
      const atA = req("textDocument/definition")({
        textDocument: { uri: uri("shadow.js") },
        position: { line: 2, character: 9 },
      }) as any[];
      expect(Array.isArray(atA)).toBe(true);
      expect(atA.length).toBeGreaterThanOrEqual(1);
      expect(atA[0]!.uri).toBe(uri("shadow.js"));
      // a 里的 v 声明在第 2 行（0 基 = 1）
      expect(atA[0]!.range.start.line).toBe(1);
      expect(atA[0]!.range.start.character).toBe(8);

      const atB = req("textDocument/definition")({
        textDocument: { uri: uri("shadow.js") },
        position: { line: 7, character: 9 },
      }) as any[];
      expect(atB.length).toBeGreaterThanOrEqual(1);
      // b 里的 v 声明在第 7 行（0 基 = 6）
      expect(atB[0]!.range.start.line).toBe(6);
      expect(atB[0]!.range.start.character).toBe(8);
    });
  });

  it("协议面：references on 遮蔽的 `v` 不混进另一个作用域的声明", async () => {
    await withLspServer({ "shadow.js": SHADOW_SRC }, async ({ req, uri }) => {
      const refs = req("textDocument/references")({
        textDocument: { uri: uri("shadow.js") },
        position: { line: 2, character: 9 },
        context: { includeDeclaration: true },
      }) as any[];
      const lines = refs.map((r) => r.range.start.line);
      // b 里的声明（第 7 行 / 0 基 6）不得出现
      expect(lines).not.toContain(6);
      // a 里的声明（0 基 1）与用点（0 基 2）都在
      expect(lines).toContain(1);
      expect(lines).toContain(2);
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 739 · make optional 必须补括号（无括号箭头形参）
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 739 · make optional 必须补括号（无括号箭头形参）", () => {
/**
 * Bug 739 —— 「Change signature: make `'x'` optional」打在**无括号箭头形参**上
 * ⇒ 产出 `x = undefined => …`（被重新解析成**赋值**）⇒ 运行时 `ReferenceError`。
 *
 * 根因（`packages/lsp/src/refactor-b2.ts` 的 `makeParamOptionalAt`）：编辑文本
 * **无条件**把 `${name} = undefined` 插到形参位，**不检查该形参是否被括号包裹**
 * ⇒ `items.map(v => …)` 的 `v` 变成 `v = undefined => …`。
 *
 * 修法（`isBareArrowParam`）：先判该形参是否被括号包裹；**无括号箭头形参必须补括号**
 * ⇒ 产出 `(v = undefined) => …`（两种形态都合法，且语义是「可选形参」）。
 *
 * oracle（动作面 / 语义面）：
 *   改前 edit[0] = [1:24 → 1:25] "v = undefined" ⇒ 应用后 `items.map(v = undefined => v * 3)`
 *        ⇒ `node --check` 仍 OK，但运行即 `ReferenceError: v is not defined`
 *   改后 edit[0] = [1:24 → 1:25] "(v = undefined)" ⇒ 应用后 `items.map((v = undefined) => v * 3)`
 *        ⇒ 运行 `scale([1,2,3])` = [3,6,9]
 */





const SRC = `export function scale(items) {
  const out = items.map(v => v * 3);
  return out;
}
`;

/** 光标：第 2 行（1 基）的 `v`（0 基列 24） */
const LINE = 2;
const COLUMN = 24;

describe("Bug 739 · make optional 必须补括号（无括号箭头形参）", () => {
  it("无括号箭头形参 ⇒ 新文本带括号", () => {
    const r = makeParamOptionalAt(SRC, LINE, COLUMN);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    expect(r.title).toBe("Change signature: make 'v' optional");
    expect(r.edits[0]!.newText).toBe("(v = undefined)");
    expect(r.edits[0]!.range).toEqual({
      start: { line: 1, character: 24 },
      end: { line: 1, character: 25 },
    });
  });

  it("应用后：箭头形参合法，运行时结果不变", () => {
    const r = makeParamOptionalAt(SRC, LINE, COLUMN);
    if (!r || !("edits" in r)) return;
    const patched = applyEdits(SRC, r.edits);
    expect(patched).toContain("items.map((v = undefined) => v * 3)");
    expect(patched).not.toContain("v = undefined =>");
    expect(nodeCheck(patched)).toBe("OK");
    expect(runModule(patched, "M.scale([1,2,3])")).toBe("[3,6,9]");
  });

  it("协议面：codeAction 给出的 rewrite 文本带括号", async () => {
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
        edit?: { changes: Record<string, Array<{ newText: string }>> };
      }>;
      const rewrite = actions.find((a) => a.kind === "refactor.rewrite");
      expect(rewrite).toBeDefined();
      expect(rewrite!.edit!.changes[uri("a.js")]![0]!.newText).toBe("(v = undefined)");
    });
  });

  it("对照：已带括号的箭头形参保持原行为（不重复加括号）", () => {
    const paren = `export function scale(items) {
  const out = items.map((v) => v * 3);
  return out;
}
`;
    const r = makeParamOptionalAt(paren, 2, 25);
    expect(r && "edits" in r).toBe(true);
    if (!r || !("edits" in r)) return;
    expect(r.edits[0]!.newText).toBe("v = undefined");
    const patched = applyEdits(paren, r.edits);
    expect(patched).toContain("items.map((v = undefined) => v * 3)");
    expect(runModule(patched, "M.scale([1,2,3])")).toBe("[3,6,9]");
  });
});
});

// ---------------------------------------------------------------------------
// Bug 771 — sum 接收者：原始值臂让交集判空
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 771 — sum 接收者：原始值臂让交集判空", () => {
/**
 * Bug 771 — union（sum）接收者的补全**跳过「零成员」的那一支**。
 *
 * 症状：`u = { x, y } | 5`（对象臂 | **原始值臂**）在 `u.` 处给出 `x` / `y`
 * ⇒ 用户接受补全后 `u.x` 在原始值臂上是 TypeError（补全 detail 只显示对象臂
 * 的类型，静默误导）。
 *
 * 期望：sum 接收者的候选是**各臂的交集**——原始值臂**没有任何属性**
 * ⇒ 交集必空 ⇒ `u.` 无候选。
 *
 * 反向护栏：两臂都是对象（`{x,y} | {x}`）⇒ 交集 = `x`（不能被一起清零）。
 */



const SRC = [
  `const aObj = { x: 1, y: 9 };`,
  `const uPrim = Math.random() > 0.5 ? aObj : 5;`,
  `const uStr = Math.random() > 0.5 ? aObj : "str";`,
  `const uObj = Math.random() > 0.5 ? aObj : { x: 3 };`,
  ``,
  `export function usePrim() {`,
  `  return uPrim.x;`,
  `}`,
  `export function useStr() {`,
  `  return uStr.x;`,
  `}`,
  `export function useObj() {`,
  `  return uObj.x;`,
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

describe("Bug 771 — sum 接收者：原始值臂让交集判空", () => {
  it("对象臂 | 原始值臂 ⇒ 无候选（取属性在原始值臂上是 TypeError）", async () => {
    await withLspServer({ "union.js": SRC }, async ({ req, uri }) => {
      expect(await labelsAt(req, uri("union.js"), "return uPrim.x")).toEqual([]);
    });
  });

  it("对象臂 | 字符串臂 ⇒ 无候选（字符串臂有内建成员，交集为空）", async () => {
    await withLspServer({ "union.js": SRC }, async ({ req, uri }) => {
      expect(await labelsAt(req, uri("union.js"), "return uStr.x")).toEqual([]);
    });
  });

  it("两臂都是对象 ⇒ 交集仍是公共成员 x（不能被一起清零）", async () => {
    await withLspServer({ "union.js": SRC }, async ({ req, uri }) => {
      const labels = await labelsAt(req, uri("union.js"), "return uObj.x");
      expect(labels).toContain("x");
      expect(labels).not.toContain("y");
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 772 — 嵌套成员访问的接收者是整条路径
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 772 — 嵌套成员访问的接收者是整条路径", () => {
/**
 * Bug 772 — 成员补全把嵌套成员访问的接收者取成「最后一段标识符」。
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

describe("Bug 772 — 嵌套成员访问的接收者是整条路径", () => {
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
});

// ---------------------------------------------------------------------------
// Bug 774 —— 无契约形参的 hover 回落 design §2 的 `any`
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 774 —— 无契约形参的 hover 回落 design §2 的 `any`", () => {
/**
 * Bug 774 —— 无契约函数的**形参位置 hover 完全为空**
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

describe("Bug 774 —— 无契约形参的 hover 回落 design §2 的 `any`", () => {
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
});

// ---------------------------------------------------------------------------
// Bug 782 — 非 ASCII 接收者的成员补全
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 782 — 非 ASCII 接收者的成员补全", () => {
/**
 * Bug 782 — 成员补全对**非 ASCII 接收者**失效。
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

describe("Bug 782 — 非 ASCII 接收者的成员补全", () => {
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
});

// ---------------------------------------------------------------------------
// Bug 787 — 字面量 / 括号 / 字符串接收者走内建原型表
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 787 — 字面量 / 括号 / 字符串接收者走内建原型表", () => {
/**
 * Bug 787 — 成员补全的**接收者识别**失败时回落成顶层变量表。
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

describe("Bug 787 — 字面量 / 括号 / 字符串接收者走内建原型表", () => {
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
});

// ---------------------------------------------------------------------------
// Bug 788 — prim 接收者按类型分派到内建原型表
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 788 — prim 接收者按类型分派到内建原型表", () => {
/**
 * Bug 788 — 成员补全的 **prim 分支只投影 `String`**。
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

describe("Bug 788 — prim 接收者按类型分派到内建原型表", () => {
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
});

// ---------------------------------------------------------------------------
// Bug 789 — 成员补全的接收者绑定表下沉函数体
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 789 — 成员补全的接收者绑定表下沉函数体", () => {
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
});
