/**
 * 模块套件：signatureHelp 面（参数名/活动参数/默认导出/本地被调/方法/嵌套调用/多态）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCompletionsAtPosition } from "../lsp-surface/completions.ts";
import { createNudoServer } from "../server.ts";
import { createMockConnection, withLspServer } from "./helpers.ts";
import { absFunction, num, relationFn, shapeOnlyFn, str, formatShape, type Abs } from "@nudojs/core";
import { buildSignatureHelp } from "../signature-help.ts";
import { parse } from "@nudojs/parser";
import { findEnclosingCall } from "../server-ide.ts";

// ---------------------------------------------------------------------------
// IDE 面：跨模块 fn 形参名（真名，非 argN 假名）
// ---------------------------------------------------------------------------
describe("IDE 面：跨模块 fn 形参名（真名，非 argN 假名）", () => {
/**
 * ：IDE 面（补全 detail + 签名弹窗）的跨模块 fn 形参名——
 * 改前 `export function` 的形参显示成合成假名 `arg0/arg1`（源码里没有的名字），
 * 带默认值的形参整个丢失（`b = 2` → arg1），rest 形参连个数一起被吞。
 *
 * 原生 oracle：声明形参是源码里的名字与个数（`export function f(a, b = 2)` → a / b）。
 */








const SRC = `export function withDefault(x, y = 2) { return x + y; }
export function withRest(x, ...rest) { return x; }
export function plain(x, y) { return x + y; }
`;

function tmpFile(src: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b463-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src);
  return { dir, file };
}

describe("IDE 面：跨模块 fn 形参名（真名，非 argN 假名）", () => {
  it("补全 detail 用源码真名与真个数（改前：(arg0) => ? / (arg0, arg1) => ?）", () => {
    const { dir, file } = tmpFile(SRC);
    try {
      const items = getCompletionsAtPosition(file, SRC, SRC.split("\n").length - 1, 0);
      const detailOf = (label: string): string | undefined =>
        items.find((i) => i.label === label)?.detail;
      // detail 不再用 `?` 占位返回值，改为与 hover / check 同口径的
      // 签名渲染（`<name>(<param>: <T>, …) => <R>`）；本用例仍钉「源码真名与
      // 真个数」（不是 arg0/arg1 假名）。
      expect(detailOf("withDefault")).toBe("withDefault(x: any, y: any) => any");
      expect(detailOf("withRest")).toBe("withRest(x: any, ...rest: any) => any");
      expect(detailOf("plain")).toBe("plain(x: any, y: any) => any");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("签名弹窗 label 用源码真名（改前：(arg0: any) => unknown）", async () => {
    const { dir, file } = tmpFile(`${SRC}export function use() { return withDefault(1, 2); }\n`);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      const text = `${SRC}export function use() { return withDefault(1, 2); }\n`;
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text },
      });
      await new Promise((r) => setTimeout(r, 200));
      const sig = mock.requests.get("textDocument/signatureHelp")!;
      const col = "export function use() { return withDefault(".length;
      const res = sig({ textDocument: { uri }, position: { line: 3, character: col } });
      const label = res!.signatures[0]!.label;
      // 裸标识符 callee 不再用 evaluator 的 arity-only fn Abs 冒充
      // 签名（返回位是占位 `unknown`）⇒ 落到与 hover 同源的 poly-fn 解析，
      // 返回位是真实推断（`x + y` ⇒ `number | string`）。
      expect(label).toBe("(x: any, y: any) => number | string");
      expect(label).not.toContain("arg0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：本地箭头函数的形参面不变", () => {
    const src = `export const arrow = (m, n) => m + n;\n`;
    const { dir, file } = tmpFile(src);
    try {
      const items = getCompletionsAtPosition(file, src, 1, 0);
      const arrow = items.find((i) => i.label === "arrow");
      // detail 改为完整签名（不再 `?` 占位）；负控制仍钉「形参面
      // 用源码真名 m/n 且个数为 2」（不是 arg0/arg1 假名）。
      expect(arrow?.detail).toBe("arrow(m: any, n: any) => any");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// signatureHelp：activeParameter 不越界
// ---------------------------------------------------------------------------
describe("signatureHelp：activeParameter 不越界", () => {
/**
 * LSP `signatureHelp` 的 `activeParameter` **越界**——
 * 2 参签名在第 2 个实参之后报 index 2（协议规定下标须落在签名参数表内；
 * 越界值客户端只能回落 0 ⇒ 高亮错误的参数）。
 *
 * 原生 oracle：`activeParameter` 必须落在 `parameters` 长度内
 * （`activeParameter < parameters.length`，或该字段被省略）。
 */









const SRC = [
  "export function two(a, b) {",
  "  return a + b;",
  "}",
  "",
  "export function caller() {",
  "  two(1, 2);",
  "  return 0;",
  "}",
].join("\n");

/** ` two(1, 2);` 的列：`1` / `,` / `2` / `)` / `;` */
const LINE = SRC.split("\n")[5]!;
const COL_ARG1 = LINE.indexOf("1");
const COL_COMMA = LINE.indexOf(",");
const COL_ARG2 = LINE.indexOf("2");
const COL_CLOSE = LINE.indexOf(")");
const COL_SEMI = LINE.indexOf(";");

function tmpFile(src: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b718-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src);
  return { dir, file };
}

describe("signatureHelp：activeParameter 不越界", () => {
  it("纯函数面：buildSignatureHelp 把 activeParameter 夹进签名参数表内", () => {
    const fn = absFunction(["x", "y"], { apply: () => num() });
    // 越界输入（光标在末参之后 / 实参多于形参）⇒ 夹到最后一个形参
    const help = buildSignatureHelp(fn, 2)!;
    expect(help.signatures[0]!.parameters).toHaveLength(2);
    expect(help.activeParameter).toBe(1);
    expect(help.signatures[0]!.activeParameter).toBe(1);
    expect(help.activeParameter!).toBeLessThan(help.signatures[0]!.parameters!.length);
  });

  it("纯函数面：0 参签名 ⇒ 省略 activeParameter（不是填 0）", () => {
    const fn = absFunction([], { apply: () => num() });
    const help = buildSignatureHelp(fn, 0)!;
    expect(help.signatures[0]!.parameters).toHaveLength(0);
    expect(help.activeParameter).toBeUndefined();
    expect(help.signatures[0]!.activeParameter).toBeUndefined();
  });

  it("协议面（真 server）：末参之后 / 分号处的 activeParameter 都落在参数表内", async () => {
    const { dir, file } = tmpFile(SRC);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;

      const seen: Array<{ col: number; active: number | undefined; n: number }> = [];
      for (const col of [COL_ARG1, COL_COMMA, COL_ARG2, COL_CLOSE, COL_SEMI]) {
        const res = sig({ textDocument: { uri }, position: { line: 5, character: col } });
        expect(res).not.toBeNull();
        const n = res!.signatures[0]!.parameters.length;
        expect(n).toBe(2);
        const active = res!.activeParameter;
        // 协议取值域：下标落在签名参数表内
        if (active !== undefined) expect(active).toBeLessThan(n);
        seen.push({ col, active, n });
      }
      // 末参之后（`)` / `;`）不得再报 2（改前报 2 ⇒ 越界）
      expect(seen.find((s) => s.col === COL_CLOSE)!.active).toBe(1);
      expect(seen.find((s) => s.col === COL_SEMI)!.active).toBe(1);
      // 首参内 ⇒ 0
      expect(seen.find((s) => s.col === COL_ARG1)!.active).toBe(0);
      // 逗号上 ⇒ 第 2 个参数
      expect(seen.find((s) => s.col === COL_COMMA)!.active).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("协议面（真 server）：实参多于形参时也不得越界", async () => {
    const src = [
      "export function one(a) { return a; }",
      "export function caller() {",
      "  one(1, 2, 3);",
      "  return 0;",
      "}",
    ].join("\n");
    const { dir, file } = tmpFile(src);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: src },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;
      const line = src.split("\n")[2]!;
      for (const col of [line.indexOf("1"), line.indexOf("2"), line.indexOf("3")]) {
        const res = sig({ textDocument: { uri }, position: { line: 2, character: col } });
        expect(res).not.toBeNull();
        const n = res!.signatures[0]!.parameters.length;
        expect(n).toBe(1);
        const active = res!.activeParameter;
        if (active !== undefined) expect(active).toBeLessThan(n);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// signatureHelp：export default 的 callee 也有签名弹窗
// ---------------------------------------------------------------------------
describe("signatureHelp：export default 的 callee 也有签名弹窗", () => {
/**
 * `export default function defFn(…)` 的**默认导出** callee
 * ⇒ LSP `signatureHelp` **整面无响应**（null）。
 *
 * 根因（HEAD 实测）：`AnalysisResult.bindings` **只收具名导出** ⇒
 * 默认导出**连 "default" 键都没有**（既无 "default" 也无本地名 "defFn"）
 * ⇒ 绑定面必然 miss。签名面必须落到 **AST 定位回落**（与 hover 面同源的
 * `generalizeFromAst`）。
 */







const SRC = [
  "export default function defFn(a, b) {",
  "  return a + b;",
  "}",
  "",
  "export function caller() {",
  "  return defFn(1, 2);",
  "}",
].join("\n");

/** ` return defFn(1, 2);` 的列 */
const LINE = SRC.split("\n")[5]!;
const COL_CALLEE = LINE.indexOf("defFn");
const COL_ARG1 = LINE.indexOf("1");
const COL_ARG2 = LINE.indexOf("2");

function tmpFile(src: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b985-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src);
  return { dir, file };
}

describe("signatureHelp：export default 的 callee 也有签名弹窗", () => {
  it("协议面（真 server）：defFn(1, 2) 给出 2 参签名（改前 null）", async () => {
    const { dir, file } = tmpFile(SRC);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;

      const res = sig({ textDocument: { uri }, position: { line: 5, character: COL_ARG1 } });
      // 改前：null（整面无响应）
      expect(res).not.toBeNull();
      expect(res!.signatures[0]!.parameters).toHaveLength(2);
      expect(res!.signatures[0]!.parameters[0]!.label).toBe("a: any");
      expect(res!.signatures[0]!.parameters[1]!.label).toBe("b: any");
      expect(res!.activeParameter).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("协议面（真 server）：光标落在被调者名 / 第 2 个实参处都给同一签名", async () => {
    const { dir, file } = tmpFile(SRC);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;

      const atCallee = sig({ textDocument: { uri }, position: { line: 5, character: COL_CALLEE } });
      expect(atCallee).not.toBeNull();
      expect(atCallee!.signatures[0]!.parameters).toHaveLength(2);

      const atArg2 = sig({ textDocument: { uri }, position: { line: 5, character: COL_ARG2 } });
      expect(atArg2).not.toBeNull();
      expect(atArg2!.signatures[0]!.parameters).toHaveLength(2);
      expect(atArg2!.activeParameter).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：具名导出的 callee 仍走绑定面（参数名 / 数量一致）", async () => {
    const src = [
      "export function namedFn(a, b) {",
      "  return a + b;",
      "}",
      "",
      "export function caller() {",
      "  return namedFn(1, 2);",
      "}",
    ].join("\n");
    const { dir, file } = tmpFile(src);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: src },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;
      const col = src.split("\n")[5]!.indexOf("1");
      const res = sig({ textDocument: { uri }, position: { line: 5, character: col } });
      expect(res).not.toBeNull();
      expect(res!.signatures[0]!.parameters).toHaveLength(2);
      // 返回类型部分随 **** 的修复变精确。
      //
      // 旧期望 `"(a: any, b: any) => unknown"` 钉的正是 判红的
      // **症状**：`tmp/bug-report/sections/.md` §期望 vs 实际 明写
      // signatureHelp 的 label 期望是**精确签名**、实际是
      // 「`(user: any) => unknown`」（声明空壳：形参一律 any、返回一律
      // unknown）⇒ 与同一 LSP 面的 hover 及 CLI `nudo check` 互斥。
      // 战役按该条修了 signatureHelp（arity-only 空壳不采纳 ⇒ 回落内涵面）
      // ⇒ 模块级 callee 现在给的是**精确**签名：`a + b`（两侧 any）⇒
      // JS `+` 的 ToPrimitive 结果并集 `number | string`（引擎 check 面
      // 同源：`number | string throws TypeError`）。
      // ⇒ 负控改钉精确签名；负控本意（模块级 callee 有签名 / 参数名与数量
      // 一致）由上面的 parameters 断言继续兜住。
      expect(res!.signatures[0]!.label).toBe("(a: any, b: any) => number | string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// signatureHelp：局部 callee 也有签名弹窗
// ---------------------------------------------------------------------------
describe("signatureHelp：局部 callee 也有签名弹窗", () => {
/**
 * LSP `signatureHelp` 对**函数体内的局部 callee**
 * （局部函数声明 / 局部箭头常量）**完全没有签名弹窗**。
 *
 * 根因：局部绑定不在**模块级**绑定表（`AnalysisResult.bindings`）里
 * ⇒ 绑定面必然 miss ⇒ 签名面必须落到 **AST 定位回落**
 * （与 hover 面同源的 `generalizeFromAst`）。
 */







const SRC = [
  "export function outer() {",
  "  function inner(x, y) {",
  "    return x + y;",
  "  }",
  "  const arrow = (a, b) => a + b;",
  "  inner(1, 2);",
  "  arrow(3, 4);",
  "  return 0;",
  "}",
].join("\n");

/** ` inner(1, 2);` / ` arrow(3, 4);` 的列 */
const LINE_INNER = SRC.split("\n")[5]!;
const LINE_ARROW = SRC.split("\n")[6]!;

function tmpFile(src: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b986-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src);
  return { dir, file };
}

describe("signatureHelp：局部 callee 也有签名弹窗", () => {
  it("协议面（真 server）：局部函数声明 inner(1, 2) 给出 2 参签名（改前 null）", async () => {
    const { dir, file } = tmpFile(SRC);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;

      const res = sig({
        textDocument: { uri },
        position: { line: 5, character: LINE_INNER.indexOf("1") },
      });
      // 改前：null（整面无响应）
      expect(res).not.toBeNull();
      expect(res!.signatures[0]!.parameters).toHaveLength(2);
      expect(res!.signatures[0]!.parameters[0]!.label).toBe("x: any");
      expect(res!.signatures[0]!.parameters[1]!.label).toBe("y: any");
      expect(res!.activeParameter).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("协议面（真 server）：局部箭头常量 arrow(3, 4) 给出 2 参签名（改前 null）", async () => {
    const { dir, file } = tmpFile(SRC);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;

      const res = sig({
        textDocument: { uri },
        position: { line: 6, character: LINE_ARROW.indexOf("3") },
      });
      expect(res).not.toBeNull();
      expect(res!.signatures[0]!.parameters).toHaveLength(2);
      expect(res!.signatures[0]!.parameters[0]!.label).toBe("a: any");
      expect(res!.signatures[0]!.parameters[1]!.label).toBe("b: any");
      expect(res!.activeParameter).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("协议面（真 server）：局部 callee 的第 2 个实参 ⇒ activeParameter = 1", async () => {
    const { dir, file } = tmpFile(SRC);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;

      const res = sig({
        textDocument: { uri },
        position: { line: 5, character: LINE_INNER.indexOf("2") },
      });
      expect(res).not.toBeNull();
      expect(res!.activeParameter).toBe(1);
      expect(res!.activeParameter!).toBeLessThan(res!.signatures[0]!.parameters.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：模块级 callee 仍走绑定面（签名口径一致）", async () => {
    const src = [
      "export function top(a, b) { return a + b; }",
      "export function caller() {",
      "  top(1, 2);",
      "  return 0;",
      "}",
    ].join("\n");
    const { dir, file } = tmpFile(src);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: src },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;
      const res = sig({
        textDocument: { uri },
        position: { line: 2, character: src.split("\n")[2]!.indexOf("1") },
      });
      expect(res).not.toBeNull();
      // 返回类型部分随 **** 的修复变精确。
      //
      // 旧期望 `"(a: any, b: any) => unknown"` 钉的正是 判红的
      // **症状**：`tmp/bug-report/sections/.md` §期望 vs 实际 明写
      // signatureHelp 的 label 期望是**精确签名**、实际是
      // 「`(user: any) => unknown`」（声明空壳：形参一律 any、返回一律
      // unknown）⇒ 与同一 LSP 面的 hover 及 CLI `nudo check` 互斥。
      // 战役按该条修了 signatureHelp（arity-only 空壳不采纳 ⇒ 回落内涵面）
      // ⇒ 模块级 callee 现在给的是**精确**签名：`a + b`（两侧 any）⇒
      // JS `+` 的 ToPrimitive 结果并集 `number | string`（引擎 check 面
      // 同源：`number | string throws TypeError`）。
      // ⇒ 负控改钉精确签名（负控本意：模块级 callee 与局部 callee 的签名
      // 口径一致，仍有签名弹窗）。
      expect(res!.signatures[0]!.label).toBe("(a: any, b: any) => number | string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// signatureHelp：成员调用（obj.method）也有签名弹窗
// ---------------------------------------------------------------------------
describe("signatureHelp：成员调用（obj.method）也有签名弹窗", () => {
/**
 * LSP `signatureHelp` 对**方法调用**（`obj.method(…)`）
 * **完全没有签名弹窗**，尽管引擎解析得出该方法的签名（成员补全面能给出
 * `method` 的 2 个具名形参 x / y）。
 *
 * 原生 oracle：成员调用的被调者是**接收者的槽位**，不是模块级绑定
 * ⇒ 签名面必须沿 Abs 形状逐段下钻。
 */







const SRC = [
  "const obj = { method(x, y) { return x + y; } };",
  "",
  "export function caller() {",
  "  obj.method(1, 2);",
  "  return 0;",
  "}",
].join("\n");

/** ` obj.method(1, 2);` 的列 */
const LINE = SRC.split("\n")[3]!;
const COL_OBJ = LINE.indexOf("obj");
const COL_METHOD = LINE.indexOf("method");
const COL_OPEN = LINE.indexOf("(");
const COL_ARG1 = LINE.indexOf("1");
const COL_CLOSE = LINE.indexOf(")");

function tmpFile(src: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b720-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src);
  return { dir, file };
}

describe("signatureHelp：成员调用（obj.method）也有签名弹窗", () => {
  it("协议面（真 server）：obj.method(1, 2) 给出方法的 2 参签名", async () => {
    const { dir, file } = tmpFile(SRC);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;

      const res = sig({ textDocument: { uri }, position: { line: 3, character: COL_ARG1 } });
      // 改前：null（整面无响应）
      expect(res).not.toBeNull();
      const label = res!.signatures[0]!.label;
      expect(label).toBe("(x: any, y: any) => unknown");
      expect(res!.signatures[0]!.parameters).toHaveLength(2);
      expect(res!.activeParameter).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("协议面（真 server）：光标在接收者 / 方法名 / 括号各处都给出同一签名", async () => {
    const { dir, file } = tmpFile(SRC);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;

      for (const col of [COL_OBJ, COL_METHOD, COL_OPEN]) {
        const res = sig({ textDocument: { uri }, position: { line: 3, character: col } });
        expect(res, `col=${col}`).not.toBeNull();
        expect(res!.signatures[0]!.label).toBe("(x: any, y: any) => unknown");
      }
      // 末参之后 ⇒ activeParameter 仍在参数表内
      const tail = sig({ textDocument: { uri }, position: { line: 3, character: COL_CLOSE } });
      expect(tail).not.toBeNull();
      expect(tail!.activeParameter!).toBeLessThan(tail!.signatures[0]!.parameters.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：顶层函数调用仍给顶层签名（成员面不得吞掉裸标识符面）", async () => {
    const src = [
      "export function plain(a, b) { return a + b; }",
      "export function caller() {",
      "  plain(1, 2);",
      "  return 0;",
      "}",
    ].join("\n");
    const { dir, file } = tmpFile(src);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: src },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;
      const col = src.split("\n")[2]!.indexOf("1");
      const res = sig({ textDocument: { uri }, position: { line: 2, character: col } });
      expect(res).not.toBeNull();
      expect(res!.signatures[0]!.parameters).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// signatureHelp：嵌套调用弹**最内层**函数的签名
// ---------------------------------------------------------------------------
describe("signatureHelp：嵌套调用弹**最内层**函数的签名", () => {
/**
 * LSP **嵌套调用**的 `signatureHelp` 弹**外层函数**的签名
 * （内层调用完全不参与）。
 *
 * 原生 oracle：光标在内层实参里 ⇒ 弹**内层**函数的签名
 * （LSP 签名帮助的语义 = 正在被编辑的那个调用）。
 *
 * 改前：`findEnclosingCall` 命中第一个（外层）CallExpression 即停 +
 * `path.skip()` ⇒ 内层 CallExpression 永不被访问 ⇒ 弹外层签名。
 */









const SRC = [
  "export function outer(a, b, c) { return a + b + c; }",
  "export function inner(x) { return x; }",
  "export function go() { return outer(inner(1), 3, 4); }",
].join("\n");

/** 源码列 → 断言用（`export function go() { return outer(inner(1), 3, 4); }`） */
const COL_INNER_ARG = SRC.split("\n")[2]!.indexOf("inner(1)") + "inner(1)".indexOf("1");
/** 外层第 2 个实参 `3` 的列（不是 `inner(1)` 后的那个逗号） */
const COL_OUTER_ARG2 = SRC.split("\n")[2]!.indexOf("3");

function tmpFile(src: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b711-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src);
  return { dir, file };
}

describe("signatureHelp：嵌套调用弹**最内层**函数的签名", () => {
  it("纯函数面：光标在内层实参 ⇒ findEnclosingCall 命中内层调用", () => {
    const ast = parse(SRC);
    const hit = findEnclosingCall(ast, 3, COL_INNER_ARG);
    expect(hit).not.toBeNull();
    // 内层 `inner` 的 callee 起点（不是外层 `outer`）
    const innerCalleeCol = SRC.split("\n")[2]!.indexOf("inner");
    expect(hit!.calleeCol).toBe(innerCalleeCol);
    expect(hit!.currentParamIndex).toBe(0);
    // 外层 `outer` 的 callee 起点（改前弹的就是这个）
    expect(innerCalleeCol).toBeGreaterThan(SRC.split("\n")[2]!.indexOf("outer"));
  });

  it("纯函数面：光标在外层第 2 个实参 ⇒ 仍命中外层调用", () => {
    const ast = parse(SRC);
    const hit = findEnclosingCall(ast, 3, COL_OUTER_ARG2);
    expect(hit).not.toBeNull();
    expect(hit!.calleeCol).toBe(SRC.split("\n")[2]!.indexOf("outer"));
    expect(hit!.currentParamIndex).toBe(1);
  });

  it("协议面（真 server）：内层实参处弹 inner 的 1 参签名（改前是 outer 的 3 参）", async () => {
    const { dir, file } = tmpFile(SRC);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;

      const res = sig({
        textDocument: { uri },
        position: { line: 2, character: COL_INNER_ARG },
      });
      expect(res).not.toBeNull();
      const label = res!.signatures[0]!.label;
      expect(label).toBe("(x: any) => any");
      expect(res!.signatures[0]!.parameters).toHaveLength(1);
      expect(res!.activeParameter).toBe(0);
      // 负控制：不得是外层的 3 参签名
      expect(label).not.toContain("a: any");
      expect(res!.signatures[0]!.parameters).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("协议面（真 server）：外层第 2 个实参处仍弹 outer 的 3 参签名", async () => {
    const { dir, file } = tmpFile(SRC);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await new Promise((r) => setTimeout(r, 250));
      const sig = mock.requests.get("textDocument/signatureHelp")!;

      const res = sig({
        textDocument: { uri },
        position: { line: 2, character: COL_OUTER_ARG2 },
      });
      expect(res).not.toBeNull();
      // 裸标识符 callee 落到与 hover 同源的 poly-fn 签名 ⇒ 返回位是
      // 真实推断（`a + b + c` ⇒ `number | string`），不再是 arity-only 占位
      // `unknown`。本用例的主断言（弹 outer 的 3 参签名 / activeParameter）不变。
      expect(res!.signatures[0]!.label).toBe("(a: any, b: any, c: any) => number | string");
      expect(res!.activeParameter).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
});

// ---------------------------------------------------------------------------
// signatureHelp 取内涵面，不返回 arity-only 声明空壳
// ---------------------------------------------------------------------------
describe("signatureHelp 取内涵面，不返回 arity-only 声明空壳", () => {
/**
 * `textDocument/signatureHelp` 把模块级 callee 渲染成
 * 「形参一律 `any`、返回一律 `unknown`」的**声明空壳** ⇒ 与同一 LSP 面的 hover
 * 及 CLI `nudo check` 给出互斥结论。
 *
 * 症状：`add({ id: 1 })` 的调用点，signatureHelp 给 `(user: any) => unknown`
 * （documentation 亦为 `(user) => ?`），而同一位置的 hover 给
 * `(user: shape({ name: string() })) → string()` 与精确签名
 * `add: (user: { name: string }) => string`，CLI `nudo check` 亦为
 * `add(user: { name: string }) => string`。
 *
 * 根因：`attachSignatureHelp` 路径①（裸标识符 → 绑定面 `getTypeAtPosition`）
 * 只要 `fnAbs.shape.k === "fn"` 就直接 return，不再回落路径③的内涵面
 * （`resolveCalleePolyFn` / `generalizeFromAst`）；而绑定面里的 fn Abs 常是
 * `fnOf()` 造的声明空壳（无 `paramTypes` / `returnType`）。
 *
 * 修法：路径①加与 hover 同款的 `deferIfArityOnlyFn` 闸门——`returnType` 槽空的
 * arity-only fn **不采纳**，回落内涵面 `buildSignatureHelpFromPolyFn`。
 *
 * 钉：调用点签名 label 含侧车契约的形参类型与返回类型（`{ name: string }` /
 * `string`），且**不是** arity-only 空壳（`user: any` / `unknown`）；同一位置
 * hover 仍给精确签名（两面同口径）。
 */



/** 复现夹具（tmp/repro//lib.js）：模块级 callee 的调用点在第 5 行。 */
const LIB = `export function add(user) {
  return user.name;
}
export function caller() {
  return add({ id: 1 });
}
`;

/** 侧车契约（tmp/repro//lib.nudo.js）：形参 `{ name: string }`，返回 `string`。 */
const SIDECAR = `import { fn, shape, string } from "@nudojs/core";

export const add = fn({ user: shape({ name: string() }) }, string());
`;

describe("signatureHelp 取内涵面，不返回 arity-only 声明空壳", () => {
  it("裸标识符 callee 的签名含侧车契约的形参类型与返回类型", async () => {
    await withLspServer({ "lib.js": LIB, "lib.nudo.js": SIDECAR }, async (ctx) => {
      // LSP 位置（0 基行 / 列）：` return add({ id: 1 });` 的 `add` 内
      const position = { line: 4, character: 10 };
      const sh: any = await ctx.req("textDocument/signatureHelp")({
        textDocument: { uri: ctx.uri("lib.js") },
        position,
      });
      const sig = sh?.signatures?.[0];

      // 契约形参 / 返回（不是 `(user: any) => unknown`）
      expect(sig?.label).toBe("(user: { name: string }) => string");
      expect(sig?.label).not.toContain("unknown");
      expect(sig?.label).not.toContain("user: any");
      expect(
        (sig?.parameters ?? []).map((p: any) => p.label),
        "形参位渲染必须带契约类型",
      ).toEqual(["user: { name: string }"]);

      // documentation 与 hover 同源，不得是占位符签名 `(user) => ?`
      const doc = String(sig?.documentation?.value ?? "");
      expect(doc).not.toContain("(user) => ?");

      // 同一面同口径：hover 在调用点给精确签名（`=> string`）
      const hov: any = await ctx.req("textDocument/hover")({
        textDocument: { uri: ctx.uri("lib.js") },
        position,
      });
      const hoverText = String(hov?.contents?.value ?? "");
      expect(hoverText).toContain("=> string");
      expect(hoverText).not.toContain("(user) => ?");
    });
  }, 60_000);
});
});

// ---------------------------------------------------------------------------
// findEnclosingCall (P-IDE7)
// ---------------------------------------------------------------------------
describe("findEnclosingCall (P-IDE7)", () => {
/**
 * findEnclosingCall（P-IDE7）：@babel/traverse 实现 + 完整区间参数下标。
 *
 * 旧手写 visitor 的两处缺陷：
 * - 区间判定只比行号（同行调用尾误命中）；
 * - paramIndex 只看参数 start（跨行参数被「start 在前 → +1」误判）。
 */




const MULTI_LINE = [
  "export function call(a, b, c) { return a; }", // 1
  "export function use() {", // 2
  "  return call(", // 3
  "    1,", // 4
  "    2,", // 5
  "    3,", // 6
  "  );", // 7
  "}", // 8
].join("\n");

const SINGLE_LINE = "export function use() { return call(11, 22); }\n";

/** 1-based line、0-based column（LSP handler 同口径） */
function at(src: string, line: number, column: number) {
  return findEnclosingCall(parse(src), line, column);
}

describe("findEnclosingCall (P-IDE7)", () => {
  it("multi-line args: cursor inside arg i selects param i (old visitor said i+1)", () => {
    // line 4 ` 1,`：`1` 区间 [4,5)。旧实现按「start 在 cursor 前 → +1」
    // 判成 1（跨行场景全错）；新实现按完整区间 → 0。
    expect(at(MULTI_LINE, 4, 4)).toMatchObject({
      calleeLine: 3,
      calleeCol: 9,
      currentParamIndex: 0,
    });
    expect(at(MULTI_LINE, 5, 4)?.currentParamIndex).toBe(1);
    expect(at(MULTI_LINE, 6, 4)?.currentParamIndex).toBe(2);
  });

  it("trailing comma: cursor after the last arg selects arity (not beyond)", () => {
    // line 6 (` 3,`)：`3` 区间 [4,5)，逗号 col 5 之后全是「已越过末参」
    expect(at(MULTI_LINE, 6, 6)?.currentParamIndex).toBe(3);
    expect(at(MULTI_LINE, 6, 6)?.currentParamIndex).toBeLessThanOrEqual(3);
  });

  it("cursor before first arg (right after '(') selects param 0", () => {
    // line 3 ` return call(`：`(` col 13，cursor col 14 在首参之前
    expect(at(MULTI_LINE, 3, 14)?.currentParamIndex).toBe(0);
  });

  it("single line: between args (on comma) selects the next param", () => {
    // `call(11, 22)`：11 区间 [36,38)，逗号 col 38，22 区间 [40,42)，`)` col 42
    expect(at(SINGLE_LINE, 1, 36)?.currentParamIndex).toBe(0); // 11 内
    expect(at(SINGLE_LINE, 1, 38)?.currentParamIndex).toBe(1); // 逗号上
    expect(at(SINGLE_LINE, 1, 40)?.currentParamIndex).toBe(1); // 22 内
    expect(at(SINGLE_LINE, 1, 42)?.currentParamIndex).toBe(2); // 22 结尾（`)` 处）
  });

  it("nested calls resolve to the innermost enclosing call (Bug 711)", () => {
    const nested = "export function use() { return call(call(1, 2), 3); }\n";
    // 光标在内层 call 的参数 `2`（col 44）上 ⇒ 弹**最内层** `call`（callee col 36），
    // 而非外层（callee col 31）。旧实现「首个命中即停 + path.skip()」取外层，
    // 内层调用永远不参与 ⇒ 弹的是完全无关的参数表。
    const inner = at(nested, 1, 44);
    expect(inner).toMatchObject({ calleeLine: 1, calleeCol: 36 });
    // 内层 call 的实参是 `(1, 2)` ⇒ `2` 是第 1 个（下标 1）
    expect(inner?.currentParamIndex).toBe(1);
    // 外层自己的实参（col 48 的 `3`）仍取外层 call，参数下标 = 1
    const outer = at(nested, 1, 48);
    expect(outer).toMatchObject({ calleeLine: 1, calleeCol: 31 });
    expect(outer?.currentParamIndex).toBe(1);
  });

  it("positions outside any call yield null; same-line-after-call no longer false-matches", () => {
    expect(at(MULTI_LINE, 1, 6)).toBeNull(); // 函数声明行，无调用包含
    expect(at("const x = 1;\n", 1, 4)).toBeNull();
    // 旧实现只比行号：`call(11, 22); }` 尾部同行会误命中；新实现含列判定
    expect(at(SINGLE_LINE, 1, 44)).toBeNull();
  });
});
});

// ---------------------------------------------------------------------------
// buildSignatureHelp (LSP-G7)
// ---------------------------------------------------------------------------
describe("buildSignatureHelp (LSP-G7)", () => {
describe("buildSignatureHelp (LSP-G7)", () => {
  it("projects paramTypes and returnType, not unknown placeholders", () => {
    const fn = relationFn([num(), str()], str(), {
      params: ["ms", "tag"],
    });
    const help = buildSignatureHelp(fn, 0);
    expect(help).not.toBeNull();
    const label = help!.signatures[0]!.label;
    expect(label).toContain("ms");
    expect(label).toContain("number");
    expect(label).toContain("tag");
    expect(label).toContain("string");
    expect(label).not.toContain("unknown");
    expect(help!.activeParameter).toBe(0);
  });

  it("missing paramTypes fall back to any (unconstrained), not unknown", () => {
    const fn = absFunction(["x", "y"], { apply: () => num() });
    const help = buildSignatureHelp(fn, 1);
    const label = help!.signatures[0]!.label;
    expect(label).toContain("x: any");
    expect(label).toContain("y: any");
    // 无 returnType → unknown = 推导失败面（诚实）
    expect(label).toContain("=> unknown");
    expect(help!.activeParameter).toBe(1);
  });

  it("rest and optional labels keep markers", () => {
    const fn = shapeOnlyFn([str(), num()], num(), {
      params: ["...paths", "opts?"],
    });
    const label = buildSignatureHelp(fn, 0)!.signatures[0]!.label;
    expect(label).toContain("...paths");
    expect(label).toContain("opts?:");
    expect(label).toContain("=> number");
  });

  it("rejects non-fn Abs", () => {
    expect(buildSignatureHelp(num(), 0)).toBeNull();
    expect(buildSignatureHelp(null as never, 0)).toBeNull();
  });

  it("documentation carries formatShape of the fn", () => {
    const fn = relationFn([num()], num(), { params: ["n"] });
    const help = buildSignatureHelp(fn, 0)!;
    const doc = help.signatures[0]!.documentation;
    expect(doc).toBeDefined();
    const text = typeof doc === "string" ? doc : (doc as { value: string }).value;
    expect(text).toContain(formatShape(fn));
  });

  it("unconstrained display stays any, never unknown, for typed arity-only fns", () => {
    const fn: Abs = {
      shape: { k: "fn", params: ["a", "b"] },
      conf: "exact",
    };
    const label = buildSignatureHelp(fn, 0)!.signatures[0]!.label;
    expect(label).toBe("(a: any, b: any) => unknown");
  });
});
});
