/**
 * 模块套件：LSP sidecar 面（autobind/编辑 range/非法绑定/未保存缓冲/插入）。
 *
 * single-writer 因模块级 vi.mock 保留独立入口。
 */
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectConfigFingerprint, clearValidationState, makeBufferAwareLoadModule } from "../validation.ts";
import { parse } from "@nudojs/parser";
import { checkSource } from "@nudojs/core";
import { defaultLoadModule } from "@nudojs/service";
import { applyEdits, codeActionParams, entryMayThrowDiag, mountCodeActions, sidecarEdits } from "./lsp-harness-r90a.ts";
import { withTempDir, withLspServer } from "./helpers.ts";
import { startLspWithFiles, locationsOf, type LspHarness } from "./lsp-harness-d3.ts";
import { contractEmitTool } from "../agent-tools.ts";
import { findFnContractInsertPos } from "../sidecar-insert.ts";
import { resolveDefinitionLocations, findIdentifierAtPosition } from "../symbols.ts";

// ---------------------------------------------------------------------------
// Bug 487 LSP：配置指纹用归一后的 autoBind
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 487 LSP：配置指纹用归一后的 autoBind", () => {
/**
 * Bug 487 回归（LSP 面）：项目配置指纹用了**未归一**的 `autoBind`
 * （`cfg.contract?.autoBind ?? true`），而分析面读的是 **service 侧归一后**
 * 的值（`contractConfig`）⇒ 两者口径分裂。
 *
 * 后果：把 `autoBind` 写成非布尔（非法形状，如 `"false"`）时，归一回落
 * `true` ⇒ 有效行为与「不写」**完全相同**，但原始指纹不同 ⇒ 用户只改了这
 * 处无效写法也会 miss analysisCache ⇒ 全量重算（性能）＋ 行为漂移风险。
 *
 * 本文件锁：
 *  ① 非法非布尔 autoBind ⇒ 指纹与「不写 autoBind」**相同**（归一后行为相同
 *     ⇒ 指纹必须相同）；
 *  ② 合法 `autoBind: false` ⇒ 指纹**不同**（有效行为确实变了 ⇒ 必须 miss）。
 */







function project(nudo: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-487-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "p", version: "1.0.0", type: "module", ...(nudo === undefined ? {} : { nudo }) }),
    "utf-8",
  );
  return dir;
}

function fingerprintOf(dir: string): string {
  const file = join(dir, "a.js");
  writeFileSync(file, `export function f() { return 1; }\n`, "utf-8");
  return projectConfigFingerprint(file);
}

describe("Bug 487 LSP：配置指纹用归一后的 autoBind", () => {
  it("非法非布尔 autoBind ⇒ 指纹与「不写」相同（行为相同 ⇒ 不得 miss 缓存）", () => {
    const noAutoBind = project({ contract: { autoBind: true } });
    const bogusAutoBind = project({ contract: { autoBind: "false" } });
    try {
      expect(fingerprintOf(bogusAutoBind)).toBe(fingerprintOf(noAutoBind));
    } finally {
      rmSync(noAutoBind, { recursive: true, force: true });
      rmSync(bogusAutoBind, { recursive: true, force: true });
      clearValidationState();
    }
  });

  it("非法非布尔 autoBind ⇒ 指纹与「省略整个 contract」相同", () => {
    const bare = project({});
    const bogus = project({ contract: { autoBind: 0 } });
    try {
      expect(fingerprintOf(bogus)).toBe(fingerprintOf(bare));
    } finally {
      rmSync(bare, { recursive: true, force: true });
      rmSync(bogus, { recursive: true, force: true });
      clearValidationState();
    }
  });

  it("合法 autoBind:false ⇒ 指纹与 true 不同（行为确实变了 ⇒ 必须 miss）", () => {
    const on = project({ contract: { autoBind: true } });
    const off = project({ contract: { autoBind: false } });
    try {
      expect(fingerprintOf(off)).not.toBe(fingerprintOf(on));
    } finally {
      rmSync(on, { recursive: true, force: true });
      rmSync(off, { recursive: true, force: true });
      clearValidationState();
    }
  });
});
});

// ---------------------------------------------------------------------------
// Bug 743 · 侧车 quickfix 不得把侧车写成重复 export
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 743 · 侧车 quickfix 不得把侧车写成重复 export", () => {
/**
 * Bug 743 —— 侧车 quickfix 的 edit **退化成头插**（`0:0 → 0:0`）⇒ 落盘后侧车
 * 出现重复 `export const <fn>` ⇒ 侧车整体 SyntaxError ⇒ 侧车里**所有**契约
 * 一起失效（`nudo:contract-load`）⇒ 门禁从「有诊断」变成「装载失败」。
 *
 * 根因与 Bug 735 同源：`agentToolDeps` 被提前捕获（挂载期还是 `undefined`）
 * ⇒ 侧车文本读不到 ⇒ `scSource` 退化成 `""` ⇒ edit 范围只剩头插一行。
 *
 * 钉：
 * 1. 侧车 edit 必须**覆盖既有侧车全文**（追加语义：既有导出仍在）；
 * 2. 落盘后的侧车**可加载**（无重复 export ⇒ 语法合法）；
 * 3. 会写出**重复 export** 的计划**不下发**（宁可少一个 action）。
 */









const LIB_JS = `export function alpha(x) {
  return x.toFixed(2);
}

export function beta(y) {
  return y + 1;
}
`;
/** 侧车里**已有** alpha 契约 ⇒ 追加同名导出会重复 */
const LIB_SC_WITH_ALPHA = `import { fn, any, number, string, shape } from "@nudojs/core";

export const alpha = fn({ x: any() }, any());
export const beta = fn({ y: string() }, number());
`;
/** 侧车里**没有** alpha 契约 ⇒ 追加是合法的 */
const LIB_SC_WITHOUT_ALPHA = `import { fn, any, number, string, shape } from "@nudojs/core";

export const beta = fn({ y: string() }, number());
`;

describe("Bug 743 · 侧车 quickfix 不得把侧车写成重复 export", () => {
  it("侧车已有该 fn 的契约 ⇒ 不下发会写坏侧车的计划", () => {
    withTempDir("nudo-lsp-743-", (dir) => {
      writeFileSync(join(dir, "lib.js"), LIB_JS, "utf-8");
      writeFileSync(join(dir, "lib.nudo.js"), LIB_SC_WITH_ALPHA, "utf-8");
      const uri = `file://${join(dir, "lib.js")}`;
      const handler = mountCodeActions(uri, LIB_JS);
      const actions = handler(
        codeActionParams(uri, 0, [entryMayThrowDiag(0, 7, { fn: "alpha" })]),
      );
      expect(sidecarEdits(actions, uri)).toHaveLength(0);
    });
  });

  it("侧车缺该 fn 的契约 ⇒ edit 覆盖既有侧车全文，既有导出仍在且可加载", () => {
    withTempDir("nudo-lsp-743b-", (dir) => {
      const libPath = join(dir, "lib.js");
      writeFileSync(libPath, LIB_JS, "utf-8");
      writeFileSync(join(dir, "lib.nudo.js"), LIB_SC_WITHOUT_ALPHA, "utf-8");
      const uri = `file://${libPath}`;
      const handler = mountCodeActions(uri, LIB_JS);
      const actions = handler(
        codeActionParams(uri, 0, [entryMayThrowDiag(0, 7, { fn: "alpha" })]),
      );
      const edits = sidecarEdits(actions, uri);
      expect(edits.length).toBe(1);
      const e = edits[0]!;
      // 覆盖既有侧车全文（不是 0:0 → 0:0 的头插）
      expect(e.range.start).toEqual({ line: 0, character: 0 });
      expect(e.range.end.line).toBeGreaterThan(0);
      // 既有导出仍在（追加语义）
      expect(e.newText).toContain("export const beta = fn({ y: string() }, number());");
      const landed = applyEdits(LIB_SC_WITHOUT_ALPHA, edits);
      expect(landed).toContain("export const beta");
      expect(landed).toContain("export const alpha");
      // 没有重复 export ⇒ 语法合法（可加载）
      expect(() => parse(landed)).not.toThrow();
      // 语义面：侧车装载失败会报 nudo:contract-load ⇒ 这里不得出现
      writeFileSync(join(dir, "lib.nudo.js"), landed, "utf-8");
      const report = checkSource(libPath, LIB_JS, undefined, {
        loadModule: defaultLoadModule,
      });
      expect(report.issues.map((i) => i.code)).not.toContain("nudo:contract-load");
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 728 — 侧车契约定义只认引擎真正消费的绑定
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 728 — 侧车契约定义只认引擎真正消费的绑定", () => {
/**
 * Bug 728 — 侧车里**对契约毫无作用**的绑定被当成契约定义。
 *
 * 症状：`lib.nudo.js` 里 `export const positive = number().gt(0)`（值模板）
 * 不是引擎消费的契约形态（引擎只消费 `fn({ … }, …)` 形态的导出绑定，
 * 见 packages/core/src/algebra/contract.ts），但 F12 仍跳到它 ⇒ 用户
 * 改多少都不会生效（与 hover / codeLens 的 imp、CLI 的 [implicit] 矛盾）。
 */



let h: LspHarness | null = null;
afterEach(() => {
  h?.cleanup();
  h = null;
});

const LIB = `export function positive(x) {
  return x > 0;
}
`;
/** 值模板：引擎不消费（not fn() form） */
const LIB_SIDECAR_VALUE = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;
const LIB2 = `export function good(x) {
  return x > 0;
}
`;
/** fn() 形态：引擎消费的有效契约 */
const LIB2_SIDECAR_FN = `import { fn, number } from "@nudojs/core";
export const good = fn({ x: number().gt(0) }, number());
`;

describe("Bug 728 — 侧车契约定义只认引擎真正消费的绑定", () => {
  it("值模板绑定不得被当成契约定义", async () => {
    h = await startLspWithFiles({
      "lib.js": LIB,
      "lib.nudo.js": LIB_SIDECAR_VALUE,
    });
    const defs = locationsOf(
      h.req("textDocument/definition", {
        textDocument: { uri: h.uri("lib.js") },
        position: { line: 0, character: 16 }, // positive
      }),
    );
    expect(defs.filter((d) => d.file === "lib.nudo.js")).toEqual([]);
    // 本地定义仍在
    expect(defs[0]?.file).toBe("lib.js");
  });

  it("fn() 形态的导出绑定仍是契约定义（不得误伤）", async () => {
    h = await startLspWithFiles({
      "lib2.js": LIB2,
      "lib2.nudo.js": LIB2_SIDECAR_FN,
    });
    const defs = locationsOf(
      h.req("textDocument/definition", {
        textDocument: { uri: h.uri("lib2.js") },
        position: { line: 0, character: 16 }, // good
      }),
    );
    expect(defs).toContainEqual({
      file: "lib2.nudo.js",
      line: 1,
      character: 13,
      endLine: 1,
      endCharacter: 17,
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 765：emit 不得拿未保存的 buffer 覆盖磁盘
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 765：emit 不得拿未保存的 buffer 覆盖磁盘", () => {
/**
 * Bug 765 —— 「⚡ persist contract」不得按**未保存的 buffer** 写侧车。
 *
 * 症状（改前）：侧车守卫只挡了**侧车自己**的脏 buffer；源文件的脏 buffer
 * 没有对称守卫 ⇒ 侧车里落的是**未保存**的代码形状（3 参契约），
 * 磁盘上的源码一个字节没变（仍是 2 参）⇒ 门禁「形参对不上」而项目被打成
 * FAILED，且「形参对不上」被完全静默。
 *
 * 修法：写盘前比对「源文件 buffer」与「磁盘文本」——不一致就**明确报错**
 * （与侧车守卫同款：save or discard before emit），不落任何侧车。
 */






const DISK = `/**
 * @nudo:case "c" (1, 2) => 3
 */
export function add(a, b) {
  return a + b;
}
`;
/** 编辑器里未保存的 buffer：多一个形参 + 一条 case 指令。 */
const BUFFER = `/**
 * @nudo:case "c" (1, 2, 3) => 6
 */
export function add(x, y, z) {
  return x + y + z;
}
`;

describe("Bug 765：emit 不得拿未保存的 buffer 覆盖磁盘", () => {
  it("源文件 buffer 与磁盘不一致 ⇒ 拒写盘并给出可诊断的错误", async () => {
    await withLspServer({ "lib.js": DISK }, async ({ dir }) => {
      const file = join(dir, "lib.js");
      const r = await contractEmitTool(
        { file, functionName: "add", mode: "add" },
        {
          workspaceRoots: [dir],
          getOpenText: (p: string) => (p === file ? { text: BUFFER } : undefined),
        },
      );
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("unsaved buffer changes");
      // 没有侧车落盘
      expect(existsSync(join(dir, "lib.nudo.js"))).toBe(false);
      // 磁盘上的源码没被动过
      expect(readFileSync(file, "utf-8")).toBe(DISK);
    });
  });

  it("buffer 与磁盘一致 ⇒ 正常写盘（守卫不误伤）", async () => {
    await withLspServer({ "lib.js": DISK }, async ({ dir }) => {
      const file = join(dir, "lib.js");
      const r = await contractEmitTool(
        { file, functionName: "add", mode: "add" },
        {
          workspaceRoots: [dir],
          getOpenText: (p: string) => (p === file ? { text: DISK } : undefined),
        },
      );
      expect(r.isError).toBeFalsy();
      expect(existsSync(join(dir, "lib.nudo.js"))).toBe(true);
    });
  });

  it("源文件根本没有落盘（新建未保存）⇒ 同样拒写盘", async () => {
    await withLspServer({ "other.js": DISK }, async ({ dir }) => {
      const file = join(dir, "new.js");
      const r = await contractEmitTool(
        { file, functionName: "add", mode: "add" },
        {
          workspaceRoots: [dir],
          getOpenText: (p: string) => (p === file ? { text: BUFFER } : undefined),
        },
      );
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("unsaved buffer changes");
      expect(existsSync(join(dir, "new.nudo.js"))).toBe(false);
    });
  });
});
});

// ---------------------------------------------------------------------------
// findFnContractInsertPos
// ---------------------------------------------------------------------------
describe("[lsp-] findFnContractInsertPos", () => {
/**
 * `findFnContractInsertPos` 的契约（族 23 片 A / Bug 731 收口后）：
 * 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的
 * **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。
 *
 * 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。
 */
const X_Z = { param: "x", path: ["z"] };

describe("findFnContractInsertPos", () => {
  it("inserts into same-line fn({ … }) after the target param's shape brace", () => {
    const line = `export const foo = fn({ x: shape({ y: number() }) }, number());`;
    const pos = findFnContractInsertPos([line], "foo", X_Z)!;
    expect(pos.line).toBe(0);
    expect(line[pos.character - 1]).toBe("{");
    expect(line[pos.character]).toBe(" ");
    // 插入点前是 **shape 的 `{`**（不是形参表的 `{`）
    expect(line.slice(0, pos.character - 1)).toContain("shape(");
  });

  it("inserts into multiline fn(\\n  { … }", () => {
    const lines = [
      `export const foo =`,
      `  fn({`,
      `    x: shape({`,
      `      y: number()`,
      `    })`,
      `  }, number());`,
    ];
    const pos = findFnContractInsertPos(lines, "foo", X_Z)!;
    expect(pos).toEqual({ line: 2, character: lines[2]!.indexOf("{") + 1 });
  });

  it("returns null for shared shape identifier (does not walk into next export)", () => {
    const lines = [
      `export const a = fn(sharedShape, number());`,
      `export const b = fn({ y: number() }, number());`,
    ];
    expect(findFnContractInsertPos(lines, "a", X_Z)).toBeNull();
    // b 的 y 是标量契约 ⇒ 没有 shape 可补 ⇒ null（不猜位置）
    expect(findFnContractInsertPos(lines, "b", { param: "y", path: ["z"] })).toBeNull();
  });

  it("returns null when export has no fn( before next export", () => {
    const lines = [
      `export const a = someHelper(x);`,
      `export const b = fn({ y: number() }, number());`,
    ];
    expect(findFnContractInsertPos(lines, "a", X_Z)).toBeNull();
  });

  it("fnName with regex special chars still resolves (identifier equality)", () => {
    const line = `export const a$b = fn({ x: shape({ y: number() }) }, number());`;
    const pos = findFnContractInsertPos([line], "a$b", X_Z)!;
    expect(line.slice(0, pos.character - 1)).toContain("shape(");
  });

  it("returns null when contract shape is missing", () => {
    const lines = [`export const foo = fn(x, number());`];
    expect(findFnContractInsertPos(lines, "foo", X_Z)).toBeNull();
  });

  it("returns null when the field is already declared in the target shape", () => {
    const line = `export const foo = fn({ x: shape({ z: number() }) }, number());`;
    expect(findFnContractInsertPos([line], "foo", X_Z)).toBeNull();
  });

  it("string containing // does not truncate the line (URL case)", () => {
    const line = `export const api = fn({ url: shape({ href: "http://x" }) }, number());`;
    const pos = findFnContractInsertPos([line], "api", { param: "url", path: ["z"] })!;
    expect(pos.line).toBe(0);
    expect(line.slice(0, pos.character - 1)).toContain("shape(");
  });

  it("brace inside a string does not close the contract object", () => {
    const lines = [`export const foo = fn({ desc: shape({ t: "}" }) }, number());`];
    const pos = findFnContractInsertPos(lines, "foo", { param: "desc", path: ["z"] })!;
    expect(lines[0]!.slice(0, pos.character - 1)).toContain("shape(");
  });

  it("fn( inside a comment is not the call site", () => {
    const lines = [
      `export const foo = helper(x); // fn({ fake: 1 })`,
      `export const bar = fn({ y: shape({ z: number() }) }, number());`,
    ];
    // foo 无真实 fn( → null；bar 自身仍可定位
    expect(findFnContractInsertPos(lines, "foo", X_Z)).toBeNull();
    const pos = findFnContractInsertPos(lines, "bar", { param: "y", path: ["w"] })!;
    expect(pos.line).toBe(1);
  });

  it("fn( inside a string is not the call site", () => {
    const lines = [
      `export const foo = note("fn({ fake: 1 })");`,
      `export const bar = fn({ y: shape({ z: number() }) }, number());`,
    ];
    expect(findFnContractInsertPos(lines, "foo", X_Z)).toBeNull();
    const pos = findFnContractInsertPos(lines, "bar", { param: "y", path: ["w"] })!;
    expect(lines[1]!.slice(0, pos.character - 1)).toContain("shape(");
  });

  it("export name inside a string is not the target binding", () => {
    const lines = [
      `const s = "export const foo = fn({ x: 1 }, 2)";`,
      `export const bar = fn({ y: number() }, number());`,
    ];
    expect(findFnContractInsertPos(lines, "foo", X_Z)).toBeNull();
  });
});
});

// ---------------------------------------------------------------------------
// A4 sidecar unsaved buffer
// ---------------------------------------------------------------------------
describe("[lsp-] A4 sidecar unsaved buffer", () => {
describe("A4 sidecar unsaved buffer", () => {
  it("prefers open buffer text over disk for relative sidecar", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-a4-"));
    try {
      const srcPath = join(dir, "a.js");
      const sidecarPath = join(dir, "a.nudo.js");
      writeFileSync(srcPath, "export function add(x){return x;}\n");
      writeFileSync(sidecarPath, "export const add = number().int();\n");
      const open = "export const add = number().gt(0); // unsaved\n";
      const load = makeBufferAwareLoadModule((p) => (p === sidecarPath ? open : undefined));
      expect(load("./a.nudo.js", srcPath)).toBe(open);
      expect(load(sidecarPath, srcPath)).toBe(open);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to disk when buffer is closed", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-a4b-"));
    try {
      const srcPath = join(dir, "b.js");
      const sidecarPath = join(dir, "b.nudo.js");
      writeFileSync(srcPath, "export function f(){return 1;}\n");
      writeFileSync(sidecarPath, "export const f = number();\n");
      const load = makeBufferAwareLoadModule(() => undefined);
      const out = load("./b.nudo.js", srcPath);
      expect(out).toContain("number()");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("A5 go-to sidecar contract", () => {
  it("includes sidecar export among definition locations", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-a5-"));
    try {
      const srcPath = join(dir, "add.js");
      const sidecarPath = join(dir, "add.nudo.js");
      const src = "export function add2(x) {\n  return x + 2;\n}\n";
      writeFileSync(srcPath, src);
      // 侧车必须是**引擎真正消费**的形态：`fn({ … }, …)` 的导出绑定。
      // 值模板（`number().int()`）不是契约（见 Bug 728），不应出现在 definition 结果里。
      writeFileSync(
        sidecarPath,
        'import { fn, number } from "@nudojs/core";\nexport const add2 = fn({ x: number().int() }, number());\n',
      );
      const ident = findIdentifierAtPosition(parse(src), 1, 16);
      expect(ident).toBe("add2");
      const locs = resolveDefinitionLocations(srcPath, src, "add2");
      const files = locs.map((d) => d.filePath);
      expect(files).toContain(srcPath);
      expect(files).toContain(sidecarPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});
