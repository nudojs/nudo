/**
 * 族 53 · LSP **IDE 面** 8 条（片 W3）。
 *
 * 1. 语义 token 面在语法非法 buffer 上**整面清零** → 词法降级（部分 token）
 * 2. 指令补全的前缀过滤是**子串匹配** → 前缀匹配（语义写死）
 * 3. **方法面未下沉到符号层** → 纯函数面也认类方法（与协议面同口径）
 * 4. **跨文件方法 references 未接** → 方法面跨文件（与改名面同口径）
 * 5. `executeCommand` 缺**位置参数 → 对象桥** → 位置形态可跑
 * 6. LSP 侧 `ignoreThrows` 口径与 **CLI 分裂** → 同语义解析（CLI 解析器作 oracle）
 * 7. LSP 的 **env 模板无反向边** → 接 service 的 env 反向边表（CLI watch 同一张表）
 * 8. manifest 漏登记 `nudo.selectContract` → 登记进 vscode manifest
 *
 * 负控：非相关路径**逐字不变**（绑定面 / 对象形态命令 / 非指令补全面不被劫持）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FileChangeType } from "vscode-languageserver/node";
import { parse } from "@nudojs/parser";
import { clearEnvPathDeps, noteEnvPathDeps } from "@nudojs/service";
import { buildSemanticTokens, SEMANTIC_TOKEN_TYPES } from "../semantic-tokens.ts";
import { matchesDirectivePrefix } from "../server-ide.ts";
import {
  collectMethodReferencesAcrossFiles,
  methodTargetAt,
  resolveDefinitionLocations,
  resolveReferences,
} from "../symbols.ts";
import { positionalCommandParams } from "../agent-tools.ts";
import { configIgnoreThrows, parseIgnoreThrows } from "../gate-config.ts";
import { cacheKey, checkToLspDiagnostics, handleNudoDepFileChanged } from "../validation.ts";
import { createNudoServer } from "../server.ts";
import { createMockConnection, withLspServer } from "./helpers.ts";
import { openLspDocument, requestCompletion } from "./lsp-bug-d4-harness.ts";
// CLI 侧解析器（**测试 oracle**：同语义镜像必须逐值一致）
import { configIgnoreThrows as cliConfigIgnoreThrows } from "../../../nudojs/src/check-gate-config.ts";

/* ───────────────────────── 夹具 ───────────────────────── */

/** 类 Alpha 的方法 run（方法键在行 2 / 列 2，1-based 行） */
const ALPHA = `export class Alpha {
  run() {
    return 1;
  }
}
`;

/** 跨文件调用 `new Alpha().run()`（成员访问在行 4 / 列 21） */
const CALLER = `import { Alpha } from "./a.js";

export function go() {
  return new Alpha().run();
}
`;

/** 同名不同类：不得与 Alpha.run 合并 */
const BETA = `export class Beta {
  run() {
    return 2;
  }
}
`;

/** 抛 Error 子类的入口：未 ignore 时报 L2 `nudo:entry-may-throw` */
const THROWER = `class MyError extends Error {}
export function boom() {
  throw new MyError("x");
}
`;

/** env 模板（改动 ⇒ 依赖源文件必须复分析） */
const ENV_SRC = `export function defineEnv(){ return { globals: { MAGIC: 1 } }; }\n`;
/** 坏掉的 env 模板：不导出 defineEnv ⇒ 加载失败（可见 warning） */
const ENV_BROKEN = `export const notDefineEnv = 1;\n`;
/** 依赖 env 模板的源文件（**扩展名缺省**形态 ⇒ LSP 自己的 dep 表对不上，
 *  只有 service 的 env 反向边表能命中） */
const MAIN_NOEXT = `/// @nudo:env ./globals.env
export function useGlobal(){ return MAGIC; }
`;
/** 依赖 env 模板的源文件（扩展名显式形态） */
const MAIN_SRC = `/// @nudo:env ./globals.env.ts
export function useGlobal(){ return MAGIC; }
`;

/* ───────────────────────── 工具 ───────────────────────── */

type DecodedToken = {
  line: number;
  char: number;
  length: number;
  type: string;
};

function decodeTokens(data: number[]): DecodedToken[] {
  const out: DecodedToken[] = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    const deltaLine = data[i]!;
    const deltaChar = data[i + 1]!;
    line += deltaLine;
    char = deltaLine === 0 ? char + deltaChar : deltaChar;
    out.push({
      line,
      char,
      length: data[i + 2]!,
      type: SEMANTIC_TOKEN_TYPES[data[i + 3]!]!,
    });
  }
  return out;
}

const directiveLabels = (items: Array<{ label: string }>): string[] =>
  items.map((i) => i.label).filter((l) => l.startsWith("@nudo:"));

/** 仓库根（从本文件位置反推） */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/* ───────────────────────── 1 · 语义 token 降级 ───────────────────────── */

describe("族 53 · 第 1 条：语义 token 面在语法非法 buffer 上降级而非清零", () => {
  it("1-1 合法源码：声明位照常上色（降级路径不得影响正常路径）", () => {
    const src = "export function f(a) {\n  const x = 1;\n  return x;\n}\n";
    const tokens = decodeTokens(buildSemanticTokens("/t/ok.js", src));
    expect(tokens.some((t) => t.type === "function")).toBe(true);
    expect(tokens.some((t) => t.type === "parameter")).toBe(true);
    expect(tokens.some((t) => t.type === "variable")).toBe(true);
  });

  it("1-2 括号未闭合（解析失败）：仍有部分 token", () => {
    const src = "export function f() {\n  const x = 1;\n";
    const tokens = decodeTokens(buildSemanticTokens("/t/broken.js", src));
    expect(tokens.length).toBeGreaterThan(0);
    const fn = tokens.find((t) => t.type === "function");
    expect(fn).toMatchObject({ line: 0, char: 16 });
    const variable = tokens.find((t) => t.type === "variable");
    expect(variable).toMatchObject({ line: 1, char: 8 });
  });

  it("1-3 中途出现非法 token：文件其余部分照常上色", () => {
    const src = "export function f() {\n  const x = 1;\n  @@@\n}\n";
    const tokens = decodeTokens(buildSemanticTokens("/t/broken2.js", src));
    expect(tokens.some((t) => t.type === "function")).toBe(true);
    expect(tokens.some((t) => t.type === "variable")).toBe(true);
  });

  it("1-4 类声明：非法 buffer 里类名仍上色（class 档）", () => {
    const src = "export class Alpha {\n  run() { return 1; }\n";
    const tokens = decodeTokens(buildSemanticTokens("/t/broken3.js", src));
    expect(tokens.find((t) => t.type === "class")).toMatchObject({ line: 0, char: 13 });
  });

  it("1-5 注释 / 字符串里的关键字不产生假 token", () => {
    const src = "// const fake = 1;\nconst s = 'const fake';\n";
    const tokens = decodeTokens(buildSemanticTokens("/t/str.js", src));
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ line: 1, char: 6, length: 1, type: "variable" });
  });

  it("1-6 既有口径不变：连标识符都没有的非法片段仍返回空（不硬造 token）", () => {
    expect(buildSemanticTokens("/t/broken4.js", "const (")).toEqual([]);
  });
});

/* ───────────────────────── 2 · 指令补全前缀过滤 ───────────────────────── */

describe("族 53 · 第 2 条：指令补全的前缀过滤（前缀匹配语义）", () => {
  it("2-1 纯函数面：typed 必须是 label 的前缀（子串不算命中）", () => {
    expect(matchesDirectivePrefix("@nudo:case", "")).toBe(true);
    expect(matchesDirectivePrefix("@nudo:case", "@nudo:ca")).toBe(true);
    expect(matchesDirectivePrefix("@nudo:case", "@nudo:case")).toBe(true);
    // 不是前缀（只是内部子串）⇒ 不命中
    expect(matchesDirectivePrefix("@nudo:mock", "@nudo:c")).toBe(false);
    expect(matchesDirectivePrefix("@nudo:replace", "@nudo:c")).toBe(false);
    expect(matchesDirectivePrefix("@nudo:contract", "@nudo:case")).toBe(false);
    // 合成 label：内嵌第二段 `@nudo:` ⇒ 子串会误命中，前缀不会
    expect(matchesDirectivePrefix("@nudo:weird@nudo:case", "@nudo:case")).toBe(false);
  });

  it("2-2 协议面：`@nudo:ca` ⇒ 只命中 `@nudo:case`（既有金标不变）", async () => {
    const src = "// @nudo:ca\nexport const k = 1;\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-f53-dir/a.js");
    expect(directiveLabels(requestCompletion(mock, uri, 0, 11))).toEqual(["@nudo:case"]);
  });

  it("2-3 协议面：`@nudo:con` ⇒ 只命中 `@nudo:contract`", async () => {
    const src = "// @nudo:con\nexport const k = 1;\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-f53-dir/b.js");
    expect(directiveLabels(requestCompletion(mock, uri, 0, 13))).toEqual(["@nudo:contract"]);
  });

  it("2-4 协议面：`@nudo:c` ⇒ 命中**所有**以 `@nudo:c` 开头的指令（前缀语义）", async () => {
    // ⚠ 前缀语义说明：`@nudo:case` 与 `@nudo:contract` **都**真前缀于 `@nudo:c`
    //   ⇒ 两者都该出现；被排除的是「不是 typed 前缀」的 label（子串语义才会把
    //   `@nudo:mock` / `@nudo:replace` 这类**含** `c` 的 label 误纳进来）。
    const src = "// @nudo:c\nexport const k = 1;\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-f53-dir/c.js");
    expect(directiveLabels(requestCompletion(mock, uri, 0, 10)).sort()).toEqual([
      "@nudo:case",
      "@nudo:contract",
    ]);
  });
});

/* ───────────────────────── 3 · 方法面下沉到符号层 ───────────────────────── */

describe("族 53 · 第 3 条：方法面下沉到符号层（纯函数面 ≡ 协议面）", () => {
  const at = { line: 2, column: 2 };

  it("3-1 方法目标可判定（方法键 / 同源成员访问）", () => {
    expect(methodTargetAt(parse(ALPHA), 2, 2)).toEqual({
      name: "run",
      owner: { kind: "class", name: "Alpha" },
    });
    // 普通绑定不是方法 ⇒ null（调用方退回绑定面）
    expect(methodTargetAt(parse("export const k = 1;\n"), 1, 13)).toBeNull();
  });

  it("3-2 resolveDefinitionLocations 认得类方法（跳到方法键）", () => {
    const defs = resolveDefinitionLocations("/tmp/f53/a.js", ALPHA, "run", { at });
    expect(defs.length).toBeGreaterThanOrEqual(1);
    expect(defs[0]).toMatchObject({
      filePath: "/tmp/f53/a.js",
      name: "run",
      loc: { start: { line: 2, column: 2 } },
    });
  });

  it("3-3 resolveReferences 认得类方法（定义位 + includeDeclaration 语义）", () => {
    const withDecl = resolveReferences("/tmp/f53/a.js", ALPHA, "run", { at });
    expect(withDecl.some((r) => r.loc.start.line === 2)).toBe(true);
    const withoutDecl = resolveReferences("/tmp/f53/a.js", ALPHA, "run", {
      at,
      includeDeclaration: false,
    });
    expect(withoutDecl.some((r) => r.loc.start.line === 2)).toBe(false);
  });

  it("3-4 协议面：definition @ 方法键 ⇒ 跳到方法键（与纯函数面同结果）", async () => {
    await withLspServer({ "a.js": ALPHA }, async ({ req, uri }) => {
      const res = req("textDocument/definition")({
        textDocument: { uri: uri("a.js") },
        position: { line: 1, character: 2 },
      }) as Array<{ range: { start: { line: number; character: number } } }>;
      expect(res.length).toBeGreaterThanOrEqual(1);
      expect(res[0]!.range.start).toMatchObject({ line: 1, character: 2 });
    });
  });
});

/* ───────────────────────── 4 · 跨文件方法 references ───────────────────────── */

describe("族 53 · 第 4 条：跨文件方法 references（与改名面同口径）", () => {
  it("4-1 跨文件：调用文件里的 `Alpha.run` 进 references 结果", () => {
    const hits = collectMethodReferencesAcrossFiles(
      "/tmp/f53/a.js",
      ALPHA,
      { name: "run", owner: { kind: "class", name: "Alpha" } },
      { extraFiles: ["/tmp/f53/b.js"], sourceProvider: () => CALLER },
    );
    const callerHit = hits.find((h) => h.uri === "/tmp/f53/b.js");
    expect(callerHit).toMatchObject({ kind: "member" });
    expect(callerHit!.loc.start).toMatchObject({ line: 4, column: 21 });
  });

  it("4-2 跨文件：同名不同类不合并（Beta.run 不进结果）", () => {
    const hits = collectMethodReferencesAcrossFiles(
      "/tmp/f53/a.js",
      ALPHA,
      { name: "run", owner: { kind: "class", name: "Alpha" } },
      { extraFiles: ["/tmp/f53/beta.js"], sourceProvider: () => BETA },
    );
    expect(hits.some((h) => h.uri === "/tmp/f53/beta.js")).toBe(false);
  });

  it("4-3 协议面：references @ 方法键 ⇒ 含**跨文件**调用点", async () => {
    await withLspServer({ "a.js": ALPHA, "b.js": CALLER }, async ({ req, uri }) => {
      const res = req("textDocument/references")({
        textDocument: { uri: uri("a.js") },
        position: { line: 1, character: 2 },
        context: { includeDeclaration: true },
      }) as Array<{ uri: string; range: { start: { line: number; character: number } } }>;
      const callerHits = res.filter((r) => r.uri.endsWith("/b.js"));
      expect(callerHits.length).toBeGreaterThanOrEqual(1);
      expect(callerHits.some((r) => r.range.start.line === 3)).toBe(true);
    });
  });
});

/* ───────────────────────── 5 · executeCommand 位置参数桥 ───────────────────────── */

describe("族 53 · 第 5 条：executeCommand 位置参数 → 对象桥", () => {
  const SRC = `export function add(a, b) {
  return a + b;
}
`;

  it("5-1 纯函数面：位置形态 → 各命令的参数对象", () => {
    expect(positionalCommandParams("nudo.check", ["file:///t/a.js"])).toEqual({
      file: "file:///t/a.js",
    });
    expect(positionalCommandParams("nudo.test", ["file:///t/a.js"])).toEqual({
      file: "file:///t/a.js",
    });
    expect(positionalCommandParams("nudo.hover", ["file:///t/a.js", 3, 5])).toEqual({
      file: "file:///t/a.js",
      line: 3,
      column: 5,
    });
    expect(positionalCommandParams("nudo.whatIf", ["file:///t/a.js", "add"])).toEqual({
      file: "file:///t/a.js",
      target: "add",
    });
    expect(positionalCommandParams("nudo.suggestCase", ["file:///t/a.js", "add"])).toEqual({
      uri: "file:///t/a.js",
      functionName: "add",
    });
    expect(positionalCommandParams("nudo.getActiveCases", ["file:///t/a.js"])).toEqual({
      uri: "file:///t/a.js",
    });
  });

  it("5-2 纯函数面：对象形态 / 形态不合法 ⇒ 不桥接（交回原通道处理）", () => {
    expect(positionalCommandParams("nudo.check", [{ file: "file:///t/a.js" }])).toBeUndefined();
    expect(positionalCommandParams("nudo.hover", ["file:///t/a.js"])).toBeUndefined();
    expect(positionalCommandParams("nudo.whatIf", ["file:///t/a.js"])).toBeUndefined();
    expect(positionalCommandParams("nudo.suggestCase", ["file:///t/a.js"])).toBeUndefined();
    expect(positionalCommandParams("nudo.nope", ["file:///t/a.js"])).toBeUndefined();
  });

  it("5-3 协议面：`nudo.check` 位置形态 ⇒ 命令跑得起来（不再 InvalidParams）", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const res = req("workspace/executeCommand")({
        command: "nudo.check",
        arguments: [uri("a.js")],
      }) as { content: Array<{ type: string; text: string }> };
      expect(res.content[0]!.text.length).toBeGreaterThan(0);
    });
  });

  it("5-4 协议面：对象形态照旧（既有行为不变）", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const res = req("workspace/executeCommand")({
        command: "nudo.check",
        arguments: [{ file: uri("a.js") }],
      }) as { content: Array<{ type: string; text: string }> };
      expect(res.content[0]!.text.length).toBeGreaterThan(0);
    });
  });

  it("5-5 协议面：位置形态缺必填项 ⇒ 仍是协议层参数错误（不静默吞掉）", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      expect(() =>
        req("workspace/executeCommand")({
          command: "nudo.hover",
          arguments: [uri("a.js")],
        }),
      ).toThrow();
    });
  });
});

/* ───────────────────────── 6 · ignoreThrows 口径 ───────────────────────── */

/** 在临时目录里跑一次 LSP 门禁面，返回诊断码列表 */
function l2CodesWithConfig(ignoreThrows: unknown): string[] {
  const dir = mkdtempSync(join(tmpdir(), "nudo-f53-ignore-"));
  try {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ nudo: { check: { ignoreThrows } } }),
      "utf-8",
    );
    const filePath = join(dir, "boom.js");
    writeFileSync(filePath, THROWER, "utf-8");
    return checkToLspDiagnostics(filePath, THROWER).map((d) => String(d.code ?? ""));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("族 53 · 第 6 条：ignoreThrows 配置面（IDE ≡ CLI）", () => {
  it("6-1 纯函数面：与 CLI 解析器逐值一致（含非法值）", () => {
    const raws: unknown[] = [
      "Error",
      "Error,TypeError",
      ["Error"],
      ["Error,TypeError"],
      [" Error ", "", "TypeError"],
      ["Error", 42, null],
      [],
      [""],
      "  ",
      undefined,
      null,
      123,
    ];
    for (const raw of raws) {
      const config = { check: { ignoreThrows: raw } };
      expect(configIgnoreThrows(config)).toEqual(cliConfigIgnoreThrows(config));
    }
    expect(configIgnoreThrows({ check: { ignoreThrows: "Error" } })).toEqual(["Error"]);
    expect(configIgnoreThrows({ check: { ignoreThrows: ["Error,TypeError"] } })).toEqual([
      "Error",
      "TypeError",
    ]);
    expect(configIgnoreThrows({ check: { ignoreThrows: [" Error ", "", 42] } })).toEqual(["Error"]);
    expect(configIgnoreThrows({ check: {} })).toEqual([]);
    expect(configIgnoreThrows(undefined)).toEqual([]);
    expect(parseIgnoreThrows(undefined)).toBeUndefined();
    expect(parseIgnoreThrows("")).toBeUndefined();
    expect(parseIgnoreThrows([])).toBeUndefined();
    expect(parseIgnoreThrows("Error")).toEqual(["Error"]);
  });

  it("6-2 门禁面：裸字符串 `\"Error\"` ⇒ IDE 不再报 L2（此前假红）", () => {
    expect(l2CodesWithConfig("Error")).not.toContain("nudo:entry-may-throw");
    expect(l2CodesWithConfig(["Error,TypeError"])).not.toContain("nudo:entry-may-throw");
  });

  it("6-3 门禁面：未配置 ignoreThrows ⇒ L2 仍报（不得漏报）", () => {
    expect(l2CodesWithConfig(undefined)).toContain("nudo:entry-may-throw");
  });
});

/* ───────────────────────── 7 · env 模板反向边 ───────────────────────── */

describe("族 53 · 第 7 条：env 模板反向边（LSP 接 service 的 env 反向边表）", () => {
  it("7-1 env 模板变更 ⇒ 依赖源文件被重检（扩展名缺省形态：只有 service 的表能命中）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-f53-env-"));
    try {
      const envFile = join(dir, "globals.env.ts");
      const mainFile = join(dir, "main.js");
      writeFileSync(envFile, ENV_SRC, "utf-8");
      writeFileSync(mainFile, MAIN_NOEXT, "utf-8");
      // 分析器侧登记 env 反向边（service 的 env-path-deps 表——CLI watch 的真源）
      noteEnvPathDeps(mainFile, MAIN_NOEXT);

      const published: string[] = [];
      await handleNudoDepFileChanged(envFile, {
        sendDiagnostics: (p) => published.push(p.uri),
        getOpenDocumentByPath: (p) =>
          p === cacheKey(mainFile)
            ? { uri: `file://${mainFile}`, version: 1, getText: () => MAIN_NOEXT }
            : undefined,
      });
      // 反向边命中 ⇒ 依赖源文件被 force 重检 ⇒ 诊断重新发布
      expect(published).toContain(`file://${mainFile}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearEnvPathDeps();
    }
  });

  it("7-2 协议面：改了 env 模板 ⇒ 打开中的依赖文件重检（watched-files 通道）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-f53-env2-"));
    try {
      const envFile = join(dir, "globals.env.ts");
      const mainFile = join(dir, "main.js");
      writeFileSync(envFile, ENV_SRC, "utf-8");
      writeFileSync(mainFile, MAIN_SRC, "utf-8");

      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      const mainUri = `file://${mainFile}`;
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri: mainUri, languageId: "javascript", version: 1, text: MAIN_SRC },
      });
      await new Promise((r) => setTimeout(r, 800));
      const before = mock.sentDiagnostics.filter((d) => d.uri === mainUri);
      expect(before.length).toBeGreaterThan(0);
      expect(
        before.flatMap((d) => d.diagnostics.map((x: { code?: string | number }) => String(x.code ?? ""))),
      ).not.toContain("nudo:env-unresolved");

      // 改坏 env 模板 ⇒ 触发 watched-files 事件
      writeFileSync(envFile, ENV_BROKEN, "utf-8");
      mock.notifications.get("workspace/didChangeWatchedFiles")!({
        changes: [{ uri: `file://${envFile}`, type: FileChangeType.Changed }],
      });
      await new Promise((r) => setTimeout(r, 1000));

      const afterCodes = mock.sentDiagnostics
        .filter((d) => d.uri === mainUri)
        .flatMap((d) => d.diagnostics.map((x: { code?: string | number }) => String(x.code ?? "")));
      // 依赖文件被重检 ⇒ 加载失败的 env 立刻可见
      expect(afterCodes).toContain("nudo:env-unresolved");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearEnvPathDeps();
    }
  }, 30000);
});

/* ───────────────────────── 8 · manifest 登记 ───────────────────────── */

describe("族 53 · 第 8 条：manifest 登记 nudo.selectContract", () => {
  it("8-1 vscode manifest 的 contributes.commands 里有 nudo.selectContract", () => {
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages", "vscode", "package.json"), "utf-8"),
    ) as { contributes?: { commands?: Array<{ command?: string; title?: string }> } };
    const commands = manifest.contributes?.commands ?? [];
    const entry = commands.find((c) => c.command === "nudo.selectContract");
    expect(entry).toBeDefined();
    expect(typeof entry!.title).toBe("string");
    expect(entry!.title!.length).toBeGreaterThan(0);
  });
});

/* ───────────────────────── 负控 ───────────────────────── */

describe("族 53 · 负控：非相关路径逐字不变", () => {
  it("负控-1 普通绑定的定义面不被方法面劫持", () => {
    const src = "export const k = 1;\n";
    const defs = resolveDefinitionLocations("/tmp/f53/k.js", src, "k", {
      at: { line: 1, column: 13 },
    });
    expect(defs.length).toBeGreaterThanOrEqual(1);
    expect(defs[0]).toMatchObject({ filePath: "/tmp/f53/k.js", name: "k" });
  });

  it("负控-2 非指令上下文的补全不受指令面影响", async () => {
    const src = "export const k = 1;\nk.\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-f53-dir/e.js");
    const items = requestCompletion(mock, uri, 1, 2);
    expect(directiveLabels(items)).toEqual([]);
  });
});
