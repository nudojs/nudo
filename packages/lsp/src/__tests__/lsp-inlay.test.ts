/**
 * 模块套件：inlayHint 面（range / CRLF / 参数归一 / unknown 责任）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNudoServer } from "../server.ts";
import { createMockConnection, withLspServer } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Bug 722 inlayHint：CRLF 源文件的 hint 位置不得越出行可见长度
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 722 inlayHint：CRLF 源文件的 hint 位置不得越出行可见长度", () => {
/**
 * Bug 722 —— LSP `inlayHint` 在 **CRLF 源文件**上把 `position.character`
 * 推到**行可见长度之外 1 列**（越界位置）。
 *
 * 改前：服务端 `source.split("\n")` 切行 ⇒ 每行末尾的 `\r` 被算进行长
 * ⇒ end-of-line hint 的 character 比客户端算出的可见行长多 1。
 *
 * 原生 oracle：LSP `Position.character` 是行内 UTF-16 偏移，**行终止符
 * 不属于该行** ⇒ character 必须落在该行的可见长度内。
 */







const BODY = `export function alpha(x) {\n  return x + 1;\n}\n`;

type Hint = { position: { line: number; character: number }; label: string };

async function hintsFor(file: string, text: string): Promise<Hint[]> {
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  const uri = `file://${file}`;
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri, languageId: "javascript", version: 1, text },
  });
  await new Promise((r) => setTimeout(r, 250));
  const inlay = mock.requests.get("textDocument/inlayHint")!;
  return (inlay({ textDocument: { uri } }) ?? []) as Hint[];
}

describe("Bug 722 inlayHint：CRLF 源文件的 hint 位置不得越出行可见长度", () => {
  it("CRLF 与 LF 给出同一组位置（改前：CRLF 的行尾 hint 越界 1 列）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug722-"));
    try {
      const crlfFile = join(dir, "crlf.js");
      const lfFile = join(dir, "lf.js");
      const crlf = BODY.replace(/\n/g, "\r\n");
      writeFileSync(crlfFile, crlf);
      writeFileSync(lfFile, BODY);

      const crlfHints = await hintsFor(crlfFile, crlf);
      const lfHints = await hintsFor(lfFile, BODY);

      // 客户端模型：行终止符不属于该行 ⇒ 可见行长
      const visible = crlf.split(/\r\n|\r|\n/).map((l) => l.length);
      for (const h of crlfHints) {
        const vlen = visible[h.position.line] ?? 0;
        expect(h.position.character).toBeLessThanOrEqual(vlen);
      }
      // 同一份代码、只换行尾 ⇒ 位置逐条相同（服务端与客户端同口径）
      expect(JSON.stringify(crlfHints)).toBe(JSON.stringify(lfHints));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("CRLF 下 end-of-line 的 contract 档 hint 落在可见行长上（不是 +1）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug722b-"));
    const file = join(dir, "crlf.js");
    const crlf = BODY.replace(/\n/g, "\r\n");
    writeFileSync(file, crlf);
    try {
      const hints = await hintsFor(file, crlf);
      const visible = crlf.split(/\r\n|\r|\n/).map((l) => l.length);
      const eol = hints.find((h) => h.label.includes("contract"));
      expect(eol).toBeDefined();
      // 行尾 hint 的 character == 该行可见行长（不是可见行长 + 1）
      expect(eol!.position.character).toBe(visible[eol!.position.line]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// Bug 716 inlayHint：params.range 必须被尊重
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 716 inlayHint：params.range 必须被尊重", () => {
/**
 * Bug 716 —— LSP `textDocument/inlayHint` **完全忽略** `params.range`。
 *
 * 改前：handler 收了 `params` 却不读 `params.range` ⇒ 两个**不相交**的
 * 区间返回**逐字节相同**的整文件 hint 集（IDE 的「只看这一段」被无视）。
 *
 * 原生 oracle：LSP 协议里 `textDocument/inlayHint` 的 `range` 是**必填**且
 * 表示「只请求该区间」⇒ 返回的 hint 必须落在请求区间内。
 */







const SRC = `export function alpha(x) { return x; }\n\nexport function beta(y) { return y; }\n`;

type Hint = { position: { line: number; character: number }; label: string };

async function hintsFor(
  file: string,
  text: string,
  range?: { start: { line: number; character: number }; end: { line: number; character: number } },
): Promise<Hint[]> {
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  const uri = `file://${file}`;
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri, languageId: "javascript", version: 1, text },
  });
  await new Promise((r) => setTimeout(r, 250));
  const inlay = mock.requests.get("textDocument/inlayHint")!;
  return (inlay({ textDocument: { uri }, ...(range ? { range } : {}) }) ?? []) as Hint[];
}

describe("Bug 716 inlayHint：params.range 必须被尊重", () => {
  it("区间请求只返回区间内的 hint（改前：整文件集逐字节相同）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug716-"));
    const file = join(dir, "range.js");
    writeFileSync(file, SRC);
    try {
      const whole = await hintsFor(file, SRC);
      expect(whole.length).toBeGreaterThan(1);

      const line0 = await hintsFor(file, SRC, {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 40 },
      });
      const line2 = await hintsFor(file, SRC, {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 40 },
      });

      // 每个 hint 都必须落在请求区间内
      expect(line0.every((h) => h.position.line === 0)).toBe(true);
      expect(line2.every((h) => h.position.line === 2)).toBe(true);
      // 两个不相交区间 ⇒ 不同的 hint 集（改前二者与整文件集逐字节相同）
      expect(JSON.stringify(line0)).not.toBe(JSON.stringify(line2));
      expect(JSON.stringify(line0)).not.toBe(JSON.stringify(whole));
      expect(JSON.stringify(line2)).not.toBe(JSON.stringify(whole));
      // 区间内的 hint 仍在（不是「清空」）
      expect(line0.length).toBeGreaterThan(0);
      expect(line2.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("窄区间（不含任何 hint 位）返回空集，且不与整文件集相同", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug716b-"));
    const file = join(dir, "range.js");
    writeFileSync(file, SRC);
    try {
      const whole = await hintsFor(file, SRC);
      const narrow = await hintsFor(file, SRC, {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
      });
      expect(narrow).toEqual([]);
      expect(JSON.stringify(narrow)).not.toBe(JSON.stringify(whole));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("区间缺省（不合规客户端）⇒ 整文件集（fail-open，不丢内容）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug716c-"));
    const file = join(dir, "range.js");
    writeFileSync(file, SRC);
    try {
      const whole = await hintsFor(file, SRC);
      const noRange = await hintsFor(file, SRC, undefined);
      expect(noRange.length).toBe(whole.length);
      expect(JSON.stringify(noRange)).toBe(JSON.stringify(whole));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// Bug 790 — 项目侧 inlayHints.parameters 与宿主侧同口径
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 790 — 项目侧 inlayHints.parameters 与宿主侧同口径", () => {
/**
 * Bug 790 —— 项目侧的 `nudo.inlayHints.parameters` 与宿主侧**两套规则**。
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

describe("Bug 790 — 项目侧 inlayHints.parameters 与宿主侧同口径", () => {
  it("项目侧字符串 \"false\" ⇒ 参数 inlay 关（非法值回落默认）", async () => {
    const labels = await hintLabels({
      name: "inlay",
      private: true,
      type: "module",
      nudo: { inlayHints: { parameters: "false" } },
    });
    expect(isParamInlay(labels)).toBe(false);
  }, 30_000);

  it("项目侧布尔 true ⇒ 参数 inlay 开", async () => {
    const labels = await hintLabels({
      name: "inlay",
      private: true,
      type: "module",
      nudo: { inlayHints: { parameters: true } },
    });
    expect(isParamInlay(labels)).toBe(true);
  }, 30_000);

  it("宿主侧字符串 \"false\" ⇒ 参数 inlay 关（既有行为不回归）", async () => {
    const labels = await hintLabels(
      { name: "inlay", private: true, type: "module" },
      { inlayHints: { parameters: "false" } },
    );
    expect(isParamInlay(labels)).toBe(false);
  }, 30_000);
});
});

// ---------------------------------------------------------------------------
// inlay 的 any/unknown 责任区分
// ---------------------------------------------------------------------------
describe("[lsp-] inlay 的 any/unknown 责任区分", () => {
/**
 * inlay 面的 any / unknown 责任区分。
 *
 * 产品契约（docs/design/cli-semantics.md §2）：`any` = 无约束（**开发者**责任）、
 * `unknown` = 推导失败（**引擎**债），两者永不得混用 ⇒ inlay 面在视觉上分开：
 * - 返回位渲染**恰为 unknown**（含 conf 标注形）⇒ label 挂 `⚠ ` 前缀 +
 *   tooltip 写明「inference failure (engine debt)」与修复通道；
 * - `any`（无约束入口参 / `where any()`）⇒ **不加警示前缀**，tooltip 写
 *   「no contract on this param」的责任说明；
 * - 显示契约不回归：无约束参数不显示 `unknown`；`formatShape` 口径的 label
 *   生成路径不动（只叠加前缀 / tooltip）。
 *
 * 真 unknown 夹具：未 mock 的宿主副作用面（顶层 `fetch(u)`）⇒ B 路径
 * fail-closed，返回位 = `unknown`（Bug 786 同族构造方式）。
 */








type Hint = {
  position: { line: number; character: number };
  label: string;
  tooltip?: string;
};

const FETCH_SRC = `const res = fetch("https://example.com/api");
export function status() {
  return res.status;
}
`;

const ID_SRC = `export function id(x) {
  return x;
}
`;

/** 参数 inlay（`nudo.inlayHints.parameters`）开启的会话（Bug 790 同款启动） */
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

describe("inlay 的 any/unknown 责任区分", () => {
  it("真 unknown 返回位：label 含 ⚠，tooltip 写明 inference failure（引擎债）", async () => {
    await withLspServer({ "f.js": FETCH_SRC }, async ({ req, uri }) => {
      const hints = (req("textDocument/inlayHint")({
        textDocument: { uri: uri("f.js") },
        range: { start: { line: 0, character: 0 }, end: { line: 20, character: 0 } },
      }) ?? []) as Hint[];
      const ret = hints.filter((h) => h.label.includes("unknown"));
      expect(ret, `未 mock 宿主副作用 ⇒ 返回位必须是 unknown：${JSON.stringify(hints)}`).toHaveLength(1);
      // ⚠ 前缀（`: ⚠ unknown  · derived  `——`formatShape` 文本本身不动）
      expect(ret[0]!.label).toMatch(/^:\s*⚠\s*unknown/);
      // tooltip：责任区分 + 修复通道（引擎债不是注解）
      expect(ret[0]!.tooltip).toContain("inference failure");
      expect(ret[0]!.tooltip).toContain("engine debt");
      expect(ret[0]!.tooltip).toContain("@nudo:mock");
    });
  });

  it("无约束参数（parameters 开）：不显示 unknown、不挂 ⚠（any = 开发者责任）", async () => {
    const { req, uri, cleanup } = await paramInlaySession({ "id.js": ID_SRC });
    try {
    const hints = (req("textDocument/inlayHint")({
      textDocument: { uri: uri("id.js") },
      range: { start: { line: 0, character: 0 }, end: { line: 20, character: 0 } },
    }) ?? []) as Hint[];
    // 无约束参数不产生 where-inlay（没有约束可展示）⇒ 面上零参数 hint
    expect(hints.some((h) => h.label.includes("where"))).toBe(false);
    // 返回位是计算形（x），不是 unknown——无约束 ≠ 推导失败
    expect(hints.some((h) => h.label.includes("unknown"))).toBe(false);
      // 全文件无 ⚠（any 语义不加警示前缀）
      expect(hints.some((h) => h.label.includes("⚠"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("显式无约束 `where any()`：不加 ⚠，tooltip 追加 any 责任说明（不丢既有 pred 展开）", async () => {
    const { req, uri, cleanup } = await paramInlaySession({
      "need.js": ID_SRC,
      "need.nudo.js": `import { fn, any, number } from "@nudojs/core";

export const id = fn({ x: any() }, number());
`,
    });
    const hints = (req("textDocument/inlayHint")({
      textDocument: { uri: uri("need.js") },
      range: { start: { line: 0, character: 0 }, end: { line: 20, character: 0 } },
    }) ?? []) as Hint[];
    const param = hints.find((h) => h.label.includes("where"));
    expect(param, `any() 契约应产出参数 inlay：${JSON.stringify(hints)}`).toBeDefined();
    // any（无约束）不挂警示前缀
    expect(param!.label).not.toContain("⚠");
    expect(param!.label).toContain("any()");
    // tooltip：既有 pred 展开在前（不丢失），any 责任说明追加在后
    expect(param!.tooltip).toContain("no contract on this param");
    expect(param!.tooltip).toContain("@nudo:contract");
    cleanup();
  });
});
});
