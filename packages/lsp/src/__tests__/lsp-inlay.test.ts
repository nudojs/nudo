/**
 * 模块套件：inlayHint 面（位置/range / 参数归一 / unknown 责任）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNudoServer } from "../server.ts";
import { createMockConnection, withLspServer } from "./helpers.ts";

type Range = { start: { line: number; character: number }; end: { line: number; character: number } };
type Hint = { position: { line: number; character: number }; label: string; tooltip?: string };

const BODY = `export function alpha(x) {\n  return x + 1;\n}\n`;
const POS_SRC = `export function alpha(x) { return x; }\n\nexport function beta(y) { return y; }\n`;

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-inlay-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function hintsFor(
  file: string,
  text: string,
  range?: Range,
  initOptions?: unknown,
): Promise<Hint[]> {
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  if (initOptions !== undefined) {
    mock.requests.get("initialize")!({
      processId: null,
      rootUri: null,
      workspaceFolders: [],
      capabilities: {},
      initializationOptions: initOptions,
    });
  }
  const uri = `file://${file}`;
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri, languageId: "javascript", version: 1, text },
  });
  await new Promise((r) => setTimeout(r, 250));
  return (mock.requests.get("textDocument/inlayHint")!({
    textDocument: { uri },
    ...(range ? { range } : {}),
  }) ?? []) as Hint[];
}

const visibleLengths = (text: string) => text.split(/\r\n|\r|\n/).map((l) => l.length);

describe("inlayHint：位置与 range 契约", () => {
  const visibleLengths = (text: string) => text.split(/\r\n|\r|\n/).map((l) => l.length);
  it("LF/CRLF 行内且 CRLF 与 LF 逐条一致；区间过滤；缺省 range fail-open", async () => {
    await withDir(async (dir) => {
      const lfFile = join(dir, "lf.js");
      const crlfFile = join(dir, "crlf.js");
      const crlf = BODY.replace(/\n/g, "\r\n");
      writeFileSync(lfFile, BODY);
      writeFileSync(crlfFile, crlf);
      const lfHints = await hintsFor(lfFile, BODY);
      expect(lfHints.length).toBeGreaterThan(0);
      const visible = visibleLengths(BODY);
      for (const h of lfHints) expect(h.position.character).toBeLessThanOrEqual(visible[h.position.line] ?? 0);
      const eol = lfHints.find((h) => h.label.includes("contract"));
      expect(eol, `缺行尾 contract hint：${JSON.stringify(lfHints)}`).toBeDefined();
      expect(eol!.position.character).toBe(visible[eol!.position.line]);

      const crlfHints = await hintsFor(crlfFile, crlf);
      expect(JSON.stringify(crlfHints)).toBe(JSON.stringify(lfHints));
      const crlfVisible = visibleLengths(crlf);
      for (const h of crlfHints) expect(h.position.character).toBeLessThanOrEqual(crlfVisible[h.position.line] ?? 0);
      expect(crlfHints.find((h) => h.label.includes("contract"))!.position.character).toBe(crlfVisible[crlfHints.find((h) => h.label.includes("contract"))!.position.line]);
    });
    await withDir(async (dir) => {
      const lfFile = join(dir, "lf.js");
      const crlfFile = join(dir, "crlf.js");
      const crlf = POS_SRC.replace(/\n/g, "\r\n");
      writeFileSync(lfFile, POS_SRC);
      writeFileSync(crlfFile, crlf);
      const whole = await hintsFor(lfFile, POS_SRC);
      expect(whole.length).toBeGreaterThan(1);
      const line0 = { start: { line: 0, character: 0 }, end: { line: 0, character: 40 } };
      const line2 = { start: { line: 2, character: 0 }, end: { line: 2, character: 40 } };
      const lf0 = await hintsFor(lfFile, POS_SRC, line0);
      const lf2 = await hintsFor(lfFile, POS_SRC, line2);
      const crlf0 = await hintsFor(crlfFile, crlf, line0);
      expect(lf0.length).toBeGreaterThan(0);
      expect(lf2.length).toBeGreaterThan(0);
      expect(lf0.every((h) => h.position.line === 0)).toBe(true);
      expect(lf2.every((h) => h.position.line === 2)).toBe(true);
      expect(JSON.stringify(lf0)).not.toBe(JSON.stringify(lf2));
      expect(JSON.stringify(lf0)).not.toBe(JSON.stringify(whole));
      expect(JSON.stringify(crlf0)).toBe(JSON.stringify(lf0));
      expect(await hintsFor(lfFile, POS_SRC, { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } })).toEqual([]);
      expect(JSON.stringify(await hintsFor(lfFile, POS_SRC, undefined))).toBe(JSON.stringify(whole));
    });
  });
});

// ---------------------------------------------------------------------------
// 项目侧 inlayHints.parameters 与宿主侧同口径
// ---------------------------------------------------------------------------
describe("项目侧 inlayHints.parameters 与宿主侧同口径", () => {
/**
 * 项目侧的 `nudo.inlayHints.parameters` 与宿主侧**两套规则**。
 *
 * 症状：项目 `package.json` 写 `nudo.inlayHints.parameters: "false"`
 * （字符串）⇒ IDE 里参数 inlay 仍然**开着**；同一台机器把宿主设置
 * `nudo.inlayHints.parameters` 改成 `false` ⇒ 参数 inlay **关掉**。
 * 同一个键、同一个值、两种行为。
 *
 * 根因（片 D · `server.ts`）：宿主侧走 `parseInlayParams`
 * （`typeof raw === "boolean" ? raw : undefined` ⇒ 非法值回落默认），
 * 项目侧却**原样返回**原始值 ⇒ 字符串 `"false"` 是真值 ⇒ 反而**开启**。
 *
 * 修法：项目侧与宿主侧**同一个归一化函数**——非法值（非 boolean）一律
 * 回落默认（关），并记一条可读告警。
 *
 * 钉：① 项目 `"false"` ⇒ 参数 inlay **关**（与宿主同口径）；
 * ② 项目 `true` ⇒ 参数 inlay **开**；③ 宿主 `"false"` ⇒ 关（不回归）。
 */







const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SRC = "export function getName(user) {\n  return user.name;\n}\n";
const SIDECAR = `import { fn, shape, string } from "@nudojs/core";

export const getName = fn({ user: shape({ name: string() }) }, string());
`;

async function hintLabels(
  pkg: unknown,
  initOptions?: unknown,
): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug790-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg), "utf-8");
    writeFileSync(join(dir, "lib.js"), SRC, "utf-8");
    writeFileSync(join(dir, "lib.nudo.js"), SIDECAR, "utf-8");
    const uri = `file://${join(dir, "lib.js")}`;
    const mock = createMockConnection();
    createNudoServer(mock as unknown as never);
    mock.requests.get("initialize")!({
      processId: null,
      rootUri: `file://${dir}`,
      workspaceFolders: [{ uri: `file://${dir}`, name: "ws" }],
      capabilities: {},
      ...(initOptions ? { initializationOptions: initOptions } : {}),
    });
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
    });
    await sleep(700);
    const hints = (await mock.requests.get("textDocument/inlayHint")!({
      textDocument: { uri },
      range: {
        start: { line: 0, character: 0 },
        end: { line: 10, character: 0 },
      },
    })) as { label?: string }[];
    return hints.map((h) => String(h.label ?? ""));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const isParamInlay = (labels: string[]): boolean =>
  labels.some((l) => l.includes("where "));

{
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const SRC = "export function getName(user) {\n  return user.name;\n}\n";
  const SIDECAR = 'import { fn, shape, string } from "@nudojs/core";\n\nexport const getName = fn({ user: shape({ name: string() }) }, string());\n';
  const hintLabels = async (pkg: unknown, initOptions?: unknown): Promise<string[]> => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b790-"));
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify(pkg), "utf-8");
      writeFileSync(join(dir, "lib.js"), SRC, "utf-8");
      writeFileSync(join(dir, "lib.nudo.js"), SIDECAR, "utf-8");
      const uri = `file://${join(dir, "lib.js")}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.requests.get("initialize")!({
        processId: null,
        rootUri: `file://${dir}`,
        workspaceFolders: [{ uri: `file://${dir}`, name: "ws" }],
        capabilities: {},
        ...(initOptions ? { initializationOptions: initOptions } : {}),
      });
      mock.notifications.get("textDocument/didOpen")!({ textDocument: { uri, languageId: "javascript", version: 1, text: SRC } });
      await sleep(700);
      const hints = (await mock.requests.get("textDocument/inlayHint")!({
        textDocument: { uri },
        range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } },
      })) as { label?: string }[];
      return hints.map((h) => String(h.label ?? ""));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const isParamInlay = (labels: string[]): boolean => labels.some((l) => l.includes("where "));
  it("项目字符串 false 关；项目布尔 true 开；宿主字符串 false 关", async () => {
    expect(isParamInlay(await hintLabels({ name: "inlay", private: true, type: "module", nudo: { inlayHints: { parameters: "false" } } }))).toBe(false);
    expect(isParamInlay(await hintLabels({ name: "inlay", private: true, type: "module", nudo: { inlayHints: { parameters: true } } }))).toBe(true);
    expect(isParamInlay(await hintLabels({ name: "inlay", private: true, type: "module" }, { inlayHints: { parameters: "false" } }))).toBe(false);
  }, 30_000);
}
});

// ---------------------------------------------------------------------------
// inlay 的 any/unknown 责任区分
// ---------------------------------------------------------------------------
describe("inlay 的 any/unknown 责任区分", () => {
/**
 * inlay 面的 any / unknown 责任区分。
 *
 * 产品契约（docs/design/cli-semantics.md §2）：`any` = 无约束（**开发者**责任）、
 * `unknown` = 推导失败（**引擎**债），两者永不得混用 ⇒ inlay 面在视觉上分开：
 * - 返回位渲染**恰为 unknown**（含 conf 标注形）⇒ label 挂 `⚠ ` 前缀 +
 * tooltip 写明「inference failure (engine debt)」与修复通道；
 * - `any`（无约束入口参 / `where any()`）⇒ **不加警示前缀**，tooltip 写
 * 「no contract on this param」的责任说明；
 * - 显示契约不回归：无约束参数不显示 `unknown`；`formatShape` 口径的 label
 * 生成路径不动（只叠加前缀 / tooltip）。
 *
 * 真 unknown 夹具：未 mock 的宿主副作用面（顶层 `fetch(u)`）⇒ B 路径
 * fail-closed，返回位 = `unknown`（同族构造方式）。
 */








const FETCH_SRC = `const res = fetch("https://example.com/api");
export function status() {
  return res.status;
}
`;

const ID_SRC = `export function id(x) {
  return x;
}
`;

/** 参数 inlay（`nudo.inlayHints.parameters`）开启的会话（同款启动） */
async function paramInlaySession(
  files: Record<string, string>,
): Promise<{
  req: (method: string) => (params: any) => any;
  uri: (name: string) => string;
  cleanup: () => void;
}> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-inlay-resp-"));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text, "utf-8");
  }
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  mock.requests.get("initialize")!({
    processId: null,
    rootUri: null,
    workspaceFolders: [],
    capabilities: {},
    initializationOptions: { inlayHints: { parameters: true } },
  });
  for (const [name, text] of Object.entries(files)) {
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: {
        uri: `file://${join(dir, name)}`,
        languageId: "javascript",
        version: 1,
        text,
      },
    });
  }
  await new Promise((r) => setTimeout(r, 300));
  return {
    req: (method: string) => mock.requests.get(method)!,
    uri: (name: string) => `file://${join(dir, name)}`,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

{
  const FETCH_SRC = 'const res = fetch("https://example.com/api");\nexport function status() {\n  return res.status;\n}\n';
  const ID_SRC = "export function id(x) {\n  return x;\n}\n";
  const paramInlaySession = async (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-inlay-resp-"));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text, "utf-8");
    const mock = createMockConnection();
    createNudoServer(mock as unknown as never);
    mock.requests.get("initialize")!({ processId: null, rootUri: null, workspaceFolders: [], capabilities: {}, initializationOptions: { inlayHints: { parameters: true } } });
    for (const [name, text] of Object.entries(files)) {
      mock.notifications.get("textDocument/didOpen")!({ textDocument: { uri: `file://${join(dir, name)}`, languageId: "javascript", version: 1, text } });
    }
    await new Promise((r) => setTimeout(r, 300));
    return { req: (method: string) => mock.requests.get(method)!, uri: (name: string) => `file://${join(dir, name)}`, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  };
  it("真 unknown 挂 ⚠ + 引擎债 tooltip；无约束参数与显式 any() 不加警示", async () => {
    await withLspServer({ "f.js": FETCH_SRC }, async ({ req, uri }) => {
      const hints = (req("textDocument/inlayHint")({ textDocument: { uri: uri("f.js") }, range: { start: { line: 0, character: 0 }, end: { line: 20, character: 0 } } }) ?? []) as Hint[];
      const ret = hints.filter((h) => h.label.includes("unknown"));
      expect(ret, `未 mock 宿主副作用 ⇒ 返回位必须是 unknown：${JSON.stringify(hints)}`).toHaveLength(1);
      expect(ret[0]!.label).toMatch(/^:\s*⚠\s*unknown/);
      expect(ret[0]!.tooltip).toContain("inference failure");
      expect(ret[0]!.tooltip).toContain("engine debt");
      expect(ret[0]!.tooltip).toContain("@nudo:mock");
    });
    const plain = await paramInlaySession({ "id.js": ID_SRC });
    try {
      const hints = (plain.req("textDocument/inlayHint")({ textDocument: { uri: plain.uri("id.js") }, range: { start: { line: 0, character: 0 }, end: { line: 20, character: 0 } } }) ?? []) as Hint[];
      expect(hints.some((h) => h.label.includes("where"))).toBe(false);
      expect(hints.some((h) => h.label.includes("unknown"))).toBe(false);
      expect(hints.some((h) => h.label.includes("⚠"))).toBe(false);
    } finally {
      plain.cleanup();
    }
    const anySession = await paramInlaySession({ "need.js": ID_SRC, "need.nudo.js": 'import { fn, any, number } from "@nudojs/core";\n\nexport const id = fn({ x: any() }, number());\n' });
    const hints = (anySession.req("textDocument/inlayHint")({ textDocument: { uri: anySession.uri("need.js") }, range: { start: { line: 0, character: 0 }, end: { line: 20, character: 0 } } }) ?? []) as Hint[];
    const param = hints.find((h) => h.label.includes("where"));
    expect(param, `any() 契约应产出参数 inlay：${JSON.stringify(hints)}`).toBeDefined();
    expect(param!.label).not.toContain("⚠");
    expect(param!.label).toContain("any()");
    expect(param!.tooltip).toContain("no contract on this param");
    expect(param!.tooltip).toContain("@nudo:contract");
    anySession.cleanup();
  });
}
});
