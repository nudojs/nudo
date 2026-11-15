/**
 * 模块套件：LSP test 命令面（case 选择/建议/断言/过滤/函数参数/导入文本）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Connection } from "vscode-languageserver/node";
import { createNudoServer } from "../server.ts";
import { createMockConnection, type AnyHandler, withLspServer } from "./helpers.ts";
import { analyzeFileAsync, buildTestReport } from "@nudojs/service";
import { suggestCase } from "../agent-tools.ts";

// ---------------------------------------------------------------------------
// Bug 756 — selectCase 的 caseIndex 必须落在该函数的 case 列表内
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 756 — selectCase 的 caseIndex 必须落在该函数的 case 列表内", () => {
/**
 * Bug 756 —— `nudo.selectCase` 不校验 caseIndex。
 *
 * 改前：caseIndex=-1 让分析崩溃（"Cannot read properties of undefined
 * (reading 'argsAbs')" 诊断）、caseIndex=99 静默改掉观察档（活动档表写出
 * {"f":99}）——两者都回 success:true。
 * 改后：越界一律回结构化错误，活动档表保持不变，且不再产生崩溃诊断。
 *
 * 钉：真 server（mock connection）+ 真 `workspace/executeCommand` 请求。
 *
 * 用例超时给到 30s：真 server 依赖图（server.ts → core/service/parser）在
 * 并行负载下首测要数秒，5s 默认值会偶发踩线。
 */








const SRC = `/**
 * @nudo:case "num" (1)
 * @nudo:case "str" ("a")
 */
export function f(x) {
  return x;
}
`;

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-lsp-bug756-"));
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

describe("Bug 756 — selectCase 的 caseIndex 必须落在该函数的 case 列表内", () => {
  it("越界 caseIndex 回结构化错误，活动档表不变", async () => {
    const mock = startServer();
    const exec = handler(mock, "workspace/executeCommand");
    const uri = `file://${file}`;

    // 前置：合法 case 选中
    const ok = await exec({
      command: "nudo.selectCase",
      arguments: [uri, "f", 0, "num"],
    });
    expect(ok).toEqual({ success: true });

    for (const bad of [99, -1, 2]) {
      const result = await exec({
        command: "nudo.selectCase",
        arguments: [uri, "f", bad, "?"],
      });
      expect(result.success, `caseIndex=${bad} 应当失败`).toBe(false);
      expect(result.isError).toBe(true);
      expect(result.error).toContain("out of range");
    }

    // 活动档表仍是合法的 0（越界写入不再污染）
    const active = await handler(mock, "nudo/getActiveCases")({ uri });
    expect(active).toEqual({ f: 0 });
  }, 30_000);

  it("越界 caseIndex 不产生分析崩溃诊断（argsAbs 越界）", async () => {
    const mock = startServer();
    const exec = handler(mock, "workspace/executeCommand");
    const uri = `file://${file}`;

    mock.notifications.get("textDocument/didOpen")!({
      textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
    });
    await new Promise((r) => setTimeout(r, 300));

    await exec({ command: "nudo.selectCase", arguments: [uri, "f", -1, "?"] });

    const crash = mock.sentDiagnostics
      .flatMap((d: { diagnostics: { message: string }[] }) => d.diagnostics)
      .filter((d: { message: string }) => d.message.includes("Analysis error"));
    expect(crash).toEqual([]);
  }, 30_000);

  it("非整数 caseIndex 回结构化错误", async () => {
    const mock = startServer();
    const result = await handler(mock, "workspace/executeCommand")({
      command: "nudo.selectCase",
      arguments: [`file://${file}`, "f", "0", "num"],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("integer");
  }, 30_000);
});
});

// ---------------------------------------------------------------------------
// Bug 764 — selectCase 必须校验 functionName
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 764 — selectCase 必须校验 functionName", () => {
/**
 * Bug 764 —— `nudo.selectCase` 不校验 functionName。
 *
 * 改前：任意名字（空串 ""、文件里不存在的 "doesNotExist"）都被当成真写进
 * 活动档表 ⇒ getActiveCases 如实上报幽灵条目（{"":0} / {"doesNotExist":0}）。
 * 改后：函数名必须是该文件里的已知函数，且必须有 @nudo:case 可选。
 *
 * 用例超时给到 30s：withLspServer 的首次动态 import（server.ts 依赖图）在
 * 并行负载下要数秒，5s 默认值会偶发踩线。
 */



const SRC = `/**
 * @nudo:case "num" (1)
 */
export function f(x) {
  return x;
}

export function g(y) {
  return y + 1;
}
`;

describe("Bug 764 — selectCase 必须校验 functionName", () => {
  it("空串 / 不存在的函数名回结构化错误，活动档表无幽灵条目", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req, uri }) => {
      const exec = req("workspace/executeCommand");
      const fileUri = uri("sel.js");

      const empty = await exec({ command: "nudo.selectCase", arguments: [fileUri, "", 0, "?"] });
      expect(empty.success).toBe(false);
      expect(empty.isError).toBe(true);
      expect(empty.error).toContain("functionName");

      const ghost = await exec({
        command: "nudo.selectCase",
        arguments: [fileUri, "doesNotExist", 0, "?"],
      });
      expect(ghost.success).toBe(false);
      expect(ghost.error).toContain("unknown function");

      // 幽灵条目不再出现
      const active = await req("nudo/getActiveCases")({ uri: fileUri });
      expect(active).toEqual({});
    });
  }, 30_000);

  it("文件里存在但没有 @nudo:case 的函数回结构化错误", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req, uri }) => {
      const result = await req("workspace/executeCommand")({
        command: "nudo.selectCase",
        arguments: [uri("sel.js"), "g", 0, "?"],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("no @nudo:case");
      expect(await req("nudo/getActiveCases")({ uri: uri("sel.js") })).toEqual({});
    });
  }, 30_000);

  it("合法函数名仍然选中并写入活动档表", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req, uri }) => {
      const result = await req("workspace/executeCommand")({
        command: "nudo.selectCase",
        arguments: [uri("sel.js"), "f", 0, "num"],
      });
      expect(result).toEqual({ success: true });
      expect(await req("nudo/getActiveCases")({ uri: uri("sel.js") })).toEqual({ f: 0 });
    });
  }, 30_000);
});
});

// ---------------------------------------------------------------------------
// Bug 763 — selectContract 必须校验目标函数
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 763 — selectContract 必须校验目标函数", () => {
/**
 * Bug 763 —— `nudo.selectContract` 无条件回 success:true。
 *
 * 改前：目标函数不存在（"noSuchFn"）、甚至参数全缺时也回 {"success":true}
 * ——协议层假成功，客户端以为契约已切回。
 * 改后：目标不在该文件里 ⇒ 结构化错误（success:false + isError），且活动
 * 档表不产生幽灵条目。
 *
 * 用例超时给到 30s：withLspServer 的首次动态 import（server.ts 依赖图）在
 * 并行负载下要数秒，5s 默认值会偶发踩线。
 */



const SRC = `/**
 * @nudo:case "num" (1)
 */
export function f(x) {
  return x;
}

export function g(y) {
  return y + 1;
}
`;

describe("Bug 763 — selectContract 必须校验目标函数", () => {
  it("目标函数不存在时回结构化错误，不写幽灵条目", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req, uri }) => {
      const exec = req("workspace/executeCommand");
      const fileUri = uri("sel.js");

      const result = await exec({
        command: "nudo.selectContract",
        arguments: [fileUri, "noSuchFn"],
      });
      expect(result.success).toBe(false);
      expect(result.isError).toBe(true);
      expect(result.error).toContain("unknown function");

      const active = await req("nudo/getActiveCases")({ uri: fileUri });
      expect(active).toEqual({});
    });
  }, 30_000);

  it("参数缺失（无 functionName）时回结构化错误", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req, uri }) => {
      const result = await req("workspace/executeCommand")({
        command: "nudo.selectContract",
        arguments: [uri("sel.js")],
      });
      expect(result.success).toBe(false);
      expect(result.isError).toBe(true);
      expect(result.error).toContain("functionName");
    });
  }, 30_000);

  it("合法目标（文件里的导出函数）仍然成功，且取消该函数的激活 case", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req, uri }) => {
      const exec = req("workspace/executeCommand");
      const fileUri = uri("sel.js");

      await exec({ command: "nudo.selectCase", arguments: [fileUri, "f", 0, "num"] });
      expect(await req("nudo/getActiveCases")({ uri: fileUri })).toEqual({ f: 0 });

      const result = await exec({ command: "nudo.selectContract", arguments: [fileUri, "f"] });
      expect(result).toEqual({ success: true });
      expect(await req("nudo/getActiveCases")({ uri: fileUri })).toEqual({});
    });
  }, 30_000);
});
});

// ---------------------------------------------------------------------------
// Bug 655 · suggestCase 建议的名字与期望
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 655 · suggestCase 建议的名字与期望", () => {
/**
 * Bug 655 —— LSP agent 工具 `nudo/suggestCase` 的建议：**名字**与**期望**。
 *
 * 报告原文：`nudo/suggestCase` 把**合成 case 的原名**（`call@L<n>`）原样写进
 * 建议文本 ⇒ ① 建议落进引擎的「合成 / 固化」名字空间（`call@` / `entry@`）；
 * ② 用户照建议原样贴回源码 ⇒ 与 `--freeze` 固化的见证**重复**（同一个调用点
 * 留下两条见证）。
 *
 * ⚠ 勘误：报告断言的「贴回后零断言、期望永不被判定」**已不复现** —— 引擎侧
 * 的「按名字前缀降级」已被族 14/15（Bug 651）修掉（判据改成**来源**
 * `c.source !== "directive"`）⇒ 贴回后是**声明 case**（进断言面、但没写
 * `=> expected` ⇒ `unchecked`）。**本钉只钉工具侧这一面**：
 * ① 建议里的 case 名**不在** `call@` / `entry@` 合成 / 冻结名字空间；
 * ② 建议**带** `=> expected` ⇒ 贴回后真的产生断言（进断言面、不是 `unchecked`）。
 *
 * 夹具走**内存源码**（`params.source`）——与同族 `lsp-bug-759-*` 钉同款；
 * `helpers.ts` 的 tmpdir 脚手架对本钉无用（不需要落盘），故不复制脚手架。
 */




/** 夹具：顶层调用点 ⇒ 分析器合成一条 `call@L<n>` 见证。 */
const SRC = [
  "export function greet(name) {",
  '  return "hi " + name;',
  "}",
  'const r = greet("bob");',
  "console.log(r);",
  "",
].join("\n");

const FILE = "/t/bug-655-greet.js";

/** 合成 / 固化见证的名字空间前缀（`call@` = service 侧 `GENERATED_PREFIX`；
 *  `entry@` = 入口兜底见证）——手写见证名一律避开。 */
const SYNTHETIC_PREFIXES = ["call@", "entry@"];

/** 建议文本里的 case 名（`@nudo:case "<name>" (…)`）。 */
function suggestedNames(text: string): string[] {
  return [...text.matchAll(/@nudo:case "([^"]+)"/g)].map((m) => m[1]!);
}

/** 建议文本里的指令行（`@nudo:case "…" (…) [=> expected]`）。 */
function suggestedDirectives(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => l.trim().startsWith("* @nudo:case"))
    .map((l) => l.trim().replace(/^\*\s*/, ""));
}

/** 建议文本里的 JSDoc 块（`/** … *\/`）——可直接贴回源码。 */
function suggestedBlock(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === "/**");
  const end = lines.findIndex((l, i) => i > start && l.trim() === "*/");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end + 1).join("\n");
}

async function suggestText(): Promise<string> {
  const r = await suggestCase(
    { file: FILE, functionName: "greet", source: SRC },
    { readFile: () => SRC },
  );
  return r.content[0]!.text;
}

describe("Bug 655 · suggestCase 建议的名字与期望", () => {
  it("建议里的 case 名不落在合成 / 冻结名字空间（改前是 call@L<n>）", async () => {
    const text = await suggestText();
    const names = suggestedNames(text);
    expect(names.length).toBe(1);
    for (const name of names) {
      for (const prefix of SYNTHETIC_PREFIXES) {
        expect(name.startsWith(prefix)).toBe(false);
      }
    }
    // 合成 case 的原名不得泄漏进建议（改前：`* @nudo:case "call@L4" ("bob")`）
    expect(text).not.toContain("call@L");
    for (const directive of suggestedDirectives(text)) {
      expect(directive).not.toContain("call@");
      expect(directive).not.toContain("entry@");
    }
  });

  it("建议带 `=> expected`（观测值）⇒ 贴回后真的产生断言，而不是 unchecked", async () => {
    const text = await suggestText();
    const directives = suggestedDirectives(text);
    expect(directives.length).toBe(1);
    expect(directives[0]).toMatch(/^@nudo:case "[^"]+" \(.*\) => .+$/);
  });

  it("把建议原样贴回源码 ⇒ 声明 case 进断言面并判 ok（passed 1 / failed 0 / unchecked 0）", async () => {
    const text = await suggestText();
    const pasted = `${suggestedBlock(text)}\n${SRC}`;
    const result = await analyzeFileAsync(FILE, pasted, undefined, undefined, undefined, "all");
    const report = buildTestReport(FILE, result);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.unchecked).toBe(0);
    // 贴回的是**声明** case（不是合成观察）⇒ 不带 call@ / entry@ 前缀
    const declared = report.outcomes.filter((o) => !o.synthetic);
    expect(declared.length).toBe(1);
    expect(declared[0]!.caseName.startsWith("call@")).toBe(false);
    expect(declared[0]!.caseName.startsWith("entry@")).toBe(false);
    expect(declared[0]!.expected).toBeDefined();
  });

  it("同一份源码的建议名稳定（可重复贴回，不会每次换名）", async () => {
    const first = suggestedNames(await suggestText());
    const second = suggestedNames(await suggestText());
    expect(second).toEqual(first);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 759 反向钉：suggestCase 区分「已声明 case」与「合成见证」
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 759 反向钉：suggestCase 区分「已声明 case」与「合成见证」", () => {
/**
 * Bug 759 —— **上游已修（报告结论不成立）**：反向钉，钉住「当前行为正确」。
 *
 * 报告称 `nudo/suggestCase` 把**合成见证**（`call@` / `entry@`）当成用户
 * 手写的 `@nudo:case`，于是「already has N case(s)」并拒绝再建议。
 * 实测：上游已把「已声明 case（source = "directive"）」与「合成见证
 * （source ≠ "directive"）」**分开计数**——只有合成见证时走「synthesized
 * case(s); suggested directives」并给出可粘贴指令；只有手写指令时才报
 * 「already has N case(s)」。
 *
 * 本钉锁住该行为：改前（HEAD）与改后都必须绿。**不改产品代码。**
 */



describe("Bug 759 反向钉：suggestCase 区分「已声明 case」与「合成见证」", () => {
  it("只有合成见证（call@）时给建议，不报 'already has N case(s)'", async () => {
    const src = [
      "export function add(a, b) { return a + b; }",
      "const r = add(1, 2);",
      "",
    ].join("\n");
    const r = await suggestCase(
      { file: "/t/a4-759.js", functionName: "add", source: src },
      { readFile: () => src },
    );
    expect(r.content[0].text).toContain("synthesized case(s)");
    expect(r.content[0].text).toContain("suggested directives:");
    expect(r.content[0].text).not.toContain("already has");
  });

  it("手写 @nudo:case 时报 'already has 1 case(s)'（且不重复建议）", async () => {
    const src = ['// @nudo:case "one" (1)', "function inc(n) { return n + 1; }", ""].join("\n");
    const r = await suggestCase(
      { file: "/t/a4-759b.js", functionName: "inc", source: src },
      { readFile: () => src },
    );
    expect(r.content[0].text).toBe('Function "inc" already has 1 case(s)');
  });
});
});

// ---------------------------------------------------------------------------
// Bug 754 — agent nudo/test 并入 assertions 汇总
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 754 — agent nudo/test 并入 assertions 汇总", () => {
/**
 * Bug 754 — LSP agent 工具 `nudo/test` 丢掉 CLI 的 **`assertions` 通道**
 * ⇒ agent 面分不出「见证通过」与「见证失败」。
 *
 * 症状（改前）：CLI `nudo test --json` 的顶层键含 `assertions`
 * （`{"passed": 1, "failed": 1, "unchecked": 0}`），agent 工具的 JSON 里
 * **根本没有 `assertions` 这个键**。
 *
 * 本钉用一条**声明了期望值**的 `@nudo:case`（通过）与一条期望值**不满足**的
 * `@nudo:case`（失败）⇒ 断言汇总必须能分出两者。
 */



const CASES = `/**
 * @nudo:case "ok" (2) => 4
 * @nudo:case "bad" (2) => 99
 */
export function double(x) {
  return x * 2;
}
`;

describe("Bug 754 — agent nudo/test 并入 assertions 汇总", () => {
  it("JSON 面含 assertions 键（passed / failed / unchecked）", async () => {
    await withLspServer({ "cases.js": CASES }, async ({ req, dir }) => {
      const r = await req("nudo/test")({ file: `${dir}/cases.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      expect(json.assertions).toBeTruthy();
      expect(typeof json.assertions.passed).toBe("number");
      expect(typeof json.assertions.failed).toBe("number");
      expect(typeof json.assertions.unchecked).toBe("number");
    });
  });

  it("通过 / 失败的见证被分开计数（不是「全部通过」）", async () => {
    await withLspServer({ "cases.js": CASES }, async ({ req, dir }) => {
      const r = await req("nudo/test")({ file: `${dir}/cases.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      expect(json.assertions.passed).toBeGreaterThanOrEqual(1);
      expect(json.assertions.failed).toBeGreaterThanOrEqual(1);
    });
  });

  it("dot 形式同样含 assertions（协议别名不降级）", async () => {
    await withLspServer({ "cases.js": CASES }, async ({ req, dir }) => {
      const r = await req("nudo.test")({ file: `${dir}/cases.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      expect(json.assertions).toBeTruthy();
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 761 — agent nudo/test 过滤后 summary.cases 与 payload 同源
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 761 — agent nudo/test 过滤后 summary.cases 与 payload 同源", () => {
/**
 * Bug 761 — LSP agent 工具 `nudo/test` 的 **`functions` 过滤**只重算**本地**
 * 函数的 case 数 ⇒ `summary.cases` 与**自身 payload** 矛盾（summary 说 1 个
 * case，payload 里躺着 2 个）。
 *
 * 根因：过滤分支只替换了 `functions` 与 `summary` 两个键，`externalFunctions`
 * （连同它的 case）原封不动留在 payload 里 ⇒ 「summary 说 1、payload 有 2」。
 *
 * 修法口径（与 bug 报告一致）：外部函数**不在** `functions` 过滤范围内 ⇒ 其
 * case 仍留在 payload 里 ⇒ `summary.cases` 必须**含**外部 case。
 */



const LIB = `export function helper(x) {
  return x + 1;
}
`;

const MAIN = `import { helper } from "./lib.js";
export function alpha(x) {
  return helper(x);
}
export function beta(x) {
  return x * 2;
}
alpha(1);
beta(2);
`;

describe("Bug 761 — agent nudo/test 过滤后 summary.cases 与 payload 同源", () => {
  it("summary.cases == payload 里的实际 case 总数（含外部 case）", async () => {
    await withLspServer(
      { "lib.js": LIB, "main.js": MAIN },
      async ({ req, dir }) => {
        const r = await req("nudo/test")({
          file: `${dir}/main.js`,
          format: "json",
          functions: ["alpha"],
        });
        const json = JSON.parse(r.content[0].text);
        const local = json.functions.reduce(
          (n: number, f: { cases: unknown[] }) => n + f.cases.length,
          0,
        );
        const external = (json.externalFunctions ?? []).reduce(
          (n: number, f: { cases: unknown[] }) => n + f.cases.length,
          0,
        );
        expect(local).toBe(1);
        expect(external).toBe(1);
        expect(json.summary.cases).toBe(local + external);
      },
    );
  });

  it("summary.externalFunctions 与 payload 里的外部函数数一致", async () => {
    await withLspServer(
      { "lib.js": LIB, "main.js": MAIN },
      async ({ req, dir }) => {
        const r = await req("nudo/test")({
          file: `${dir}/main.js`,
          format: "json",
          functions: ["alpha"],
        });
        const json = JSON.parse(r.content[0].text);
        expect(json.summary.externalFunctions).toBe(
          (json.externalFunctions ?? []).length,
        );
        expect(json.summary.functions).toBe(json.functions.length);
      },
    );
  });

  it("未过滤时 summary.cases 同样与 payload 同源（含外部 case）", async () => {
    await withLspServer(
      { "lib.js": LIB, "main.js": MAIN },
      async ({ req, dir }) => {
        const r = await req("nudo/test")({ file: `${dir}/main.js`, format: "json" });
        const json = JSON.parse(r.content[0].text);
        const local = json.functions.reduce(
          (n: number, f: { cases: unknown[] }) => n + f.cases.length,
          0,
        );
        const external = (json.externalFunctions ?? []).reduce(
          (n: number, f: { cases: unknown[] }) => n + f.cases.length,
          0,
        );
        expect(json.summary.cases).toBe(local + external);
      },
    );
  });
});
});

// ---------------------------------------------------------------------------
// Bug 962 — agent nudo/test 的 functions 入参形态校验
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 962 — agent nudo/test 的 functions 入参形态校验", () => {
/**
 * Bug 962 — LSP agent 工具 `nudo.test` 的 **`functions` 入参零校验**。
 *
 * 改前两种畸形形态：
 * 1. 传**字符串** ⇒ 按**字符**建集合 ⇒ 函数全被过滤掉 ⇒ 返回一份**完全
 *    合法但全空**的报告（`0 fn · 0 case`）⇒ agent 得出「这个文件没有
 *    函数」的**假空**结论（无错误、无警告、零信号）；
 * 2. 传**数字 / 对象** ⇒ `params.functions.length` 为 undefined ⇒ 过滤被
 *    **整体跳过** ⇒ 请求**静默失效**（拿到的是未过滤的全量报告）。
 *
 * 修法：入口做形态校验 ⇒ 畸形入参一律**工具错误**（`isError: true`）。
 */



const SRC = `function a(x) { return x; }
function b(x) { return x + 1; }
`;

describe("Bug 962 — agent nudo/test 的 functions 入参形态校验", () => {
  it("functions 传字符串 ⇒ 工具错误（不是全空报告）", async () => {
    await withLspServer({ "m.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/test")({
        file: `${dir}/m.js`,
        format: "json",
        functions: "b",
      });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("functions must be an array of function names");
    });
  });

  it("functions 传数字 ⇒ 工具错误（不再静默跳过过滤）", async () => {
    await withLspServer({ "m.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/test")({
        file: `${dir}/m.js`,
        format: "json",
        functions: 42,
      });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("functions must be an array of function names");
    });
  });

  it("functions 传对象 ⇒ 工具错误", async () => {
    await withLspServer({ "m.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/test")({
        file: `${dir}/m.js`,
        format: "json",
        functions: { name: "b" },
      });
      expect(r.isError).toBe(true);
    });
  });

  it("functions 传非字符串元素的数组 ⇒ 工具错误", async () => {
    await withLspServer({ "m.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/test")({
        file: `${dir}/m.js`,
        format: "json",
        functions: ["b", 7],
      });
      expect(r.isError).toBe(true);
    });
  });

  it("合法数组仍然过滤（回归护栏）", async () => {
    await withLspServer({ "m.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/test")({
        file: `${dir}/m.js`,
        format: "json",
        functions: ["b"],
      });
      expect(r.isError).toBeUndefined();
      const json = JSON.parse(r.content[0].text);
      expect(json.functions.map((f: { name: string }) => f.name)).toEqual(["b"]);
    });
  });

  it("缺省（不传 functions）仍然返回全量报告", async () => {
    await withLspServer({ "m.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/test")({ file: `${dir}/m.js`, format: "json" });
      expect(r.isError).toBeUndefined();
      const json = JSON.parse(r.content[0].text);
      expect(json.functions.length).toBe(2);
    });
  });
});
});

// ---------------------------------------------------------------------------
// Bug 760 — agent nudo/test 文本面渲染 imported 段
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 760 — agent nudo/test 文本面渲染 imported 段", () => {
/**
 * Bug 760 — LSP agent 工具 `nudo/test` 的**文本面**丢掉 **imported（外部）
 * 函数** ⇒ CLI 文本面有的 `(imported)` 段在 IDE 面整段消失，而头部计数**仍
 * 把外部 case 算进去**（「2 fn · 3 case」却只列出 2 个函数块）。
 *
 * 本钉断言：文本面出现 `(imported)` 段头 + 外部函数名 + 它的 case ⇒ 正文
 * 里印出的 case 数与头部计数一致。
 */



const LIB = `export function helper(x) {
  return x + 1;
}
`;

const MAIN = `import { helper } from "./lib.js";
export function alpha(x) {
  return helper(x);
}
export function beta(x) {
  return x * 2;
}
alpha(1);
beta(2);
`;

describe("Bug 760 — agent nudo/test 文本面渲染 imported 段", () => {
  it("文本面含 (imported) 段头与外部函数", async () => {
    await withLspServer(
      { "lib.js": LIB, "main.js": MAIN },
      async ({ req, dir }) => {
        const r = await req("nudo/test")({ file: `${dir}/main.js` });
        const text = r.content[0].text;
        expect(text).toContain("(imported)");
        expect(text).toContain("helper");
        // 段头带来源模块（lib.js 的绝对路径）
        expect(text).toContain("lib.js (imported)");
      },
    );
  });

  it("头部 case 计数与正文印出的 case 一致（不再「3 case 只印 2 条」）", async () => {
    await withLspServer(
      { "lib.js": LIB, "main.js": MAIN },
      async ({ req, dir }) => {
        const r = await req("nudo/test")({ file: `${dir}/main.js` });
        const text = r.content[0].text;
        const header = text.split("\n").find((l: string) => l.includes(" fn · "));
        expect(header).toBeTruthy();
        const declared = Number(header!.match(/(\d+) case/)?.[1]);
        // 正文里印出的 case 行（`  call@L…: (…) => …`）
        const printed = text.split("\n").filter((l: string) => /^ {2}call@/.test(l)).length;
        expect(printed).toBe(declared);
      },
    );
  });
});
});
