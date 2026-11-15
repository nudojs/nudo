/**
 * 模块套件：agent tool 面（路径错误/deps 懒加载/env 预载/error flag/文件校验）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { withLspServer, withTempDir, createMockConnection } from "./helpers.ts";
import { join } from "node:path";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { codeActionParams, missingFieldDiag, mountCodeActions } from "./lsp-harness-r90a.ts";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// agent 工具的路径错误通道
// ---------------------------------------------------------------------------
describe("agent 工具的路径错误通道", () => {
/**
 * LSP agent 工具 `nudo/test` / `nudo/check` **没有路径错误通道**
 * ⇒ 文件不存在 ⇒ 返回**裸 ENOENT 文本**（没有 `pathErrors[]`、没有
 * `nudo:path-not-found` 码、没有 suggestion）；而 CLI `test --json` /
 * `check --json` 对同一文件给**结构化信封**。
 *
 * 修法：路径不可用 ⇒ 结构化通道（CaseJson / CheckJson 的 `pathErrors[]`），
 * 且 `format:"json"` 必须真的返回 JSON。
 */



const SRC = "export function add(a) {\n  return a + 1;\n}\n";

describe("agent 工具的路径错误通道", () => {
  it("nudo/test：JSON 面是结构化 pathErrors（不是裸 errno 文本）", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/test")({ file: `${dir}/nope.js`, format: "json" });
      expect(r.isError).toBe(true);
      const json = JSON.parse(r.content[0].text);
      expect(json.pathErrors).toBeTruthy();
      expect(json.pathErrors[0].code).toBe("nudo:path-not-found");
      expect(json.pathErrors[0].message).toContain("Not found:");
      expect(json.pathErrors[0].suggestion).toBeTruthy();
      expect(json.pathErrors[0].path).toContain("nope.js");
    });
  });

  it("nudo/check：JSON 面是结构化 pathErrors", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/check")({ file: `${dir}/nope.js`, format: "json" });
      expect(r.isError).toBe(true);
      const json = JSON.parse(r.content[0].text);
      expect(json.ok).toBe(false);
      expect(json.pathErrors[0].code).toBe("nudo:path-not-found");
      expect(json.pathErrors[0].suggestion).toBeTruthy();
    });
  });

  it("文本面：一行原因 + fix 提示（不再是裸 errno）", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/test")({ file: `${dir}/nope.js` });
      expect(r.isError).toBe(true);
      const text = r.content[0].text;
      expect(text).toContain("Not found:");
      expect(text).toContain("fix:");
      expect(text).not.toContain("ENOENT");
    });
  });

  it("dot 形式同样是结构化信封", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo.test")({ file: `${dir}/nope.js`, format: "json" });
      expect(r.isError).toBe(true);
      const json = JSON.parse(r.content[0].text);
      expect(json.pathErrors[0].code).toBe("nudo:path-not-found");
    });
  });
});
});

// ---------------------------------------------------------------------------
// codeAction 面不得因 agentToolDeps 未回填而全瘫
// ---------------------------------------------------------------------------
describe("codeAction 面不得因 agentToolDeps 未回填而全瘫", () => {
/**
 * `attachCodeActions` 在**真 server 的挂载后状态**下把
 * `agentToolDeps` 提前捕获 ⇒ 闭包里的常量恒为 `undefined` ⇒
 * `agentToolDeps.getOpenText?.(…)` 在可选链生效**之前**就抛 TypeError
 * ⇒ 整个 `textDocument/codeAction` 面全瘫（0 个 action）。
 *
 * 真 server 的时序：`server.ts` 先建 `agentToolDepsRef`（`current` 还是
 * `undefined`）→ 调 `attachCodeActions({ …, get agentToolDeps() { … } })`
 * → **之后**才回填 ref ⇒ 挂载这一刻读到的就是 `undefined`。
 *
 * 钉：挂载后 `agentToolDeps` 为 undefined 时，codeAction 不得抛，
 * 且必须给出可用 action。
 */






const GREET_JS = `export function greet(u) {
  return u.name + "!";
}

greet({ id: 2 });
`;
const GREET_SC = `import { fn, shape, string } from "@nudojs/core";

export const greet = fn({ u: shape({ name: string() }) }, string());
`;

describe("codeAction 面不得因 agentToolDeps 未回填而全瘫", () => {
  it("agentToolDeps = undefined（真 server 挂载后状态）时不抛且给出 action", () => {
    withTempDir("nudo-lsp-735-", (dir) => {
      writeFileSync(join(dir, "greet.js"), GREET_JS, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), GREET_SC, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, GREET_JS);
      let actions: unknown;
      expect(() => {
        actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      }).not.toThrow();
      expect(Array.isArray(actions)).toBe(true);
      expect((actions as unknown[]).length).toBeGreaterThan(0);
    });
  });

  it("agentToolDeps = undefined 时侧车仍从磁盘读到（契约面可见）", () => {
    withTempDir("nudo-lsp-735b-", (dir) => {
      writeFileSync(join(dir, "greet.js"), GREET_JS, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), GREET_SC, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, GREET_JS);
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      // 契约里 u 的 shape 已有 name ⇒ 不下发「往契约 shape 补字段」的动作
      // （补了就是重复键）；但**不得**因为 sidecar 读不到而崩。
      const titles = actions.map((a) => a.title);
      expect(titles.some((t) => t.includes("contract shape"))).toBe(false);
    });
  });

  it("agentToolDeps 有 getOpenText 时读**编辑器打开缓冲**的侧车文本", () => {
    withTempDir("nudo-lsp-735c-", (dir) => {
      writeFileSync(join(dir, "greet.js"), GREET_JS, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, GREET_JS, {
        agentToolDeps: "buffer",
        openSidecar: {
          // 打开缓冲里的侧车：u 的 shape **没有** name ⇒ 应当给出补字段动作
          [join(dir, "greet.nudo.js")]:
            `import { fn, shape, number } from "@nudojs/core";\n\nexport const greet = fn({ u: shape({ id: number() }) }, string());\n`,
        },
      });
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      const titles = actions.map((a) => a.title);
      expect(titles.some((t) => t === "Add 'name' to greet contract shape")).toBe(true);
    });
  });
});
});

// ---------------------------------------------------------------------------
// agent 工具走异步入口 ⇒ path 型 env 必被预载
// ---------------------------------------------------------------------------
describe("agent 工具走异步入口 ⇒ path 型 env 必被预载", () => {
/**
 * agent 工具走**同步** `analyzeFile` ⇒ path 型 env 不被预载 ⇒
 * 工具输出取决于「同一进程里谁先被调用过」：
 *
 * - 文件**未在编辑器打开**时，`nudo/trace` 看不到 env 里的全局 ⇒ case 结果
 * 是 `unknown`（报告里的 `never` 同源）；文件被打开过（push 诊断走
 * `analyzeFileAsync` ⇒ 预载了 env）⇒ 同一工具、同一文件给出 `99`。
 * - 「先同步（未预载）、后异步（已预载）」时，分析缓存会把**无 env 的陈旧
 * 结果**喂给后续调用（键里只有 env 文件的**内容**，没有**预载状态**）。
 *
 * 修法：观察类工具走 `analyzeFileAsync`（先 `await preloadPathEnvs`），且
 * 分析缓存键纳入 env 预载状态。
 *
 * 本钉用**真 server（mock connection）+ 真协议请求**，并且**不 didOpen**
 * （冷状态）。
 */






let dir = "";
let file = "";

const ENV_SRC = [
  'import { numLit } from "@nudojs/core";',
  "export function defineEnv() {",
  "  return { globals: { MAGIC: numLit(99) } };",
  "}",
  "",
].join("\n");

const APP_SRC = [
  "/// @nudo:env ./a4-993-env.ts",
  "",
  "/**",
  ' * @nudo:case "t" ()',
  " */",
  "function getMagic() {",
  "  return MAGIC;",
  "}",
  "",
].join("\n");

/** 每个用例一套**独立命名**的 env 文件：env 工厂注册表按**说明符**键，
 * 同名 env 会「先预载者赢」⇒ 用例之间必须互不遮蔽。 */
function setup(envName: string): void {
  dir = mkdtempSync(join(tmpdir(), "nudo-a4-993-"));
  writeFileSync(join(dir, envName), ENV_SRC, "utf-8");
  file = join(dir, "a4-993.js");
  writeFileSync(file, APP_SRC.replace("./a4-993-env.ts", `./${envName}`), "utf-8");
}

beforeEach(() => {
  setup("a4-993-env.ts");
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("agent 工具走异步入口 ⇒ path 型 env 必被预载", () => {
  it("文件未打开时 nudo/trace 也能看到 env 的全局（99，而非 unknown）", async () => {
    const mock = createMockConnection();
    const { createNudoServer } = await import("../server.ts");
    createNudoServer(mock as unknown as never);

    // 冷状态：没有任何 didOpen ⇒ env 未被预载
    const cold = await mock.requests.get("nudo/trace")!({ file, functionName: "getMagic" });
    expect(cold.content[0].text).toContain("99");
    expect(cold.content[0].text).not.toContain("unknown");
  });

  it("打开与否给出**同一个**答案（不随会话状态变）", async () => {
    const mock = createMockConnection();
    const { createNudoServer } = await import("../server.ts");
    createNudoServer(mock as unknown as never);

    const before = await mock.requests.get("nudo/trace")!({ file, functionName: "getMagic" });
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: {
        uri: `file://${file}`,
        languageId: "javascript",
        version: 1,
        text: APP_SRC,
      },
    });
    await new Promise((r) => setTimeout(r, 300));
    const after = await mock.requests.get("nudo/trace")!({ file, functionName: "getMagic" });
    expect(before.content[0].text).toBe(after.content[0].text);
    expect(after.content[0].text).toContain("99");
  });

  it("同步面（nudo/test）先跑也不得把「无 env」的陈旧结果喂给后续异步调用", async () => {
    setup("a4-993-env-b.ts");
    const mock = createMockConnection();
    const { createNudoServer } = await import("../server.ts");
    createNudoServer(mock as unknown as never);

    // 同步面先跑（冷状态）——它自身仍是同步入口（testTool 属 A1 分片）
    await mock.requests.get("nudo/test")!({ file });
    // 随后的异步工具必须重新分析（env 已预载）而不是命中陈旧条目
    const traced = await mock.requests.get("nudo/trace")!({ file, functionName: "getMagic" });
    expect(traced.content[0].text).toContain("99");
  });
});
});

// ---------------------------------------------------------------------------
// agent 工具失败路径带 isError:true（协议面）
// ---------------------------------------------------------------------------
describe("agent 工具失败路径带 isError:true（协议面）", () => {
/**
 * agent 工具的**失败路径**必须带 `isError: true`
 * （协议层可与成功区分；此前失败与成功同形，客户端只能解析文本猜）。
 *
 * 覆盖面（本分片 A4 的工具面）：
 * - `nudo/trace`：函数不存在 ⇒ 工具错误
 * - `nudo/suggestCase`：函数不存在 ⇒ 工具错误
 * - 成功面**不得**带 isError（对照组：trace 一个存在的函数）
 *
 * 协议面回归钉：真 server（mock connection）+ 真协议请求。
 */



const SRC = [
  "export function inc(n) {",
  "  return n + 1;",
  "}",
  "",
].join("\n");

describe("agent 工具失败路径带 isError:true（协议面）", () => {
  it("trace / suggestCase 的「函数不存在」是失败（isError），成功面不带", async () => {
    await withLspServer({ "a4-767.js": SRC }, async ({ req, uri }) => {
      const file = uri("a4-767.js");

      const missingTrace = await req("nudo/trace")({ file, functionName: "nope" });
      expect(missingTrace.isError).toBe(true);
      expect(missingTrace.content[0].text).toContain('Function "nope" not found');

      const missingSuggest = await req("nudo/suggestCase")({ file, functionName: "nope" });
      expect(missingSuggest.isError).toBe(true);
      expect(missingSuggest.content[0].text).toContain('Function "nope" not found');

      // 对照组：成功面不得带 isError
      const ok = await req("nudo/trace")({ file, functionName: "inc" });
      expect(ok.isError).toBeFalsy();
      expect(ok.content[0].text).toContain("Output:");
    });
  });
});
});

// ---------------------------------------------------------------------------
// [merged] agent-tool-file-validation
// ---------------------------------------------------------------------------
describe("agent-tool-file-validation", () => {
// MERGED (topic-related bug pins): agent-tool-file-validation + file-param-validation
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>



describe("agent-tool-file-validation", () => {
/**
 * `file` 入参零校验（**A4 的共用入口闸**：`normalizeFilePath`）。
 *
 * AGENT-CONTEXT §5 裁决：`file` 的形状校验放在 A4 的共用入口
 * （`normalizeFilePath`），A1/A2/A5 的工具都走这里 ⇒ 一处改，全覆盖。
 *
 * 改前：`file: 42` ⇒ 裸 JS TypeError（`file.startsWith is not a function`）
 * 当工具文案回给客户端；`file` 缺失 ⇒ 回落服务器 cwd（幽灵条目）。
 * 改后：非法/缺失的 `file` ⇒ 结构化工具错误（`isError: true`，文案
 * `file is required …`），异常不逃出工具。
 */



const SRC = [
  "/**",
  ' * @nudo:case "num" (1)',
  " */",
  "export function f(x) {",
  "  return x;",
  "}",
  "",
].join("\n");

describe("（共用入口）：agent 工具的 file 入参非法 ⇒ 结构化工具错误", () => {
  it("nudo/whatIf / hover / trace / suggestCase：file 非字符串/空串/缺失 ⇒ isError", async () => {
    await withLspServer({ "a4-955.js": SRC }, async ({ req, uri }) => {
      const good = uri("a4-955.js");
      const calls: Array<[string, Record<string, unknown>]> = [
        ["nudo/whatIf", { target: "x" }],
        ["nudo/hover", { line: 1, column: 0 }],
        ["nudo/trace", { functionName: "f" }],
        ["nudo/suggestCase", { functionName: "f" }],
      ];
      for (const [method, params] of calls) {
        for (const bad of [42, "", null, undefined]) {
          const result = await req(method)({ ...params, file: bad });
          expect(result, `${method} file=${JSON.stringify(bad)} 应当回错误`).toBeTruthy();
          expect(result.isError, `${method} file=${JSON.stringify(bad)} 应当 isError`).toBe(true);
          expect(result.content[0].text).toContain("file is required");
        }
        // 合法 file ⇒ 成功面（不得被共用入口误伤）
        const ok = await req(method)({ ...params, file: good });
        expect(ok.isError, `${method} 合法 file 不得是错误`).toBeFalsy();
      }
    });
  });
});
});

describe("file-param-validation", () => {
/**
 * `file` 入参零校验。
 *
 * 改前：file=42（非字符串）→ 裸 TypeError（"file.startsWith is not a
 * function"）逃出工具 ⇒ 客户端拿到 JSON-RPC **协议错误**而非 isError 工具
 * 错误；file 缺失时回落服务器 cwd（并在该 cwd 上建幽灵条目）。
 * 改后：非法/缺失的 file ⇒ 结构化工具错误（isError: true），异常不逃出。
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
`;

describe("file 入参非法时不得让异常逃出工具", () => {
  it("nudo/getActiveCases：file 非字符串 / 空串 / 缺失 ⇒ 结构化错误，不抛异常", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req }) => {
      const get = req("nudo/getActiveCases");

      for (const bad of [42, "", null, undefined]) {
        const result = await get({ file: bad });
        expect(result, `file=${JSON.stringify(bad)} 应当回错误`).toBeTruthy();
        expect(result.success).toBe(false);
        expect(result.isError).toBe(true);
        expect(result.error).toContain("file is required");
      }
    });
  }, 30_000);

  it("nudo/contract.emit：file 非字符串 ⇒ isError 工具错误，不抛异常", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req }) => {
      const emit = req("nudo/contract.emit");

      const result = await emit({ file: 42, functionName: "f", mode: "add" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("file is required");
    });
  }, 30_000);

  it("nudo/selectCase：file 非字符串 ⇒ 结构化错误，不抛异常、不建 cwd 幽灵条目", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req, uri }) => {
      const select = req("nudo/selectCase");
      const fileUri = uri("sel.js");

      const result = await select({ file: 42, functionName: "f", caseIndex: 0 });
      expect(result.success).toBe(false);
      expect(result.isError).toBe(true);
      expect(result.error).toContain("file is required");

      // file 缺失时不再回落服务器 cwd：该 uri 下没有活动档条目
      const missing = await select({ functionName: "f", caseIndex: 0 });
      expect(missing.success).toBe(false);
      const active = await req("nudo/getActiveCases")({ uri: fileUri });
      expect(active).toEqual({});
    });
  }, 30_000);
});
});
});
