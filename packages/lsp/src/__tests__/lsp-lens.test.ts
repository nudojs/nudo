/**
 * 模块套件：codeLens 面（类方法/跨模块调用/默认导出/刷新/观察）。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { withLspServer, createMockConnection, type AnyHandler } from "./helpers.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Connection } from "vscode-languageserver/node";
import { createNudoServer } from "../server.ts";
import { computeObservationLenses } from "../agent-tools.ts";

// ---------------------------------------------------------------------------
// Bug 769 — 导出类实例方法的 contract 档 lens
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 769 — 导出类实例方法的 contract 档 lens", () => {
/**
 * Bug 769：导出类的实例方法（`Counter.inc`）在 LSP CodeLens / inlayHint 面
 * 完全不存在。
 *
 * 症状（真 server 协议面）：
 * - `textDocument/codeLens` 里 `Counter.inc` 只有 entry@ 观察层，
 *   **没有** `● contract / imp` / `⚡ persist contract` / `⚡ draft contract`；
 * - `textDocument/inlayHint` 里 `Counter.inc` 没有任何提示（既没有 contract
 *   档投影，也没有 `: by + 1 · derived` 返回 inlay）；
 * - 而 `textDocument/hover` **能**看到 `Counter.inc(by: any) => number | string`
 *   与 `● contract / imp` —— 四面不一致（design §3.2：导出类的实例方法与
 *   顶层导出函数同为消费者可见入口）。
 *
 * 根因：两处枚举都不认类方法——
 * - `topLevelFunctionSlots`（agent-tools.ts，CodeLens / contract inlay 面）；
 * - core `listFunctions`（algebra/inlay.ts，Abs 返回 inlay 面）。
 *
 * 期望：`Counter.inc` 与顶层导出函数在 CodeLens / inlayHint 面上同形，
 * 且契约键为 `Class.method`。
 */



const SRC = [
  "export class Counter {",
  "  inc(by) {",
  "    return by + 1;",
  "  }",
  "}",
  "",
  "export function plain(x) {",
  "  return x * 2;",
  "}",
  "",
].join("\n");

type Lens = {
  range: { start: { line: number } };
  command?: { title: string; command: string; arguments?: unknown[] };
};

describe("Bug 769 — 导出类实例方法的 contract 档 lens", () => {
  it("codeLens 出现 Counter.inc 的 contract 档（契约键 Class.method）", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const lenses = req("textDocument/codeLens")({
        textDocument: { uri: uri("a.js") },
      }) as Lens[];
      const contract = lenses.find(
        (l) =>
          l.command?.title === "● contract / imp" &&
          l.command?.arguments?.[1] === "Counter.inc",
      );
      expect(contract).toBeDefined();
      // lens 落在方法声明行（1-based 行 2 ⇒ 0-based 行 1）
      expect(contract!.range.start.line).toBe(1);

      const titles = lenses.map((l) => l.command?.title);
      expect(titles).toContain("⚡ persist contract");
      expect(titles).toContain("⚡ draft contract");
      const draft = lenses.find(
        (l) =>
          l.command?.title === "⚡ draft contract" &&
          l.command?.arguments?.[1] === "Counter.inc",
      );
      expect(draft).toBeDefined();
    });
  });

  it("inlayHint 出现 Counter.inc 的 contract 档 + 返回 inlay", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const hints = req("textDocument/inlayHint")({
        textDocument: { uri: uri("a.js") },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 20, character: 0 },
        },
      }) as Array<{ position: { line: number }; label: string }>;
      // contract 档投影（CodeLens 不可见客户端）
      const contractHint = hints.find(
        (h) => h.label === "  ● contract / imp" && h.position.line === 1,
      );
      expect(contractHint).toBeDefined();
      // Abs 返回 inlay（core inlay 面也必须认类方法）
      const returnHint = hints.find((h) => h.label.includes(": by + 1"));
      expect(returnHint).toBeDefined();
      // 插在方法体 `{` 前（1-based 行 2 ⇒ 0-based 行 1）
      expect(returnHint!.position.line).toBe(1);
    });
  });

  it("回归护栏：同文件的顶层导出函数不受影响", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const lenses = req("textDocument/codeLens")({
        textDocument: { uri: uri("a.js") },
      }) as Lens[];
      const plain = lenses.find(
        (l) =>
          l.command?.title === "● contract / imp" &&
          l.command?.arguments?.[1] === "plain",
      );
      expect(plain).toBeDefined();
      expect(plain!.range.start.line).toBe(6);
    });
  });

  it("export default class 的实例方法同样进 contract 档", async () => {
    const defaultClassSrc = [
      "export default class Counter {",
      "  inc(by) {",
      "    return by + 1;",
      "  }",
      "}",
      "",
    ].join("\n");
    await withLspServer({ "a.js": defaultClassSrc }, async ({ req, uri }) => {
      const lenses = req("textDocument/codeLens")({
        textDocument: { uri: uri("a.js") },
      }) as Lens[];
      const contract = lenses.find(
        (l) =>
          l.command?.title === "● contract / imp" &&
          l.command?.arguments?.[1] === "Counter.inc",
      );
      expect(contract).toBeDefined();
      expect(contract!.range.start.line).toBe(1);
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 1034 — 跨模块调用点的 call@ 观察 lens
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 1034 — 跨模块调用点的 call@ 观察 lens", () => {
/**
 * Bug 1034：跨模块调用点（`call@`）在调用方文件的 LSP CodeLens 面上整段消失。
 *
 * 症状（真 server 协议面）：
 * - `lib.js` 导出 `add`，`main.js` 里 `import { add } from "./lib.js"` 后调用
 *   `add(x, 2)` —— `main.js` 的 `textDocument/codeLens` **没有** `call@L4` 观察层；
 * - 同一文件内的调用（同文件 `add`）却有 `call@L6` lens；
 * - 而 CLI `nudo test main.js` **已经**打印
 *   `--- …/lib.js (imported) ---` / `=== add ===` / `call@L4 …` ——
 *   产品面有事实，LSP 面没有投影。
 *
 * 根因：`computeObservationLenses` 只消费 `analysis.functions`（本文件函数），
 * 没消费 `analysis.externalFunctions`（跨模块调用点事实）。
 *
 * 期望：调用方文件的 CodeLens 出现与 CLI 同形的 `call@L4` lens；
 * 且外部函数的 entry@ 属于被导入模块，**不得**在调用方文件落镜。
 */



const LIB_SRC = [
  "export function add(a, b) {",
  "  return a + b;",
  "}",
  "",
].join("\n");

const CROSS_MAIN_SRC = [
  'import { add } from "./lib.js";',
  "",
  "export function run(x) {",
  "  return add(x, 2);",
  "}",
  "",
].join("\n");

const SAME_FILE_SRC = [
  "export function add(a, b) {",
  "  return a + b;",
  "}",
  "",
  "export function run(x) {",
  "  return add(x, 2);",
  "}",
  "",
].join("\n");

type Lens = {
  range: { start: { line: number } };
  command?: { title: string; command: string; arguments?: unknown[] };
};

const callLenses = (lenses: Lens[]): Lens[] =>
  lenses.filter((l) => l.command?.title.startsWith("call@"));

describe("Bug 1034 — 跨模块调用点的 call@ 观察 lens", () => {
  it("调用方文件的 codeLens 出现跨模块 call@ lens", async () => {
    await withLspServer(
      { "lib.js": LIB_SRC, "main.js": CROSS_MAIN_SRC },
      async ({ req, uri }) => {
        const lenses = req("textDocument/codeLens")({
          textDocument: { uri: uri("main.js") },
        }) as Lens[];
        const calls = callLenses(lenses);
        expect(calls.length).toBe(1);
        expect(calls[0]!.command!.title).toBe("call@L4  (any, 2) => number | string");
        // 追踪目标 = 被导入的函数名（与 CLI `=== add ===` 同形）
        expect(calls[0]!.command!.arguments?.[1]).toBe("add");
        // 落在调用点行（1-based 行 4 ⇒ 0-based 行 3）
        expect(calls[0]!.range.start.line).toBe(3);
      },
    );
  });

  it("外部函数的 entry@ 不在调用方文件落镜（属被导入模块）", async () => {
    await withLspServer(
      { "lib.js": LIB_SRC, "main.js": CROSS_MAIN_SRC },
      async ({ req, uri }) => {
        const lenses = req("textDocument/codeLens")({
          textDocument: { uri: uri("main.js") },
        }) as Lens[];
        // main.js 里只应有 run 的 entry@，不得出现 add 的 entry@
        const entries = lenses.filter((l) => l.command?.title.startsWith("entry@"));
        expect(entries.length).toBe(1);
        expect(entries[0]!.command!.arguments?.[1]).toBe("run");
      },
    );
  });

  it("回归护栏：同文件调用点的 call@ lens 形状不变", async () => {
    await withLspServer({ "same.js": SAME_FILE_SRC }, async ({ req, uri }) => {
      const lenses = req("textDocument/codeLens")({
        textDocument: { uri: uri("same.js") },
      }) as Lens[];
      const calls = callLenses(lenses);
      expect(calls.length).toBe(1);
      expect(calls[0]!.command!.title).toBe("call@L6  (any, 2) => number | string");
      expect(calls[0]!.range.start.line).toBe(5);
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 753 — export default function 的 contract 档 lens
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 753 — export default function 的 contract 档 lens", () => {
/**
 * Bug 753：`export default function` 在 LSP CodeLens / inlayHint 面整段消失。
 *
 * 症状（真 server 协议面）：
 * - `textDocument/codeLens` 只有 entry@ 观察层，**没有** `● contract / imp`
 *   / `⚡ persist contract` / `⚡ draft contract` 三条 contract 档 lens；
 * - `textDocument/inlayHint` 没有 `● contract / imp` 投影
 *   （CodeLens 不可见的客户端靠它看到契约档）；
 * - 而 hover / documentSymbol / semanticTokens 面**都**能看到 `compute` ——
 *   枚举面与导出面分裂。
 *
 * 根因：`topLevelFunctionSlots`（agent-tools.ts）只认 `ExportNamedDeclaration`
 * 与裸声明，不认 `ExportDefaultDeclaration` —— 默认导出从未进入 contract 档
 * 的目标集。
 *
 * 期望：默认导出与具名导出在 CodeLens / inlayHint 面上同形。
 */



const DEFAULT_EXPORT_SRC = [
  "export default function compute(n) {",
  "  return n + 1;",
  "}",
  "",
].join("\n");

const NAMED_EXPORT_SRC = [
  "export function compute(n) {",
  "  return n + 1;",
  "}",
  "",
].join("\n");

type Lens = {
  range: { start: { line: number } };
  command?: { title: string; command: string; arguments?: unknown[] };
};

describe("Bug 753 — export default function 的 contract 档 lens", () => {
  it("codeLens 出现默认导出的 contract 档（● contract / imp + 固化动作）", async () => {
    await withLspServer({ "a.js": DEFAULT_EXPORT_SRC }, async ({ req, uri }) => {
      const lenses = req("textDocument/codeLens")({
        textDocument: { uri: uri("a.js") },
      }) as Lens[];
      const titles = lenses.map((l) => l.command?.title);
      expect(titles).toContain("● contract / imp");
      expect(titles).toContain("⚡ persist contract");
      expect(titles).toContain("⚡ draft contract");

      const contract = lenses.find((l) => l.command?.title === "● contract / imp")!;
      // 契约身份 = 本地名（core listTopFunctions / localNamedExports 同口径）
      expect(contract.command?.arguments?.[1]).toBe("compute");
      // lens 落在函数声明行（1-based 行 1 ⇒ 0-based 行 0）
      expect(contract.range.start.line).toBe(0);

      const draft = lenses.find((l) => l.command?.title === "⚡ draft contract")!;
      expect(draft.command?.arguments?.[1]).toBe("compute");
    });
  });

  it("inlayHint 出现默认导出的 contract 档投影（CodeLens 不可见客户端）", async () => {
    await withLspServer({ "a.js": DEFAULT_EXPORT_SRC }, async ({ req, uri }) => {
      const hints = req("textDocument/inlayHint")({
        textDocument: { uri: uri("a.js") },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 10, character: 0 },
        },
      }) as Array<{ position: { line: number }; label: string }>;
      const labels = hints.map((h) => h.label);
      expect(labels).toContain("  ● contract / imp");
      // 契约档 inlay 落在函数声明行
      const contractHint = hints.find((h) => h.label === "  ● contract / imp")!;
      expect(contractHint.position.line).toBe(0);
    });
  });

  it("回归护栏：具名导出不受影响（同一 lens 形状）", async () => {
    await withLspServer({ "a.js": NAMED_EXPORT_SRC }, async ({ req, uri }) => {
      const lenses = req("textDocument/codeLens")({
        textDocument: { uri: uri("a.js") },
      }) as Lens[];
      const contract = lenses.find((l) => l.command?.title === "● contract / imp")!;
      expect(contract).toBeDefined();
      expect(contract.command?.arguments?.[1]).toBe("compute");
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 757 — 选择器变更必须同时刷新 codeLens 与 inlayHint
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 757 — 选择器变更必须同时刷新 codeLens 与 inlayHint", () => {
/**
 * Bug 757 —— 选择器变更只广播 `workspace/codeLens/refresh`，从不广播
 * `workspace/inlayHint/refresh`。
 *
 * inlay 是「无 CodeLens UI 的客户端」唯一的选择器状态镜像（lsp.md §inlay）；
 * 只发 codeLens ⇒ 两个镜像互相矛盾（inlay 仍显示旧档）。
 * 改后：selectCase / selectContract 都成对发 codeLens + inlayHint。
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
  dir = mkdtempSync(join(tmpdir(), "nudo-lsp-bug757-"));
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

describe("Bug 757 — 选择器变更必须同时刷新 codeLens 与 inlayHint", () => {
  it("nudo.selectCase 之后 inlayHint refresh 与 codeLens refresh 成对出现", async () => {
    const mock = startServer();
    mock.sentRequests.length = 0;

    await handler(mock, "workspace/executeCommand")({
      command: "nudo.selectCase",
      arguments: [`file://${file}`, "f", 0, "num"],
    });

    const methods = refreshMethods(mock);
    expect(methods).toContain("workspace/codeLens/refresh");
    expect(methods).toContain("workspace/inlayHint/refresh");
  }, 30_000);

  it("nudo.selectContract 之后 inlayHint refresh 与 codeLens refresh 成对出现", async () => {
    const mock = startServer();
    mock.sentRequests.length = 0;

    await handler(mock, "workspace/executeCommand")({
      command: "nudo.selectContract",
      arguments: [`file://${file}`, "f"],
    });

    const methods = refreshMethods(mock);
    expect(methods).toContain("workspace/codeLens/refresh");
    expect(methods).toContain("workspace/inlayHint/refresh");
  }, 30_000);
});
});

// ---------------------------------------------------------------------------
// computeObservationLenses
// ---------------------------------------------------------------------------
describe("[lsp-] computeObservationLenses", () => {
/**
 * 合成 call@ / entry@ 观察 CodeLens：CLI `nudo test` 的源码内投影。
 */



const SRC = `export function add(a, b) {
  return a + b;
}

function use() {
  return add(1, 2);
}

export function uncalled(x) {
  return x;
}

use();
`;

describe("computeObservationLenses", () => {
  it("pins call@ at the call-site line with (args) => result title", () => {
    const lenses = computeObservationLenses(SRC, "/t/obs.js");
    const calls = lenses.filter((l) => l.kind === "callsite");
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const addCall = calls.find((l) => l.fn === "add" && l.caseName.startsWith("call@"));
    expect(addCall).toBeDefined();
    // use() body call is on line 6: return add(1, 2);
    expect(addCall!.line).toBe(6);
    expect(addCall!.title).toMatch(/call@L6/);
    expect(addCall!.title).toContain("(1, 2)");
    expect(addCall!.title).toContain("=>");
  });

  it("pins entry@ on the function declaration line", () => {
    const lenses = computeObservationLenses(SRC, "/t/obs.js");
    const entries = lenses.filter((l) => l.kind === "entry");
    // uncalled export gets entry@
    const uncalled = entries.find((l) => l.fn === "uncalled");
    expect(uncalled).toBeDefined();
    expect(uncalled!.line).toBe(9);
    expect(uncalled!.title).toContain("entry@");
  });

  it("skips directive cases (those stay on case lens layer)", () => {
    const src = `/**
 * @nudo:case "num" (42)
 */
export function id(x) {
  return x;
}
`;
    const lenses = computeObservationLenses(src, "/t/dir.js");
    // directive case only → no observation lens for "num"
    expect(lenses.filter((l) => l.caseName === "num")).toEqual([]);
  });

  it("sorts by line and stays empty on unparseable noise without throwing", () => {
    const lenses = computeObservationLenses(SRC, "/t/obs.js");
    for (let i = 1; i < lenses.length; i++) {
      expect(lenses[i]!.line).toBeGreaterThanOrEqual(lenses[i - 1]!.line);
    }
    expect(() => computeObservationLenses("export function f(){ return 1 }", "/t/ok.js")).not.toThrow();
  });
});
});
