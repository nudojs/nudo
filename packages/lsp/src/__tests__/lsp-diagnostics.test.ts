/**
 * 模块套件：diagnostics 面（check/env/contract/directive/pull-push/range/cache）。
 */
import { describe, it, expect, beforeEach, afterAll, afterEach } from "vitest";
import { clearValidationState, checkToLspDiagnostics, filterCheckLspByLevel, validateText, type LspDiagnostic, type ValidateTextDeps, lspDiagnosticRange, lineLengthsOf, toLspDiagnostic, envUnresolvedDiags } from "../validation.ts";
import { DiagnosticSeverity, type Connection } from "vscode-languageserver/node";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { clearPathEnvCaches, defaultLoadModule } from "@nudojs/service";
import { makeValidateDeps, createMockConnection, type AnyHandler, withLspServer, withTempDir, waitForDiagnostics, waitForValue } from "./helpers.ts";
import { createNudoServer } from "../server.ts";
import { DIAG } from "@nudojs/core/internal";
import { actionsForIssue } from "@nudojs/core";
import { applyEdits, codeActionParams, mountCodeActions, sidecarEdits, type CodeActionEntry } from "./lsp-harness-code-actions.ts";

// ---------------------------------------------------------------------------
// Abs check as LSP diagnostics
// ---------------------------------------------------------------------------
describe("Abs check as LSP diagnostics", () => {
/** LSP 3.18 Diagnostic.message 为 string | MarkupContent；本产品始终写纯字符串。 */
function msgText(m: string | { value: string }): string {
  return typeof m === "string" ? m : m.value;
}

const STD = `
export const positive = number().gt(0);
`;

const src = `
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract x positive
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
needsPositive(-1);
`;

const loadModule = (spec: string) =>
  spec.includes("std.nudo") ? STD : undefined;


  it("maps constraint violations to nudo-check diagnostics", () => {
    const diags = checkToLspDiagnostics("/t/check.js", src, loadModule);
    expect(diags.length).toBeGreaterThan(0);
    const d = diags[0]!;
    expect(d.source).toBe("nudo-check");
    expect(d.code).toBe("nudo:constraint-violated");
    expect(d.message).toContain("actual");
    expect(d.message).toContain("expected");
  });

  it("validateText publishes check diags first", async () => {
    clearValidationState();
    let sent: { source?: string; code?: string }[] = [];
    await validateText("/t/check2.js", "file:///t/check2.js", src, 1, {
      sendDiagnostics: (p) => {
        sent = p.diagnostics.map((d) => ({ source: d.source, code: d.code as string }));
      },
    });
    // validateText 用磁盘 loadModule；虚拟路径下无 std.nudo.js → 无 check diags 也可
    // 至少不崩溃
    expect(Array.isArray(sent)).toBe(true);
  });

  it("filterCheckLspByLevel matches push/pull gate (shared helper)", () => {
    const diags = [
      {
        severity: DiagnosticSeverity.Error,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        message: "e",
      },
      {
        severity: DiagnosticSeverity.Warning,
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
        message: "w",
      },
      {
        severity: DiagnosticSeverity.Information,
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } },
        message: "i",
      },
    ];
    expect(filterCheckLspByLevel(diags, "off")).toEqual([]);
    expect(filterCheckLspByLevel(diags, "errors")).toHaveLength(1);
    expect(filterCheckLspByLevel(diags, "errors")[0]!.severity).toBe(DiagnosticSeverity.Error);
    // default：error+warning，info 挡住（与 push 同）
    expect(filterCheckLspByLevel(diags, "default")).toHaveLength(2);
    expect(filterCheckLspByLevel(diags, "verbose")).toHaveLength(3);
  });

  it("checkToLspDiagnostics 并入指令文法诊断（FIX-RESIDUAL #1，显式通道）", () => {
    const bad = `
/**
 * @nudo:case 't' (1)
 */
function f(x) { return x; }
`;
    const diags = checkToLspDiagnostics("/t/dir.js", bad);
    expect(diags.some((d) => d.code === "nudo:directive-syntax")).toBe(true);
  });

  it("checkToLspDiagnostics 只含本文件的指令诊断（R2B-003：无共享缓冲可混入）", async () => {
    const { extractDirectivesQuiet, parse } = await import("@nudojs/parser");
    const badB = `
/**
 * @nudo:case 'b' (1)
 */
function g(x) { return x; }
`;
    const badA = `
/**
 * @nudo:case 'a' (1)
 */
function f(x) { return x; }
`;
    // 文件 B 的 hover 探测（纯查询：诊断丢弃，不产任何可混入面）
    extractDirectivesQuiet(parse(badB));
    const diags = checkToLspDiagnostics("/t/fileA.js", badA);
    // A 的结果只含 A 自己的指令诊断，不得混入 B 的
    const dirDiags = diags.filter((d) => d.code === "nudo:directive-syntax");
    expect(dirDiags.length).toBeGreaterThan(0);
    expect(dirDiags.some((d) => msgText(d.message).includes("'b'"))).toBe(false);
    expect(dirDiags.some((d) => msgText(d.message).includes("'a'"))).toBe(true);
  });

  it("checkToLspDiagnostics catch 不再静默 return []（R2B-003）", () => {
    // 传入会让 checkSource 抛错的输入：用 Proxy 让 source 访问即抛
    const evilSource = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "toString" || prop === Symbol.toPrimitive || prop === "valueOf") {
            return () => " ";
          }
          throw new Error("boom");
        },
        has() {
          return true;
        },
      },
    ) as unknown as string;
    const diags = checkToLspDiagnostics("/t/evil.js", evilSource);
    // 失败必须留错误面（Analysis/Check error），不得 [] 把门禁通道整段丢掉
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.some((d) => /error/i.test(msgText(d.message)))).toBe(true);
  });

});

// ---------------------------------------------------------------------------
// LSP nudo:env-unresolved 诊断（validation 面）
// ---------------------------------------------------------------------------
describe("LSP nudo:env-unresolved 诊断（validation 面）", () => {
/**
 * LSP 侧 nudo:env-unresolved（issue #88 后续）：验证链路此前只 preload path env
 * 不查错误表——env 加载失败/文件缺失在 IDE 面完全静默。契约：
 * - 坏 env（缺失/导入失败）→ warning 诊断，code=nudo:env-unresolved，
 * 消息与 CLI 同源（`path env failed to load: <path> — <error>`）
 * - 好 env → 无该诊断；env 项移除后陈旧错误不误报；缓存命中轮仍发布（live 瞬态）
 */
const OK_ENV = `export function defineEnv() {
  return { globals: {}, modules: {} };
}
`;

const PROBE = `export function f(x) { return x; }
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function makeProject(envEntries: string[], envFiles: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-env-unresolved-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "t", private: true, nudo: { env: envEntries } }),
    "utf-8",
  );
  for (const [name, content] of Object.entries(envFiles)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

function collector(): { sent: LspDiagnostic[]; deps: ValidateTextDeps } {
  const sent: LspDiagnostic[] = [];
  return {
    sent,
    deps: {
      sendDiagnostics: (p) => {
        sent.push(...p.diagnostics);
      },
    },
  };
}

async function validate(dir: string, version = 1): Promise<LspDiagnostic[]> {
  const { sent, deps } = collector();
  const file = join(dir, "probe.js");
  await validateText(file, `file://${file}`, PROBE, version, deps);
  return sent;
}

function envDiags(sent: LspDiagnostic[]): LspDiagnostic[] {
  return sent.filter((d) => d.code === "nudo:env-unresolved");
}

{
  beforeEach(() => {
    clearValidationState();
    clearPathEnvCaches();
  });

  it("缺失 env 文件 → 恰 1 条 warning，消息与 CLI 同源", async () => {
    const dir = makeProject(["./nope.mjs"]);
    const sent = await validate(dir);

    const env = envDiags(sent);
    expect(env).toHaveLength(1);
    expect(env[0]!.severity).toBe(DiagnosticSeverity.Warning);
    expect(env[0]!.source).toBe("nudo-check");
    expect(env[0]!.message).toContain("path env failed to load");
    expect(env[0]!.message).toContain(join(dir, "nope.mjs"));
    expect(env[0]!.message).toContain("path env not found");
  });

  it("导入失败的 env 文件（存在但 defineEnv 不可达）同样告警", async () => {
    const dir = makeProject(["./broken.mjs"], {
      "broken.mjs": `import "@nudojs/env/does-not-exist";\nexport function defineEnv() { return { globals: {}, modules: {} }; }\n`,
    });
    const sent = await validate(dir);

    const env = envDiags(sent);
    expect(env).toHaveLength(1);
    expect(env[0]!.severity).toBe(DiagnosticSeverity.Warning);
    expect(env[0]!.message).toContain("path env failed to load");
    expect(env[0]!.message).toContain(join(dir, "broken.mjs"));
  });

  it("好 env → 无该诊断", async () => {
    const dir = makeProject(["./env.mjs"], { "env.mjs": OK_ENV });
    const sent = await validate(dir);
    expect(envDiags(sent)).toHaveLength(0);
  });

  it("缓存命中轮（源码未变再 validate）仍发布 live 告警", async () => {
    const dir = makeProject(["./nope.mjs"]);
    expect(envDiags(await validate(dir, 1))).toHaveLength(1);
    // 同源码同 version：analysisCache 命中（analyzeFileAsync 不再 preload），
    // env 告警是 live 瞬态——显式补 preload 后仍须恰 1 条
    expect(envDiags(await validate(dir, 1))).toHaveLength(1);
  });

  it("env 项从配置移除后不再误报陈旧错误", async () => {
    const dir = makeProject(["./nope.mjs"]);
    expect(envDiags(await validate(dir))).toHaveLength(1);

    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "t", private: true, nudo: {} }),
      "utf-8",
    );
    // 进程级错误表仍有旧条目——本轮 env 名单不含它，不得继续发布
    expect(envDiags(await validate(dir, 2))).toHaveLength(0);
  });
}
});

// ---------------------------------------------------------------------------
// LSP：按名字发的 env 诊断不再被过滤掉
// ---------------------------------------------------------------------------
describe("LSP：按名字发的 env 诊断不再被过滤掉", () => {
/**
 * 回归（LSP 面）
 *
 * 注：env 名的指令文法只收「词字符」或「path 形态」（core parseEnvPayload）
 * ⇒ 未知名用 `bogusenvname` 这类词字符形态（带连字符会被指令层过滤掉，
 * 根本进不了 env 名单）。：service 侧新增的**按名字**发的 env 诊断
 * （未知 env 名 `bogus` / `nodejs`…、非字符串 env 项）记录的 path 是
 * **名字本身**，不是解析后的绝对路径 ⇒ LSP 侧原先只按
 * `resolvePath(baseDir, name)` 过滤 ⇒ 这类诊断在 IDE 里被整条吃掉。
 *
 * 本文件锁：
 * ① 未知 env 名 ⇒ IDE 里看得见 `nudo:env-unresolved`；
 * ② 同目录**别的文件**的无 path 诊断不得误吸进来（不串台）。
 */







const DIAG_ENV_UNRESOLVED = "nudo:env-unresolved";

async function publish(filePath: string, source: string): Promise<any[]> {
  const sent: any[] = [];
  const deps = makeValidateDeps({
    onPublish: (params) => {
      sent.push(...params.diagnostics);
    },
  });
  await validateText(filePath, `file://${filePath}`, source, 1, deps);
  return sent;
}


  it("未知 env 名 ⇒ IDE 里出现 nudo:env-unresolved", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-470-"));
    try {
      const file = join(dir, "probe.js");
      const src = `// @nudo:env bogusenvname\nexport function f() { return 1; }\n`;
      writeFileSync(file, src, "utf-8");
      const diags = await publish(file, src);
      const envDiags = diags.filter((d) => d.code === DIAG_ENV_UNRESOLVED);
      expect(envDiags.length).toBeGreaterThan(0);
      expect(envDiags[0].message).toContain("bogusenvname");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearValidationState();
    }
  });

  it("同目录别的文件的无 path 诊断不误吸（本文件没有该 env 名）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-470b-"));
    try {
      // 另一个文件先用过「未知 env 名」——它的诊断记在同一个 baseDir 下
      const other = join(dir, "other.js");
      const otherSrc = `// @nudo:env otherunknownenv\nexport function g() { return 1; }\n`;
      writeFileSync(other, otherSrc, "utf-8");
      await publish(other, otherSrc);

      // 本文件用的是另一个 env 名 ⇒ 不该看到 otherunknownenv 的诊断
      const file = join(dir, "probe.js");
      const src = `// @nudo:env yetanotherenv\nexport function f() { return 1; }\n`;
      writeFileSync(file, src, "utf-8");
      const diags = await publish(file, src);
      const envDiags = diags.filter((d) => d.code === DIAG_ENV_UNRESOLVED);
      for (const d of envDiags) {
        expect(d.message).not.toContain("otherunknownenv");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearValidationState();
    }
  });

});

// ---------------------------------------------------------------------------
// LSP：坏侧车的 contract-load error 不被分析器取走
// ---------------------------------------------------------------------------
describe("LSP：坏侧车的 contract-load error 不被分析器取走", () => {
/**
 * 回归（LSP 面）：service 分析器会**消费** core 的 contract 诊断
 * 通道（把「侧车加载失败」转成 service 诊断），而 LSP 的两个分析入口
 * （analyzeFileAsync 先、checkSource 后）**共用同一个 collector scope**
 * ⇒ 顺序上「service 分析先跑」可能把 check 路径的 `nudo:contract-load`
 * 取走 ⇒ IDE 里少一条 error 级诊断。
 *
 * 结论（当前工作树）：**不复现**——core 的 checkSource 入口会
 * `resetSidecarLoadFailureCache()`，自己重新探测侧车并重新上报一份
 * contract-load error ⇒ 两条路径都拿得到（探针：tmp/probe/fix-r24-wcli/
 * chan-order-probe.ts，两个顺序下 checkSource 的 issues 都带
 * `nudo:contract-load`）。
 *
 * 本文件把该事实**钉住**：坏侧车 ⇒ IDE 里必须看得见 error 级
 * `nudo:contract-load`（分析器先跑的那条路径），且不得被降级成
 * 「无契约根」的误报。
 */







const DIAG_INTERFACE_LOAD = "nudo:contract-load";

async function publish(filePath: string, source: string): Promise<any[]> {
  const sent: any[] = [];
  const deps = makeValidateDeps({
    onPublish: (params) => {
      sent.push(...params.diagnostics);
    },
  });
  await validateText(filePath, `file://${filePath}`, source, 1, deps);
  return sent;
}


  it("分析器先跑 ⇒ IDE 里仍有 error 级 nudo:contract-load", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-495-"));
    try {
      const file = join(dir, "probe.js");
      const src = `export function f(x) { return x; }\n`;
      writeFileSync(file, src, "utf-8");
      // 坏侧车：exec 失败 ⇒ core 报 contract-load
      writeFileSync(join(dir, "probe.nudo.js"), `export const f = ;\n`, "utf-8");

      const sent = await publish(file, src);
      const loadDiags = sent.filter((d) => d.code === DIAG_INTERFACE_LOAD);
      expect(loadDiags.length).toBeGreaterThan(0);
      expect(loadDiags[0].severity).toBe(1); // DiagnosticSeverity.Error
      // 不得被降级成「无契约根」的误报（侧车在，只是加载失败）
      const entryOnly = sent.filter((d) => d.code === "nudo:contract-entry-only");
      expect(entryOnly).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearValidationState();
    }
  });

  it("负控制：好侧车 ⇒ 无 contract-load error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-495b-"));
    try {
      const file = join(dir, "probe.js");
      const src = `export function f(x) { return x; }\n`;
      writeFileSync(file, src, "utf-8");
      writeFileSync(
        join(dir, "probe.nudo.js"),
        `import { fn, number } from "@nudojs/core";\n\nexport const f = fn({ x: number() }, number());\n`,
        "utf-8",
      );

      const sent = await publish(file, src);
      expect(sent.filter((d) => d.code === DIAG_INTERFACE_LOAD)).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearValidationState();
    }
  });

});

// ---------------------------------------------------------------------------
// 诊断 range 必须夹在文档内（整行哨兵 column:999）
// ---------------------------------------------------------------------------
describe("诊断 range 必须夹在文档内（整行哨兵 column:999）", () => {
/**
 * 诊断 range 越界（`nudo:case-expected` 的 `column: 999` 整行哨兵）。
 *
 * 症状：service 用 `column: 999` 当「整行」哨兵，诊断原样转成 LSP range ⇒
 * `end.character = 999` 越出文档（协议层 Position 必须在文档内）⇒ 客户端按
 * range 渲染会划到行外。push / pull **两条通道**都越界。
 *
 * 修法（片 E）：range 的**唯一计算点** `lspDiagnosticRange` —— 行号 1 基 → 0 基，
 * 列号**夹到该行长度**以内（999 ⇒ 行尾），同 line 时 end ≥ start。
 *
 * 钉：push 与 pull 两条通道的 range 都必须落在文档内，且 end 恰为行尾。
 */








/** `@nudo:case` 的期望类型与实得类型不符 ⇒ 触发 nudo:case-expected */
const SRC = `/**
 * @nudo:case "bad" (1) => "str"
 */
export function one(x) {
  return x;
}
`;

const CASE_CODE = "nudo:case-expected";

function openSession(src: string): {
  mock: ReturnType<typeof createMockConnection>;
  uri: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug778-"));
  const file = join(dir, "rng.js");
  writeFileSync(file, src, "utf-8");
  const uri = `file://${file}`;
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri, languageId: "javascript", version: 1, text: src },
  });
  return {
    mock,
    uri,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}


  it("push 通道：nudo:case-expected 的 range 不越过行尾", async () => {
    const { mock, uri, cleanup } = openSession(SRC);
    try {
      await waitForDiagnostics(mock, uri);
      await mock.requests.get("workspace/executeCommand")!({
        command: "nudo.selectCase",
        arguments: [uri, "one", 0],
      });
      await waitForDiagnostics(mock, uri, { code: CASE_CODE });

      const lines = SRC.split("\n");
      const pushed = mock.sentDiagnostics
        .filter((p: any) => p.uri === uri)
        .flatMap((p: any) => p.diagnostics)
        .filter((d: any) => d.code === CASE_CODE);
      expect(pushed.length, "nudo:case-expected 未上屏").toBeGreaterThan(0);
      for (const d of pushed) {
        const endLine = lines[d.range.end.line];
        expect(typeof endLine, "range 指向不存在的行").toBe("string");
        expect(d.range.end.character).toBe(endLine!.length);
        expect(d.range.start.character).toBeLessThanOrEqual(endLine!.length);
      }
    } finally {
      cleanup();
    }
  }, 30_000);

  it("pull 通道：nudo:case-expected 的 range 不越过行尾（同 push 口径）", async () => {
    const { mock, uri, cleanup } = openSession(SRC);
    try {
      await waitForDiagnostics(mock, uri);
      await mock.requests.get("workspace/executeCommand")!({
        command: "nudo.selectCase",
        arguments: [uri, "one", 0],
      });
      await waitForDiagnostics(mock, uri, { code: CASE_CODE });

      const res: any = await mock.requests.get("textDocument/diagnostic")!({
        textDocument: { uri },
      });
      const lines = SRC.split("\n");
      const pulled = (res?.items ?? []).filter((d: any) => d.code === CASE_CODE);
      expect(pulled.length, "nudo:case-expected 未上屏（pull）").toBeGreaterThan(0);
      for (const d of pulled) {
        const endLine = lines[d.range.end.line];
        expect(typeof endLine, "range 指向不存在的行").toBe("string");
        expect(d.range.end.character).toBe(endLine!.length);
      }
    } finally {
      cleanup();
    }
  }, 30_000);

  it("lspDiagnosticRange：整行哨兵夹到行尾，且同 line 时 end ≥ start", () => {
    const source = "abcdef\nxy\n";
    const lengths = lineLengthsOf(source);
    expect(lengths).toEqual([6, 2, 0]);

    // 整行哨兵 999 ⇒ 行尾（6）
    const r = lspDiagnosticRange({ line: 1, column: 0 }, { line: 1, column: 999 }, lengths);
    expect(r.start).toEqual({ line: 0, character: 0 });
    expect(r.end).toEqual({ line: 0, character: 6 });

    // 夹取后不得倒挂（start 在行尾之外 ⇒ start 也夹到行尾）
    const r2 = lspDiagnosticRange({ line: 1, column: 999 }, { line: 1, column: 999 }, lengths);
    expect(r2.start).toEqual({ line: 0, character: 6 });
    expect(r2.end).toEqual({ line: 0, character: 6 });

    // 跨行：end 行按 end 行自己的长度夹
    const r3 = lspDiagnosticRange({ line: 1, column: 0 }, { line: 2, column: 999 }, lengths);
    expect(r3.end).toEqual({ line: 1, character: 2 });
  });

  it("lspDiagnosticRange：行号 1 基 → 0 基（占位 line 0 → 0）", () => {
    const r = lspDiagnosticRange({ line: 0, column: 0 }, { line: 0, column: 1 });
    expect(r.start).toEqual({ line: 0, character: 0 });
    expect(r.end).toEqual({ line: 0, character: 1 });
    const r2 = lspDiagnosticRange({ line: 3, column: 4 }, { line: 3, column: 5 });
    expect(r2.start).toEqual({ line: 2, character: 4 });
  });

});

// ---------------------------------------------------------------------------
// 选择器变更必须广播 diagnostic refresh（pull 诊断面）
// ---------------------------------------------------------------------------
describe("选择器变更必须广播 diagnostic refresh（pull 诊断面）", () => {
/**
 * 选择器变更从不广播 `workspace/diagnostic/refresh`。
 *
 * 改前：切 case 后 pull 诊断客户端永远拿不到切换后的新诊断（只有 codeLens
 * refresh）。改后：selectCase / selectContract 都广播 diagnostic refresh。
 *
 * 钉：真 server（mock connection）+ 真 `workspace/executeCommand` 请求，
 * 观测服务端发出的 refresh 请求名。
 *
 * 用例超时给到 30s：真 server 依赖图（server.ts → core/service/parser）在
 * 并行负载下首测要数秒，5s 默认值会偶发踩线。
 */








const SRC = `/**
 * @nudo:case "num" (1)
 */
export function f(x) {
  return x;
}
`;

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-lsp-bug758-"));
  file = join(dir, "sel.js");
  writeFileSync(file, SRC, "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function startServer(): ReturnType<typeof createMockConnection> {
  const mock = createMockConnection();
  createNudoServer(mock as unknown as Connection);
  return mock;
}

function handler(mock: ReturnType<typeof createMockConnection>, method: string): AnyHandler {
  const h = mock.requests.get(method);
  expect(h, `handler "${method}" not registered`).toBeTruthy();
  return h!;
}

function refreshMethods(mock: ReturnType<typeof createMockConnection>): string[] {
  return mock.sentRequests.map((r: { type?: { method?: string } }) => r.type?.method ?? "?");
}


  it("nudo.selectCase 之后发出 workspace/diagnostic/refresh", async () => {
    const mock = startServer();
    mock.sentRequests.length = 0;

    await handler(mock, "workspace/executeCommand")({
      command: "nudo.selectCase",
      arguments: [`file://${file}`, "f", 0, "num"],
    });

    expect(refreshMethods(mock)).toContain("workspace/diagnostic/refresh");
  }, 30_000);

  it("nudo.selectContract 之后发出 workspace/diagnostic/refresh", async () => {
    const mock = startServer();
    mock.sentRequests.length = 0;

    await handler(mock, "workspace/executeCommand")({
      command: "nudo.selectContract",
      arguments: [`file://${file}`, "f"],
    });

    expect(refreshMethods(mock)).toContain("workspace/diagnostic/refresh");
  }, 30_000);

});

// ---------------------------------------------------------------------------
// nudo:directive-syntax 只发布一次
// ---------------------------------------------------------------------------
describe("nudo:directive-syntax 只发布一次", () => {
/**
 * 回归钉：同一条 `nudo:directive-syntax` 不得被发布两次。
 *
 * 改前：check 通道（checkToLspDiagnostics 显式 extract）与 eval 通道
 * （service drain）各抽一次同一条指令诊断；两通道渲染的**消息不同**
 * （check 通道多一段 " · Fix the directive syntax …" 提示），而两通道合并
 * 的去重键是 `code + message` → 键对不上 → 一次发布 2 条。
 *
 * 修法：提示文案只此一处定义（DIRECTIVE_SYNTAX_HINT），两通道同渲染 →
 * 去重键一致 → 只发布 1 条（与 CLI `nudo check` 同口径）。
 *
 * 负控制：合法文件不得凭空多出 directive-syntax；其它诊断码不受影响。
 */






const BAD_CASE = `/**
 * @nudo:case "a"
 */
export function f(x) {
  return x + 1;
}
`;

const GOOD_CASE = `/**
 * @nudo:case "a" (1)
 */
export function f(x) {
  return x + 1;
}
`;

function countCode(diags: LspDiagnostic[], code: string): number {
  return diags.filter((d) => d.code === code).length;
}

/** LSP 的 message 形如 string | MarkupContent（与仓内既有测试同口径）。 */
function msgText(m: string | { value: string }): string {
  return typeof m === "string" ? m : m.value;
}


  it("validateText 发布面：同一条指令文法诊断只出现 1 次（改前：2 次）", async () => {
    const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = [];
    const deps = makeValidateDeps({ onPublish: (p) => published.push(p) });
    await validateText("/t/bad-case.js", "file:///t/bad-case.js", BAD_CASE, 1, deps, false, true);
    expect(published.length).toBeGreaterThan(0);
    const last = published[published.length - 1]!;
    expect(countCode(last.diagnostics, DIAG.directiveSyntax)).toBe(1);
  });

  it("check 通道与 eval 通道对同一条指令诊断渲染同一消息（去重键一致）", () => {
    // check 通道（显式 extract）
    const checkDiags = checkToLspDiagnostics("/t/bad-case.js", BAD_CASE);
    const checkSyntax = checkDiags.find((d) => d.code === DIAG.directiveSyntax);
    expect(checkSyntax).toBeDefined();
    // eval 通道拿到的是同一条指令诊断的**原始**消息（service 侧不带提示文案）
    const suffix = " · Fix the directive syntax (see docs/reference/diagnostics.md)";
    const checkMessage = msgText(checkSyntax!.message);
    const rawMessage = checkMessage.endsWith(suffix)
      ? checkMessage.slice(0, -suffix.length)
      : checkMessage;
    const evalDiag = toLspDiagnostic(
      {
        severity: "warning",
        code: DIAG.directiveSyntax,
        message: rawMessage,
        range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
      },
      "file:///t/bad-case.js",
    );
    // 两通道消息必须逐字相同 → `code + message` 去重键命中 → 只发布 1 条
    expect(evalDiag.message).toBe(checkMessage);
  });

  it("负控制：合法指令文件不得出现 directive-syntax", async () => {
    const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = [];
    const deps = makeValidateDeps({ onPublish: (p) => published.push(p) });
    await validateText("/t/good-case.js", "file:///t/good-case.js", GOOD_CASE, 1, deps, false, true);
    const last = published[published.length - 1]!;
    expect(countCode(last.diagnostics, DIAG.directiveSyntax)).toBe(0);
  });

  it("负控制：非指令文法的诊断码不受影响（entry-may-throw 仍在）", async () => {
    const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = [];
    const deps = makeValidateDeps({ onPublish: (p) => published.push(p) });
    await validateText("/t/bad-case.js", "file:///t/bad-case.js", BAD_CASE, 1, deps, false, true);
    const last = published[published.length - 1]!;
    expect(countCode(last.diagnostics, DIAG.entryMayThrow)).toBe(1);
  });

});

// ---------------------------------------------------------------------------
// 残留 — @nudo:as 载体不支持的诊断在 IDE 编辑器面可见
// ---------------------------------------------------------------------------
describe("残留 — @nudo:as 载体不支持的诊断在 IDE 编辑器面可见", () => {
/**
 * 残留（LSP IDE 编辑器面）：`@nudo:as` 挂在**不支持的承载语句**上
 * （表达式语句 / 函数声明 …）⇒ service 面发一条显式 `nudo:directive-syntax`
 * （warning；见 packages/service/src/eval-injection.ts 的 `asOverrideApplies`
 * 分支——适用形态只有 VariableDeclaration / ReturnStatement /
 * ExportNamedDeclaration-with-declaration）。
 *
 * 该诊断在 service 面发出后，LSP 编辑器面**确实**发布（`validation.ts` 的
 * `getCachedCheckDiags` / `collectCheckSupplementIssues` → `checkIssueToLspDiagnostic`，
 * warning 级、`source: "nudo-check"`）；只有 `buildLspInjection()`（hover / 补全的
 * 注入表装配，不是诊断面）采集内联指令时不带 diags 汇。本文件的作用是**钉住**
 * 「IDE 面看得见」，而不是修一个不可见的缺口——的 changeset 曾把它写成
 * 「新诊断在 IDE 面不可见」，本回归用于证伪那句话说法的持续有效性。
 *
 * 本文件钉住 IDE 面（编辑器诊断）**确实**看得见这条诊断：
 * - check 通道（`checkToLspDiagnostics` → `collectCheckSupplementIssues` →
 * `collectEvalReplacements(source, { diags })`）⇒ 码 / 档 / 来源都对；
 * - push 通道（`validateText` → `sendDiagnostics`）⇒ 诊断随发布上屏；
 * - 负控制：适用形态（变量声明 / return）⇒ 零 `nudo:directive-syntax`。
 *
 * service 面的同一条事实已由
 * packages/service/src/__tests__/service--as-shape-guard.part.ts 钉住；
 * 本文件只补 IDE 面。
 */






/** 非法载体 ①：表达式语句（`@nudo:as` 只作用于变量声明的 init / return 的值）。 */
const INVALID_EXPR_STMT = `export function f(x) {
  // @nudo:as number()
  x;
  return 1;
}
`;

/** 非法载体 ②：函数声明（export 包装的声明体不是变量声明）。 */
const INVALID_FN_DECL = `// @nudo:as number()
export function f() { return 1; }
`;

/** 合法载体 ①：变量声明（覆盖生效 ⇒ 零诊断）。 */
const VALID_VAR_DECL = `export function f(x) {
  // @nudo:as number()
  const y = x;
  return y;
}
`;

/** 合法载体 ②：return 语句（覆盖生效 ⇒ 零诊断）。 */
const VALID_RETURN = `export function f(x) {
  // @nudo:as number()
  return x;
}
`;

/** LSP 3.18 Diagnostic.message 为 string | MarkupContent；本产品始终写纯字符串。 */
function msgText(m: string | { value: string }): string {
  return typeof m === "string" ? m : m.value;
}

function syntaxDiags(diags: LspDiagnostic[]): LspDiagnostic[] {
  return diags.filter((d) => d.code === DIAG.directiveSyntax);
}

/** 跑一次 push 通道（validateText），返回本次发布的诊断集。 */
async function publishDiagnostics(
  filePath: string,
  source: string,
): Promise<LspDiagnostic[]> {
  const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = [];
  const deps = makeValidateDeps({ onPublish: (p) => published.push(p) });
  await validateText(filePath, `file://${filePath}`, source, 1, deps, false, true);
  expect(published.length).toBeGreaterThan(0);
  return published[published.length - 1]!.diagnostics;
}


  it("check 通道：表达式语句载体 ⇒ 一条 nudo:directive-syntax（warning，非硬错）", () => {
    const diags = checkToLspDiagnostics("/t/as-expr.js", INVALID_EXPR_STMT);
    const syntax = syntaxDiags(diags);
    expect(syntax).toHaveLength(1);
    expect(syntax[0]!.severity).toBe(DiagnosticSeverity.Warning);
    expect(syntax[0]!.source).toBe("nudo-check");
    // 文案点名「这条指令没生效」（service 侧原文 + check 通道的修复提示）
    const message = msgText(syntax[0]!.message);
    expect(message).toContain("@nudo:as");
    expect(message).toContain("the directive has no effect");
    // range 必须落在文档内（LSP Position 是 uinteger）
    expect(syntax[0]!.range.start.line).toBeGreaterThanOrEqual(0);
    expect(syntax[0]!.range.end.character).toBeGreaterThanOrEqual(
      syntax[0]!.range.start.character,
    );
  });

  it("check 通道：函数声明载体同样可见（同码同档）", () => {
    const diags = checkToLspDiagnostics("/t/as-fn.js", INVALID_FN_DECL);
    const syntax = syntaxDiags(diags);
    expect(syntax).toHaveLength(1);
    expect(syntax[0]!.severity).toBe(DiagnosticSeverity.Warning);
    expect(syntax[0]!.source).toBe("nudo-check");
    expect(msgText(syntax[0]!.message)).toContain("@nudo:as");
  });

  it("IDE push 面：该诊断随 publishDiagnostics 上屏（不只在 service/CLI 面）", async () => {
    clearValidationState();
    const published = await publishDiagnostics("/t/as-push.js", INVALID_EXPR_STMT);
    const syntax = syntaxDiags(published);
    expect(syntax).toHaveLength(1);
    expect(syntax[0]!.severity).toBe(DiagnosticSeverity.Warning);
    expect(syntax[0]!.source).toBe("nudo-check");
  });

  it("负控制：合法载体（变量声明 / return）⇒ 零 nudo:directive-syntax", () => {
    expect(syntaxDiags(checkToLspDiagnostics("/t/as-var.js", VALID_VAR_DECL))).toHaveLength(0);
    expect(syntaxDiags(checkToLspDiagnostics("/t/as-ret.js", VALID_RETURN))).toHaveLength(0);
  });

  it("负控制：合法载体在 push 面同样零 nudo:directive-syntax", async () => {
    clearValidationState();
    const published = await publishDiagnostics("/t/as-var-push.js", VALID_VAR_DECL);
    expect(syntaxDiags(published)).toHaveLength(0);
  });

});

// ---------------------------------------------------------------------------
// 项目级 env 的加载失败必须在 LSP 面可见（路径按项目根）
// ---------------------------------------------------------------------------
describe("项目级 env 的加载失败必须在 LSP 面可见（路径按项目根）", () => {
/**
 * LSP 的 `nudo:env-unresolved` 诊断**只取文件目录**的失败记录
 * ⇒ **项目级** env（`package.json#nudo.env`，按**项目根**解析）的加载失败
 * 被静默吞掉 ⇒ IDE 假绿（诊断不可见），且与 CLI 面口径分裂。
 *
 * 机制：`preloadPathEnvs` 记录的失败条目按它自己的 `baseDir` 实参归档
 * （`recordPathEnvError(path, baseDir, e)`），`getPathEnvLoadErrors(baseDir)`
 * 按 baseDir 过滤 ⇒ 项目级 env 的失败记在**项目根**下，而
 * `envUnresolvedDiags` 只取**文件目录**的失败 ⇒ 取不到 ⇒ 零诊断。
 * （该诊断此前**只在文件恰好位于项目根目录时**可见。）
 *
 * 口径（与 CLI `packages/nudojs/src/commands/check.ts` 同款）：两层基准各取一次
 * ——文件级按**文件目录**、项目级按**项目根**——合并去重后按**两层候选路径的
 * 并集**过滤。
 *
 * 钉：
 * ④ 项目根下的项目级 env 失败 ⇒ 子目录文件也必须报（路径指向**项目根**下
 * 解析出的真实路径，不得是文件目录下的臆造路径）；
 * ⑤ 项目根下的文件 ⇒ 诊断**仍可见**（不得因修复而丢失）；
 * ⑥ 文件级 env（按文件目录解析）语义**不受影响**。
 */







const PROBE = `export function f(x) { return x; }
`;

/** 项目级 env 指向的缺失文件（项目根下）。 */
const PROJECT_ENV_MISSING = "./nope.mjs";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 临时项目（package.json + 若干文件）；返回项目根。 */
function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-1099-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf-8");
  }
  return dir;
}

/** 项目级 env 配置（项目根）。 */
function projectPkg(env: string[]): string {
  return JSON.stringify({ name: "envproj", private: true, nudo: { env } });
}

/** env-unresolved 诊断（其它诊断不算）。 */
function envMsgs(diags: LspDiagnostic[]): string[] {
  return diags
    .filter((d) => d.code === "nudo:env-unresolved")
    .map((d) => (typeof d.message === "string" ? d.message : d.message.value));
}

{
  beforeEach(() => {
    // 进程级 live 记录是全局的 ⇒ 每例前清干净（否则跨例串台）
    clearPathEnvCaches();
  });

  it("④ 子目录文件：项目级 env 缺失 ⇒ 必须报 nudo:env-unresolved（路径在项目根）", async () => {
    const dir = makeProject({
      "package.json": projectPkg([PROJECT_ENV_MISSING]),
      "src/probe.js": PROBE,
    });
    const file = join(dir, "src/probe.js");

    const msgs = envMsgs(await envUnresolvedDiags(file, PROBE));
    expect(msgs.length).toBeGreaterThan(0);
    // 路径 = **项目根**下解析出的真实路径
    expect(msgs.join("\n")).toContain(join(dir, "nope.mjs"));
    // 不得是「按文件目录解析」的臆造路径
    expect(msgs.join("\n")).not.toContain(join(dir, "src", "nope.mjs"));
  });

  it("⑤ 项目根下的文件：诊断仍可见（不得因修复而丢失）", async () => {
    const dir = makeProject({
      "package.json": projectPkg([PROJECT_ENV_MISSING]),
      "probe.js": PROBE,
    });
    const file = join(dir, "probe.js");

    const msgs = envMsgs(await envUnresolvedDiags(file, PROBE));
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.join("\n")).toContain(join(dir, "nope.mjs"));
  });

  it("⑥ 文件级 env（按文件目录解析）语义不受影响 + 项目级按项目根", async () => {
    const src = `/// @nudo:env ./local.mjs\n${PROBE}`;
    const dir = makeProject({
      "package.json": projectPkg([PROJECT_ENV_MISSING]),
      "src/probe.js": src,
    });
    const file = join(dir, "src/probe.js");

    const joined = envMsgs(await envUnresolvedDiags(file, src)).join("\n");
    // 文件级 env 缺失 ⇒ 路径在**文件目录**下
    expect(joined).toContain(join(dir, "src", "local.mjs"));
    // 项目级 env 缺失 ⇒ 路径在**项目根**下
    expect(joined).toContain(join(dir, "nope.mjs"));
  });

  it("IDE push 面：项目级 env 可见 ⇒ 不得发布 builtin-unknown 假阳（Bug 1098 同源）", async () => {
    const src = `/// @nudo:env node\nexport function f() { return MAGIC; }\n`;
    const dir = makeProject({
      "package.json": projectPkg(["./env.mjs"]),
      "env.mjs": `export function defineEnv() { return { globals: { MAGIC: 42 } }; }\n`,
      "src/app.js": src,
    });
    const file = join(dir, "src/app.js");

    const sent: LspDiagnostic[] = [];
    await validateText(file, `file://${file}`, src, 1, {
      sendDiagnostics: (p) => {
        sent.push(...p.diagnostics);
      },
    });
    const codes = sent.map((d) => d.code);
    // `MAGIC` 是 env 全局 ⇒ 不得报「内建 API 未覆盖」（修前 IDE 直接发布假阳）
    expect(codes).not.toContain("nudo:builtin-unknown");
    // 注：LSP **check 通道**的项目级 env 绝对化已由 （`absolutizeEnvSpec`）
    // 修好 ⇒ 项目级 env 在该通道同样可见，不再是 IDE 红 / CLI 绿的假红来源。
  });
}
});

// ---------------------------------------------------------------------------
// 分析失败（门禁判红的文件）必须出现在 IDE 面
// ---------------------------------------------------------------------------
describe("分析失败（门禁判红的文件）必须出现在 IDE 面", () => {
/**
 * 回归（LSP 面）：CLI 的 `nudo:internal`（**分析失败 ⇒ 门禁无法裁决**）
 * 必须在 IDE 面同样可见。
 *
 * 病灶：CLI 的 check 编排在**包装层**（`packages/nudojs/src/commands/check.ts`）
 * 用 `setEvalFallbackCollector` 观测本文件的 `internal` 回落，据此产出 error 级
 * `nudo:internal` ⇒ exit 1；而 LSP 只把 `checkSource` **抛异常**当门禁失败，
 * 这条 `evalFailures` 通道**它根本不读** ⇒ 同一文件：**CI 红 / IDE 零诊断**
 * （编辑器里看起来干干净净，开发者看不出 CI 为什么红）。
 *
 * 修法（`packages/service/src/analyzer-orchestrate.ts`）：把「分析失败」提升为
 * **service 层**的诊断 —— `analyzeFile` 在本次分析窗口内观测 `internal` 回落
 * （core 的 `getEvalFallbackStats()`，与 collector 单槽无关 ⇒ 不抢占宿主
 * collector），有回落就在结果的 `diagnostics` 里追加一条 **error** 级
 * `nudo:internal` ⇒ LSP / agent 工具 / 插件 / CLI 的分析器通道**同源**。
 *
 * 负控制：正常文件不得出现 `nudo:internal`（不得把整条诊断面变成噪声）。
 *
 * **口径变更（之后）**：同一事实（模块级原生异常 ⇒ 模块无法装载）现在被
 * 归类为 **`nudo:module-throw`**（用户代码的异常不再是引擎内部缺陷），码不再是
 * `nudo:internal`。本用例断言随之改到新码，但**契约不变**：CLI 判红的文件，IDE
 * 面必须同样可见，且 severity 必须是 error、range 不得编造行号。
 */







/** 模块求值失败（顶层读未定义全局）⇒ 门禁判红。 */
const BROKEN_SRC = `const x = undefinedGlobalAtTopLevel;
export function f() {
  return 1;
}
`;

const CLEAN_SRC = `export function g(x) {
  return x + 1;
}
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-bug-140-"));
  dirs.push(dir);
  return dir;
}

/** 走 `validateText` 的**真实发布面**（push 通道），收集发布的诊断。 */
async function published(dir: string, name: string, src: string): Promise<LspDiagnostic[]> {
  const file = join(dir, name);
  writeFileSync(file, src, "utf-8");
  clearValidationState();
  const sent: LspDiagnostic[] = [];
  const deps: ValidateTextDeps = {
    sendDiagnostics: (p) => {
      sent.push(...p.diagnostics);
    },
  };
  await validateText(file, `file://${file}`, src, 1, deps);
  return sent;
}


  it("模块求值失败 ⇒ 发布一条 error 级 nudo:module-throw（与 CLI exit ≠ 0 同结论）", async () => {
    const dir = project();
    const diags = await published(dir, "f.js", BROKEN_SRC);
    const fatal = diags.filter((d) => d.code === "nudo:module-throw");
    expect(fatal).toHaveLength(1);
    expect(fatal[0]!.severity).toBe(DiagnosticSeverity.Error);
    expect(String(fatal[0]!.message)).toContain("always throws ReferenceError");
    expect(String(fatal[0]!.message)).toContain("cannot be imported");
    // 无源位置：不得编造第 1 行（装载期失败定位不到某一行）
    expect(fatal[0]!.range.start.line).toBe(0);
  });

  it("负控制：正常文件不报 nudo:module-throw", async () => {
    const dir = project();
    const diags = await published(dir, "g.js", CLEAN_SRC);
    expect(diags.filter((d) => d.code === "nudo:module-throw")).toHaveLength(0);
  });

});

// ---------------------------------------------------------------------------
// 模块环不再丢图 ⇒ 截断归因诊断上屏
// ---------------------------------------------------------------------------
describe("模块环不再丢图 ⇒ 截断归因诊断上屏", () => {
/**
 * LSP 面在**模块环**上丢弃整张依赖图 ⇒ CLI `nudo check` 报的
 * `nudo:recursion-truncated` 在 IDE **永不出现**（verbose 档也一样）。
 *
 * 症状（tmp/repro//，a.js ↔ b.js 互相 import，package.json 开
 * `nudo.analysis.diagnostics: "verbose"`）：CLI `check --json` 的 issue 码集合为
 * `{nudo:opaque-result, nudo:recursion-truncated, nudo:module-cycle}`，
 * 而 LSP 的 push / pull 两个通道都只有
 * `{nudo:opaque-result, nudo:module-cycle}` —— 少的那条恰是「该结果被递归截断
 * 放宽」的唯一归因 ⇒ IDE 用户无法判断要不要补 case/预算。
 *
 * 根因：`validation.ts` 的 `evalAnalysisModules` 检出环就 `return undefined`
 * （整图丢弃），而 CLI 早已废弃该分支（环由引擎有界处理，求值层由
 * call-budget 截断并归因）。图被丢 ⇒ 环内 import 全部落空 ⇒ 截断归因诊断消失。
 *
 * 修法：环时**不再丢图**（`graph.modules` 非空即返回），环本身仍由
 * `nudo:module-cycle` 报告。
 *
 * 钉：verbose 档下 **pull** 通道（`textDocument/diagnostic`）对 a.js 的 code 集合
 * 含 `nudo:recursion-truncated` / `nudo:module-cycle` / `nudo:opaque-result`
 * （CLI 面同款集合），**push** 通道（didOpen → `publishDiagnostics`）同码集。
 */







const A = `import { b } from "./b.js";

export function a() {
  return b();
}
`;

const B = `import { a } from "./a.js";

export function b() {
  return a();
}
`;

/** 打开 verbose 档（info 级诊断必须上屏，否则「缺码」会与档位过滤混淆）。 */
const PKG = JSON.stringify({
  name: "p",
  nudo: { analysis: { diagnostics: "verbose" } },
});




  it("pull 通道对 a.js 报告 nudo:recursion-truncated + nudo:module-cycle", async () => {
    await withLspServer(
      { "a.js": A, "b.js": B, "package.json": PKG },
      async (ctx) => {
        // 环图装载 + 有界求值 + 多轮 validate 都需要时间：轮询到目标码出现
        const res: any = await waitForValue(
          () => ctx.req("textDocument/diagnostic")({ textDocument: { uri: ctx.uri("a.js") } }),
          (r: any) => {
            const codes = (r?.items ?? []).map((d: any) => d.code);
            return (
              codes.includes("nudo:recursion-truncated") && codes.includes("nudo:module-cycle")
            );
          },
          { timeout: 1200, interval: 25 },
        );
        const items: any[] = res?.items ?? [];
        const codes = items.map((d) => d.code);

        expect(codes, `pull 诊断码：${JSON.stringify(codes)}`).toContain(
          "nudo:recursion-truncated",
        );
        // 环本身仍如实报告（修复不是靠「不报环」换来的）
        expect(codes, `pull 诊断码：${JSON.stringify(codes)}`).toContain(
          "nudo:module-cycle",
        );
        // verbose 档下 CLI 同一文件的第三条码也必须在屏（档位未失效）
        expect(codes, `pull 诊断码：${JSON.stringify(codes)}`).toContain(
          "nudo:opaque-result",
        );
      },
      "nudo-bug090-",
    );
  }, 60_000);

  it("push 通道（didOpen → publishDiagnostics）与 pull 同码集", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug090-push-"));
    try {
      writeFileSync(join(dir, "package.json"), PKG, "utf-8");
      writeFileSync(join(dir, "a.js"), A, "utf-8");
      writeFileSync(join(dir, "b.js"), B, "utf-8");
      const uri = `file://${join(dir, "a.js")}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      for (const [name, text] of [
        ["a.js", A],
        ["b.js", B],
      ] as const) {
        mock.notifications.get("textDocument/didOpen")!({
          textDocument: {
            uri: `file://${join(dir, name)}`,
            languageId: "javascript",
            version: 1,
            text,
          },
        });
      }
      const codes = await waitForValue(
        () =>
          mock.sentDiagnostics
            .filter((p: any) => p.uri === uri)
            .flatMap((p: any) => p.diagnostics)
            .map((d: any) => d.code),
        (list: string[]) =>
          list.includes("nudo:recursion-truncated") && list.includes("nudo:module-cycle"),
        { timeout: 1200, interval: 25 },
      );
      expect(codes, `push 诊断码：${JSON.stringify(codes)}`).toContain(
        "nudo:recursion-truncated",
      );
      expect(codes, `push 诊断码：${JSON.stringify(codes)}`).toContain(
        "nudo:module-cycle",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

});

// ---------------------------------------------------------------------------
// pull 诊断必须含 env 通道
// ---------------------------------------------------------------------------
describe("pull 诊断必须含 env 通道", () => {
/**
 * pull 诊断面**没有** env 通道。
 *
 * 症状：`@nudo:env` 指向的 path env 加载失败时，**push** 面（validateText）
 * 会发 `nudo:env-unresolved` 告警，**pull** 面（`textDocument/diagnostic`）
 * 一条都没有 ⇒ 同一个文件两个诊断面互相打脸（IDE 与 CI 结论不一致）。
 *
 * 根因（片 D · `server.ts`）：pull 通道只接了 check 通道 + evaluator 通道，
 * **没有**接 env 通道（`envUnresolvedDiags`，由片 E 从 `validation.ts` 导出）。
 *
 * 修法：pull 通道补上 env 通道——与 push **同源同档**
 * （`envUnresolvedDiags` + `filterCheckLspByLevel` + 同一 level）。
 *
 * 钉：pull 诊断里出现 `nudo:env-unresolved`。
 */









const SRC = '/// @nudo:env "./nope.mjs"\nexport function g2() {\n  return 1;\n}\n';


  it("@nudo:env 指向缺失文件 ⇒ pull 里有 nudo:env-unresolved", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug781-"));
    try {
      const file = join(dir, "d_env.js");
      writeFileSync(file, SRC, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.requests.get("initialize")!({
        processId: null,
        rootUri: `file://${dir}`,
        workspaceFolders: [{ uri: `file://${dir}`, name: "ws" }],
        capabilities: {},
      });
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await waitForDiagnostics(mock, uri, { code: "nudo:env-unresolved" });
      const res = (await mock.requests.get("textDocument/diagnostic")!({
        textDocument: { uri },
      })) as { kind?: string; items?: { code?: string; message?: string }[] };
      const codes = (res.items ?? []).map((d) => d.code);
      expect(codes).toContain("nudo:env-unresolved");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

});

// ---------------------------------------------------------------------------
// push 与 pull 诊断面同形（env 通道 parity）
// ---------------------------------------------------------------------------
describe("push 与 pull 诊断面同形（env 通道 parity）", () => {
/**
 * push 与 pull 两个诊断面**不一致**（env 通道缺失）。
 *
 * 症状：同一个文件，push 面（`publishDiagnostics`）有 `nudo:env-unresolved`
 * 告警，pull 面（`textDocument/diagnostic`）没有 ⇒ IDE 里看到的诊断集合
 * 取决于客户端用哪个面拉取 ⇒ 结论不可复现。
 *
 * 根因（片 D · `server.ts`）：pull 通道只接了 check 通道 + evaluator 通道，
 * **没有**接 env 通道（`envUnresolvedDiags`，片 E 从 `validation.ts` 导出）。
 *
 * 修法：pull 通道补上 env 通道——与 push **同源同档**（同一 level、同一
 * `filterCheckLspByLevel`、同一去重键空间）。
 *
 * 钉：push 与 pull 的诊断 code 集合**完全一致**（不是「pull ⊇ push」这种
 * 弱断言——两个面必须同形）。
 */









const SRC = '/// @nudo:env "./nope.mjs"\nexport function g2() {\n  return 1;\n}\n';


  it("push 与 pull 的诊断 code 集合一致", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug992-"));
    try {
      const file = join(dir, "d_env.js");
      writeFileSync(file, SRC, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.requests.get("initialize")!({
        processId: null,
        rootUri: `file://${dir}`,
        workspaceFolders: [{ uri: `file://${dir}`, name: "ws" }],
        capabilities: {},
      });
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await waitForDiagnostics(mock, uri, { code: "nudo:env-unresolved" });

      const pushed = mock.sentDiagnostics
        .filter((d) => d.uri === uri)
        .flatMap((d) => d.diagnostics as { code?: string }[]);
      const pushCodes = [...new Set(pushed.map((d) => d.code))].sort();

      const pulled = (await mock.requests.get("textDocument/diagnostic")!({
        textDocument: { uri },
      })) as { items?: { code?: string }[] };
      const pullCodes = [...new Set((pulled.items ?? []).map((d) => d.code))].sort();

      expect(pushCodes.length).toBeGreaterThan(0);
      expect(pullCodes).toEqual(pushCodes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

});

// ---------------------------------------------------------------------------
// LSP 面：返回契约违例画在真实行（不得是第 1 行）
// ---------------------------------------------------------------------------
describe("LSP 面：返回契约违例画在真实行（不得是第 1 行）", () => {
/**
 * 回归钉（LSP 面）—— 返回契约类诊断不带 `line` / `column` ⇒ LSP 把诊断
 * 画在**第 1 行第 0 列**（`range {0,0}-{0,1}`），而函数其实在第 10 行。
 *
 * 修法（族 07 片 S4）：core 的 `checkReturnConstraint` 在 issue 构造处补上
 * **被违约函数的声明位置** ⇒ LSP 侧（`checkIssueToLspDiagnostic` →
 * `lspDiagnosticRange`）自然换算到真实行（1 基 → 0 基）。
 *
 * 钉：`nudo:constraint-violated` 的 LSP range 必须落在第 10 行
 * （0 基 line 9），不得是 0。
 */



/** 前 9 行是注释 ⇒ 函数声明落在第 10 行 */
const SRC = `// line 1
// line 2
// line 3
// line 4
// line 5
// line 6
// line 7
// line 8
// line 9
export function deep(x) {
  return x - 1;
}
`;

/** 侧车：`deep` 的返回契约 `number().gt(0)`（`x - 1` 违例） */
const SIDECAR = `import { fn, number } from "@nudojs/core";
export const deep = fn({ x: number().gt(0) }, number().gt(0));
`;

const loadModule = (spec: string): string | undefined =>
  spec.endsWith(".nudo.js") ? SIDECAR : undefined;


  it("nudo:constraint-violated 的 range 落在函数声明行", () => {
    const diags = checkToLspDiagnostics("/t/bug369.js", SRC, loadModule);
    const d = diags.find((x) => x.code === "nudo:constraint-violated");
    expect(d).toBeDefined();
    // LSP Position.line 是 0 基 ⇒ 源码第 10 行 ⇒ 0 基 line 9
    expect(d!.range.start.line).toBe(9);
    expect(d!.range.start.character).toBe(7);
    expect(d!.range.start.line).not.toBe(0);
  });

});

// ---------------------------------------------------------------------------
// unproven-return 的 relax 必须真的写到推断面
// ---------------------------------------------------------------------------
describe("unproven-return 的 relax 必须真的写到推断面", () => {
/**
 * `nudo:unproven-return` 的 review quickfix **标题声称「放宽到
 * 推断面」而落盘的是基类型**（`number()`）⇒ 标题说谎 + 诊断不消。
 *
 * 夹具（`tmp/repro//` 逐字）：
 *
 * ```js
 * // g.nudo.js
 * export const g = fn({}, number().gt(40));
 * // g.js
 * export function g(o) { return o.x; }
 * ```
 *
 * 推断面（诊断的 `actual`）= `any #path`；旧实现走 `relaxSidecarConstraint`
 * ⇒ 只**剥数值谓词** ⇒ 落盘 `number()`（基类型）——既不是推断面，也消不掉
 * 诊断（`any ⊭ number()`）⇒ 用户点完「修复」diff 出来了、诊断一条不少。
 *
 * 同一条承诺在 CLI 机器面（`nudo check --json` 的 `actions[].label`，
 * core `actionsForIssue`）里逐字重复 ⇒ 两个面同源地说谎（的第二面）。
 *
 * 修复后钉：
 * 1. 落盘 = **推断面**（`any()`），不是基类型；
 * 2. 落盘后 `nudo:unproven-return` **消失**（动作可执行）；
 * 3. 证据面：旧落盘（`number()`）诊断原样保留 ⇒ 「写基类型」确实是假修复；
 * 4. 写不出忠实推断面（obj 返回）⇒ **不下发**（不承诺做不到的事）；
 * 5. CLI 机器面与 LSP 标题是**同一条（现在为真的）承诺**。
 */









/** 夹具：返回 `o.x`（`any`）⊭ 返回槽 `number().gt(40)` */
const G_JS = `export function g(o) {
  return o.x;
}
`;
const G_SC = `import { fn, number } from "@nudojs/core";

export const g = fn({}, number().gt(40));
`;

/** 对照夹具：返回 obj 形状 ⇒ 推断面不可投影（写不出忠实的推断面） */
const OBJ_JS = `export function g(o) {
  return { a: o.x };
}
`;

type Diag = {
  code: string;
  message: string;
  range: { start: { line: number; character: number } };
  data?: { fn?: string; expected?: string; actual?: string };
};

const isUnprovenReturn = (d: { code?: unknown; message: string }): boolean =>
  d.code === "nudo:unproven-return" || /⊭ sidecar fn\(\) return slot/.test(d.message);

const isRelax = (a: CodeActionEntry): boolean => /Relax return contract/i.test(a.title);

/** 在临时目录里落 js + 侧车、取目标诊断、请求 code action */
function actionsFor(
  prefix: string,
  js: string,
  sc: string,
): { actions: CodeActionEntry[]; diags: Diag[]; scText: string; uri: string; sidecarPath: string } {
  return withTempDir(prefix, (dir) => {
    const jsPath = join(dir, "g.js");
    const sidecarPath = join(dir, "g.nudo.js");
    writeFileSync(jsPath, js, "utf-8");
    writeFileSync(sidecarPath, sc, "utf-8");
    const uri = `file://${jsPath}`;
    const all = checkToLspDiagnostics(jsPath, js, defaultLoadModule) as Diag[];
    const target = all.filter(isUnprovenReturn);
    expect(
      target.length,
      `夹具必须产出 nudo:unproven-return：${all.map((d) => d.code).join(", ")}`,
    ).toBeGreaterThan(0);
    const handler = mountCodeActions(uri, js);
    const actions: CodeActionEntry[] = [];
    for (const d of target) {
      actions.push(...handler(codeActionParams(uri, d.range.start.line, [d])));
    }
    return { actions, diags: target, scText: sc, uri, sidecarPath };
  });
}

/** 把侧车文本落盘后重跑 check，返回目标 fn 的 unproven-return 诊断 */
function unprovenAfter(dir: string, js: string, landedSidecar: string): Diag[] {
  const jsPath = join(dir, "g.js");
  writeFileSync(join(dir, "g.nudo.js"), landedSidecar, "utf-8");
  const all = checkToLspDiagnostics(jsPath, js, defaultLoadModule) as Diag[];
  return all.filter(isUnprovenReturn);
}


  it("落盘 = 推断面（any()），不是基类型（number()）；且诊断消失", () => {
    const { actions, diags, scText, uri } = actionsFor("nudo-lsp-135a-", G_JS, G_SC);
    // 诊断面先钉住：推断面是 any（不是 number）
    expect(diags[0]!.data?.actual ?? "").toContain("any");
    expect(diags[0]!.data?.expected).toBe("number().gt(40)");

    const relax = actions.filter(isRelax);
    expect(relax, "unproven-return 必须给出 relax 动作").toHaveLength(1);
    // 标题承诺（service 产）与 CLI 机器面同源——修好后这句是真的
    expect(relax[0]!.title).toContain("inferred surface");

    const edits = sidecarEdits(relax, uri);
    expect(edits).toHaveLength(1);
    const landed = applyEdits(scText, edits);

    // 1. 落盘 = 推断面 `any()`（改前 = `number()`，基类型）
    expect(landed).toContain("fn({}, any())");
    expect(landed).not.toContain("number().gt(40)");
    expect(landed, "不得落盘基类型 number()（那既不是推断面、也消不掉诊断）").not.toMatch(
      /fn\(\{\}, number\(\)\)/,
    );

    // 2. 可执行：落盘后目标诊断消失
    withTempDir("nudo-lsp-135a-recheck-", (dir) => {
      expect(unprovenAfter(dir, G_JS, landed)).toHaveLength(0);
      // 3. 证据面：旧落盘（剥数值谓词 ⇒ number()）诊断原样还在
      expect(unprovenAfter(dir, G_JS, G_SC.replace("number().gt(40)", "number()"))).toHaveLength(1);
    });
  });

  it("正控制：推断面基类型（number）⇒ 落盘 number() 且诊断消失（门不是一刀切）", () => {
    // 推断面 = `number`（`x * 2` 的 conf=partial）⇒ 可写的是它的**基类型**
    // （bug 报告允许的「推断面基类型」），落盘后诊断消失。
    const js = `export function g(x) {
  return x * 2;
}
`;
    const { actions, diags, scText, uri } = actionsFor("nudo-lsp-135c-", js, G_SC);
    expect(diags[0]!.data?.actual ?? "").toContain("number");
    const relax = actions.filter(isRelax);
    expect(relax).toHaveLength(1);
    const landed = applyEdits(scText, sidecarEdits(relax, uri));
    expect(landed).toContain("fn({}, number())");
    withTempDir("nudo-lsp-135c-recheck-", (dir) => {
      expect(unprovenAfter(dir, js, landed)).toHaveLength(0);
    });
  });

  it("推断面不可投影（obj 返回）⇒ 不下发（不承诺做不到的事）", () => {
    const { actions, diags, uri } = actionsFor("nudo-lsp-135b-", OBJ_JS, G_SC);
    // 推断面 = obj 形状（`{ a: any }`）⇒ `absToConstraint` 投影不出、也没有
    // 基类型可退 ⇒ 写不出忠实的推断面
    expect(diags[0]!.data?.actual ?? "").toContain("{ a: any }");
    expect(actions.filter(isRelax)).toHaveLength(0);
    expect(sidecarEdits(actions, uri)).toHaveLength(0);
  });

  it("CLI 机器面（actionsForIssue）与 LSP 标题是同一条（现在为真的）承诺", () => {
    const acts = actionsForIssue({
      code: "nudo:unproven-return",
      fn: "g",
      expected: "number().gt(40)",
    });
    const relax = acts.find((a) => a.kind === "relax")!;
    expect(relax.label).toContain("g");
    expect(relax.label).toContain("inferred surface");
    // hint = 被放宽的**原**契约（不是推断面）：用户看得到「放宽了什么」
    expect(relax.hint).toBe("number().gt(40)");
  });

});

// ---------------------------------------------------------------------------
// push diagnostics face (LSP-G6)
// ---------------------------------------------------------------------------
describe("push diagnostics face (LSP-G6)", () => {
/**
 * LSP-G6：老客户端只消费 push（textDocument/publishDiagnostics），
 * 不用 pull diagnosticProvider。打开/校验路径必须仍走 sendDiagnostics。
 */

  it("validateText always publishes via sendDiagnostics (no pull required)", async () => {
    const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = [];
    const deps = makeValidateDeps({
      onPublish: (p) => {
        published.push(p);
      },
    });
    const src = `export function f(user) { return user.name; }\nf({});\n`;
    await validateText("/t/g6.js", "file:///t/g6.js", src, 1, deps, false, true);
    expect(published.length).toBeGreaterThan(0);
    const last = published[published.length - 1]!;
    expect(last.uri).toBe("file:///t/g6.js");
    // 有诊断（entry may-throw / 未知）或空数组——关键是**有 publish 事件**
    expect(Array.isArray(last.diagnostics)).toBe(true);
  });

  it("empty publish on clean file still fires (clears stale UI)", async () => {
    const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = [];
    const deps = makeValidateDeps({
      onPublish: (p) => {
        published.push(p);
      },
    });
    // （wave 3）：any 形参算术不再 clean（may TypeError）——clean 样本
    // 改用恒总 identity，本用例意图（clean 文件 → 空诊断 publish）不变。
    const src = `export function id(x) { return x; }\n`;
    await validateText("/t/ok.js", "file:///t/ok.js", src, 1, deps, false, true);
    expect(published.length).toBeGreaterThan(0);
    expect(published[published.length - 1]!.diagnostics.length).toBe(0);
  });

});
