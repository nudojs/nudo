/**
 * 模块套件：LSP server 面（协议/URI/workspace/trace/会话/取消/config）。
 *
 * client-capabilities 与 server-watch-err 因模块级 vi.mock 保留独立入口。
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { createMockConnection, withLspServer, type AnyHandler, makeValidateDeps, type MockConnection, withTempDir, waitForDiagnostics, waitForValue } from "./helpers.ts";
import { createNudoServer } from "../server.ts";
import { ErrorCodes, type Connection } from "vscode-languageserver/node";
import { NUDO_EXECUTE_COMMANDS, NUDO_INITIALIZE_CAPABILITIES, NUDO_AGENT_TOOL_NAMES } from "../public-api.ts";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { analyzeFileAsync, setSessionCacheLimits, resetSessionCacheLimitState } from "@nudojs/service";
import { trace, tracePositionalArgs } from "../agent-tools.ts";
import { filePathToUri } from "../server-navigation.ts";
import { cacheKey, uriToFilePath, clearValidationState, handleNudoDepFileChanged, registerNudoImportDeps, validateText, analysisCache, getCachedOrAnalyze, knownFiles, nudoDepParents, validateGeneration, bumpValidateGeneration, type ValidateTextDeps } from "../validation.ts";

// ---------------------------------------------------------------------------
// 畸形 URI 不得让 initialize 整个失败
// ---------------------------------------------------------------------------
describe("畸形 URI 不得让 initialize 整个失败", () => {
/**
 * 畸形 workspace URI 让**整个 initialize 抛出去**。
 *
 * 症状：客户端送来一个百分号转义非法的 URI（如 `file:///tmp/proj%zz`）⇒
 * `uriToFilePath` 里的裸 `decodeURIComponent` 抛 `URIError` ⇒ initialize
 * 整个失败 ⇒ 客户端拿不到 capabilities ⇒ **整个语言服务器会话起不来**
 * （一个坏根目录毁掉全部功能）。
 *
 * 根因（片 D · `server.ts`）：`onInitialize` 对每个 workspace folder 的
 * `uriToFilePath` **没有兜底**。
 *
 * 修法：逐个 folder 兜底——畸形 URI **跳过该 folder** + 记一条可读告警，
 * 其余 folder 与 `rootUri` 照常处理 ⇒ initialize 正常返回 capabilities。
 *
 * 钉：① 畸形 workspaceFolders[0].uri ⇒ initialize 不抛、返回 capabilities；
 * ② 畸形 rootUri ⇒ 同上；③ 正常 URI 不受影响。
 */




function initWith(params: Record<string, unknown>): { capabilities?: Record<string, unknown> } {
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  const init = mock.requests.get("initialize")!;
  return init({ processId: null, capabilities: {}, ...params }) as {
    capabilities?: Record<string, unknown>;
  };
}


  it("畸形 workspaceFolders[0].uri ⇒ 跳过该 folder，initialize 照常返回；畸形 rootUri ⇒ 跳过该根，initialize 照常返回；正常 URI 不受影响（仍返回 capabilities）", () => {
  {
    const res = initWith({
      rootUri: null,
      workspaceFolders: [{ uri: "file:///tmp/proj%zz", name: "x" }],
    });
    expect(res.capabilities).toBeDefined();
    expect(Object.keys(res.capabilities ?? {}).length).toBeGreaterThan(0);
  }
  {
    const res = initWith({ rootUri: "file:///tmp/a%2", workspaceFolders: null });
    expect(res.capabilities).toBeDefined();
    expect(Object.keys(res.capabilities ?? {}).length).toBeGreaterThan(0);
  }
  {
    const res = initWith({
      rootUri: "file:///tmp/nudo-784-ok",
      workspaceFolders: [{ uri: "file:///tmp/nudo-784-ok", name: "ok" }],
    });
    expect(res.capabilities).toBeDefined();
  }
});



});

// ---------------------------------------------------------------------------
// 未声明的命令名必须回协议层错误（MethodNotFound）
// ---------------------------------------------------------------------------
describe("未声明的命令名必须回协议层错误（MethodNotFound）", () => {
/**
 * 未声明的命令名在 `workspace/executeCommand` 上回 result:null。
 *
 * 改前：未知命令 → JSON-RPC **成功** + null 结果——协议层假成功（与「命令
 * 跑了但无输出」同形），客户端无法区分「无此命令」与「跑了但没结果」。
 * 改后：走协议层错误 MethodNotFound（-32601）。
 * 命令白名单复用 advertise 面的 NUDO_EXECUTE_COMMANDS（不新增命令名）。
 *
 * 用例超时给到 30s：withLspServer 的首次动态 import（server.ts 依赖图）在
 * 并行负载下要数秒，5s 默认值会偶发踩线。
 */





const SRC = `export function f(x) {
  return x;
}
`;


  it("未知命令名不再回落 result:null；已声明的命令名照常执行（白名单 = advertise 面）", async () => {
  {
    await withLspServer({ "sel.js": SRC }, async ({ req }) => {
      const exec = req("workspace/executeCommand");

      for (const command of ["nudo.notARealCommand", "totally.unknown", ""]) {
        await expect(async () =>
          exec({ command, arguments: [{ file: "sel.js" }] }),
        ).rejects.toMatchObject({ code: ErrorCodes.MethodNotFound });
      }
    });
  }
  {
    await withLspServer({ "sel.js": SRC }, async ({ req, dir }) => {
      const exec = req("workspace/executeCommand");

      expect(NUDO_EXECUTE_COMMANDS).toContain("nudo.getActiveCases");
      const result = await exec({
        command: "nudo.getActiveCases",
        arguments: [{ file: `${dir}/sel.js` }],
      });
      expect(result).toEqual({});
    });
  }
});


});

// ---------------------------------------------------------------------------
// workspace/didChangeWorkspaceFolders 必须更新根集合
// ---------------------------------------------------------------------------
describe("workspace/didChangeWorkspaceFolders 必须更新根集合", () => {
/**
 * 工作区文件夹增删不生效（`workspaceRoots` 永久冻结）。
 *
 * 症状：多根工作区里，客户端新增/移除一个工作区文件夹后，server 仍按
 * `initialize` 时的老根集合行事 ⇒ 新加入的目录被写盘边界误拒
 * （"outside allowed roots"），已移出的目录**仍被授权**。
 *
 * 根因（片 D · `server.ts`）：`workspaceRoots` 的三个写入点**全在**
 * `onInitialize` 里 ⇒ 之后永不更新；server 也**从不订阅**
 * `workspace/didChangeWorkspaceFolders`。且 `onInitialize` 的 capabilities
 * 里没有 `workspace.workspaceFolders.changeNotifications` ⇒ 客户端
 * （vscode-languageclient 的 `WorkspaceFoldersFeature`）**根本不会发**这条
 * 通知 ⇒ 光订阅没用。
 *
 * 修法：
 * - capabilities 声明 `workspace.workspaceFolders.changeNotifications`；
 * - 订阅 `connection.workspace.onDidChangeWorkspaceFolders` ⇒ 增删根；
 * - 根集合变了 ⇒ 清 `nudoFileCache` + 重检已打开文档 + 广播
 * `workspace/diagnostic/refresh`。
 *
 * 钉：① capabilities 声明了 changeNotifications；② 新增根后该目录被放行；
 * ③ 移除根后该目录被拒。
 */







const SRC = "export function f() {\n  return 1;\n}\n";


  it("声明 changeNotifications + 增删根即时生效（写盘边界跟着走）", async () => {
    const base = mkdtempSync(join(tmpdir(), "nudo-bug783-"));
    try {
      const a = join(base, "a");
      const b = join(base, "b");
      mkdirSync(a, { recursive: true });
      mkdirSync(b, { recursive: true });
      writeFileSync(join(a, "x.js"), SRC, "utf-8");
      writeFileSync(join(b, "y.js"), SRC, "utf-8");

      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      const init = mock.requests.get("initialize")!;
      const res = init({
        processId: null,
        rootUri: `file://${a}`,
        workspaceFolders: [{ uri: `file://${a}`, name: "a" }],
        capabilities: {},
      }) as { capabilities?: { workspace?: unknown } };
      // 客户端只在 server 声明 changeNotifications 时才发该通知
      expect(res.capabilities?.workspace).toMatchObject({
        workspaceFolders: { changeNotifications: true },
      });

      const exec = mock.requests.get("workspace/executeCommand")!;
      const emitText = async (target: string): Promise<string> => {
        const r = (await exec({
          command: "nudo.contract.emit",
          arguments: [{ file: target, functionName: "f", mode: "add" }],
        })) as { content?: { text?: string }[] };
        return r.content?.[0]?.text ?? "";
      };

      // 初始：只有 a 在根集合里 ⇒ b 被拒
      expect(await emitText(join(b, "y.js"))).toContain("outside allowed roots");

      // 客户端新增 b ⇒ 立刻放行
      mock.fireWorkspaceFoldersChanged({ added: [{ uri: `file://${b}`, name: "b" }] });
      expect(await emitText(join(b, "y.js"))).not.toContain("outside allowed roots");

      // 客户端移除 a ⇒ a 立刻被拒（不再保留过期授权）
      mock.fireWorkspaceFoldersChanged({ removed: [{ uri: `file://${a}`, name: "a" }] });
      expect(await emitText(join(a, "x.js"))).toContain("outside allowed roots");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }, 30_000);

});

// ---------------------------------------------------------------------------
// 族 24 Z —— workspaceFolders 的 getter 抛异常不得让 server 崩
// ---------------------------------------------------------------------------
describe("Z —— workspaceFolders 的 getter 抛异常不得让 server 崩", () => {
/**
 * 族 24 收口片 Z —— `connection.workspace.onDidChangeWorkspaceFolders`
 * 是**会抛异常的 getter** ⇒ server 不得因此崩。
 *
 * 根因（`vscode-languageserver@10.1.2`）：
 * `lib/common/workspaceFolder.js:38` 的 getter 在客户端**没声明**
 * `capabilities.workspace.workspaceFolders` 时直接
 * `throw new Error("Client doesn't support sending workspace folder change events.")`
 * ⇒ `?.` **挡不住**（`?.` 只挡 `null` / `undefined`，不挡抛异常）。
 * 且该 getter 只在 `initialize` **之后**、且客户端**声明了**该能力时**才就绪**
 * （`lib/common/server.js:733` 的 `remote.initialize(capabilities)` 跑在用户的
 * `onInitialize` 处理器**之前**）⇒ **构造期**取它**必然抛**（真 transport 实证：
 * server 启动即崩，栈：`get onDidChangeWorkspaceFolders … → createNudoServer`）。
 *
 * 修法（`server.ts`）：取值包在 `try` 里；抛了 ⇒ **静默跳过订阅**（server 照常
 * 启动）；并在 `initialize` 之后**再取一次**（真 transport 下 getter 此时才就绪）
 * ⇒ 的功能面（工作区文件夹变更 ⇒ 授权边界重算）**不被防御打死**。
 *
 * 钉：
 * ① 客户端**不声明** `capabilities.workspace.workspaceFolders` ⇒
 * `createNudoServer` **不抛**；
 * ② 该客户端的 `onInitialize` **仍正常返回**（服务端能力声明一字不动）；
 * ③ 真语义（getter 在 `initialize` 之前抛、之后可用）⇒ 订阅**仍建立**
 * 且**只建立一次**（构造期那次抛了，不算）。
 */




/** 真 `WorkspaceFoldersFeature` 的报错原文。 */
const THROW_MSG = "Client doesn't support sending workspace folder change events.";

/**
 * 模拟真 `WorkspaceFoldersFeature` 的 getter：**始终**抛
 * ⇒ 等价于「客户端没声明 `capabilities.workspace.workspaceFolders`」。
 */
function mockClientWithoutWorkspaceFolders(): ReturnType<typeof createMockConnection> {
  const mock = createMockConnection();
  Object.defineProperty(mock.workspace, "onDidChangeWorkspaceFolders", {
    configurable: true,
    get() {
      throw new Error(THROW_MSG);
    },
  });
  return mock;
}

/**
 * 模拟真 `WorkspaceFoldersFeature` 的**时序**：`initialize` 之前取 getter 会抛，
 * `initialize` 之后（客户端声明了能力）才可用。
 */
function mockClientWithDelayedWorkspaceFolders(): {
  mock: ReturnType<typeof createMockConnection>;
  listeners: AnyHandler[];
  /** 真 transport：`remote.initialize(capabilities)` 跑在用户的 `onInitialize` **之前**。 */
  markInitialized: () => void;
} {
  const mock = createMockConnection();
  const listeners: AnyHandler[] = [];
  let initialized = false;
  Object.defineProperty(mock.workspace, "onDidChangeWorkspaceFolders", {
    configurable: true,
    get() {
      if (!initialized) throw new Error(THROW_MSG);
      return (h: AnyHandler) => {
        listeners.push(h);
        return { dispose: () => {} };
      };
    },
  });
  return {
    mock,
    listeners,
    markInitialized: () => {
      initialized = true;
    },
  };
}


  it("① 客户端不声明 workspaceFolders 能力 ⇒ createNudoServer 不抛异常；② 该客户端的 onInitialize 仍正常返回（服务端能力声明一字不动）；③ 真语义（getter 在 initialize 之后才可用）⇒ 订阅仍建立且只建立一次", async () => {
  {
    const mock = mockClientWithoutWorkspaceFolders();
    expect(() => createNudoServer(mock as unknown as never)).not.toThrow();
  }
  {
    const mock = mockClientWithoutWorkspaceFolders();
    createNudoServer(mock as unknown as never);
    const init = mock.requests.get("initialize")!;
    // 客户端**没声明** capabilities.workspace.workspaceFolders
    const res = init({
      processId: null,
      rootUri: null,
      capabilities: {},
    }) as { capabilities?: { workspace?: unknown } };
    expect(res.capabilities?.workspace).toMatchObject({
      workspaceFolders: { supported: true, changeNotifications: true },
    });
  }
  {
    const { mock, listeners, markInitialized } = mockClientWithDelayedWorkspaceFolders();
    // 构造期：getter 抛 ⇒ 静默跳过（不崩），不订阅
    expect(() => createNudoServer(mock as unknown as never)).not.toThrow();
    expect(listeners.length, "构造期不该订阅成功").toBe(0);

    // 真 transport 的顺序：`remote.initialize(capabilities)` 先于用户的
    // `onInitialize` 处理器 ⇒ 处理器里再取 getter 时它已就绪。
    markInitialized();
    const init = mock.requests.get("initialize")!;
    init({
      processId: null,
      rootUri: null,
      capabilities: { workspace: { workspaceFolders: true } },
    });
    // 补订阅排在 `initialize` 之后的下一轮事件循环（落在库自己的
    // `fillServerCapabilities` 之后 ⇒ 不多发 `client/registerCapability`）。
    await waitForValue(() => listeners.length, (n) => n >= 1, { timeout: 100 });
    // initialize 之后：getter 可用 ⇒ 订阅补上（且不重复订阅）
    expect(listeners.length, "initialize 之后未建立订阅").toBe(1);

    // 订阅到的处理器可被调用（发通知不会把 server 掀翻）
    expect(() => listeners[0]({ added: [], removed: [] })).not.toThrow();
  }
});



});

// ---------------------------------------------------------------------------
// 跨模块 call@ 镜的 nudo.trace 动作必须可执行
// ---------------------------------------------------------------------------
describe("跨模块 call@ 镜的 nudo.trace 动作必须可执行", () => {
/**
 * 跨模块 `call@` 观察镜的 `nudo.trace` 动作 **100% 不可执行**。
 *
 * 症状（真 server 协议面）：`lib.js` 导出 `add`，`main.js` 里
 * `import { add } from "./lib.js"` 后调用 `add(x, 2)` ⇒ 调用方文件的 CodeLens
 * 出现跨模块 `call@L3 (any, 2) => number | string`，但点它（命令
 * `nudo.trace [uri(main.js), "add"]`）回 `Function "add" not found` ——
 * 镜面标题说有这个事实，动作却说没有。
 *
 * 根因：`trace()` 只在 `result.functions`（**本文件**的本地函数）里找，
 * 被导入函数的调用点事实在 `result.externalFunctions` 里 ⇒ 必然落空。
 *
 * 修法：`result.functions` 未命中时回落到 `result.externalFunctions`
 * （本文件同名本地函数优先）。
 *
 * 钉：
 * 1. agent 工具直调（跨模块）⇒ 出跨模块见证，不是 `not found`；
 * 2. 真 server `workspace/executeCommand nudo.trace [uri, fn]`（观察镜的动作
 * 形态，位置参数）⇒ 同上；
 * 3. 同文件 `call@` 对照（一直在工作的那条路径）不回归。
 */









const LIB_SRC = `export function add(a, b) {
  return a + b;
}
`;

const MAIN_SRC = `import { add } from "./lib.js";

export function run(x) {
  return add(x, 2);
}
`;

const SAME_FILE_SRC = `export function add(a, b) {
  return a + b;
}

export function run(x) {
  return add(x, 2);
}
`;

/** 跨模块见证的本体（与 CodeLens 标题同一 ArgAbs/结果 Abs） */
const CROSS_WITNESS = "Input: (any, 2) => Output: number | string";

function textOf(res: { content: ReadonlyArray<{ text: string }> }): string {
  return res.content.map((c) => c.text).join("\n");
}

function withProject(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug146-"));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text, "utf-8");
  }
  return fn(dir).finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
}


  it("trace({file, functionName}) 回落到 externalFunctions：出跨模块见证；真 server executeCommand `nudo.trace [uri, fn]`（观察镜动作形态）不报 not found；同文件 call@ 对照：trace 仍按本地函数解析（不回归）", async () => {
  {
    await withProject({ "lib.js": LIB_SRC, "main.js": MAIN_SRC }, async (dir) => {
      // 前置：`add` **不在**本文件函数表里（否则这条用例测不到回落）
      const analysis = await analyzeFileAsync(
        join(dir, "main.js"),
        MAIN_SRC,
        undefined,
        undefined,
        undefined,
        "all",
      );
      expect(analysis.functions.map((f) => f.name)).not.toContain("add");
      expect((analysis.externalFunctions ?? []).map((f) => f.name)).toContain("add");

      const res = await trace({
        file: join(dir, "main.js"),
        functionName: "add",
      });
      const text = textOf(res);
      // 改前：isError + `Function "add" not found`
      expect(res.isError, `跨模块 trace 失败：${text}`).toBeFalsy();
      expect(text).not.toContain("not found");
      expect(text).toContain(CROSS_WITNESS);
    });
  }
  {
    const mock = createMockConnection();
    createNudoServer(mock as unknown as never);
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug146-srv-"));
    try {
      writeFileSync(join(dir, "lib.js"), LIB_SRC, "utf-8");
      writeFileSync(join(dir, "main.js"), MAIN_SRC, "utf-8");
      const uri = `file://${join(dir, "main.js")}`;
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: {
          uri,
          languageId: "javascript",
          version: 1,
          text: MAIN_SRC,
        },
      });
      await waitForDiagnostics(mock, uri);

      const res = (await mock.requests.get("workspace/executeCommand")!({
        command: "nudo.trace",
        arguments: [uri, "add"],
      })) as { isError?: boolean; content?: { text: string }[] };

      const text = (res.content ?? []).map((c) => c.text).join("\n");
      expect(res.isError, `executeCommand 失败：${text}`).toBeFalsy();
      expect(text).not.toContain("not found");
      expect(text).toContain(CROSS_WITNESS);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    await withProject({ "same.js": SAME_FILE_SRC }, async (dir) => {
      const res = await trace({
        file: join(dir, "same.js"),
        functionName: "add",
      });
      const text = textOf(res);
      expect(res.isError, `同文件 trace 失败：${text}`).toBeFalsy();
      expect(text).toContain(CROSS_WITNESS);
    });
  }
});



});

// ---------------------------------------------------------------------------
// [merged] trace-positional-bridge
// ---------------------------------------------------------------------------
describe("trace-positional-bridge", () => {
// MERGED (topic-related bug pins): trace-positional-bridge + trace-uri-bridge
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>









{
/**
 * `nudo.trace` 的**位置参数**形态没有命令桥。
 *
 * 症状：IDE 的 `entry@` / `call@` 观察透镜用位置参数发命令
 * （`executeCommand "nudo.trace" [uri, functionName]`）⇒ 服务端兜底分支把
 * uri **字符串**当参数对象传下去 ⇒ `params.file` 是 `undefined` ⇒ 工具
 * 100% 失败（每次点击观察透镜只得到一个错误）。
 *
 * 根因（片 D · `server.ts`）：`nudo.contract*` 有位置参数桥
 * （`contractPositionalArgs` / `contractEmitPositionalArgs`），`nudo.trace`
 * 没有；兜底分支也没有「参数不是对象 ⇒ 报参数形态错误」的闸。
 *
 * 修法：
 * - `nudo.trace` 补上同款位置参数桥（复用 agent 侧
 * `tracePositionalArgs`：`[uri, fn]` → `{ uri, functionName }`）；
 * - 兜底分支：参数不是对象 ⇒ 抛**协议层参数错误**（InvalidParams），
 * 不再把字符串当对象传下去。
 *
 * 钉：① `[uri, fn]` 位置形态跑出 trace；② 对象形态不受影响；
 * ③ 非对象参数（裸字符串）⇒ 协议层 InvalidParams（而不是工具内部错误）。
 */








const SRC = `/**
 * @nudo:case 1
 */
export function run() {
  return 1;
}
`;

describe("nudo.trace 必须支持位置参数 [uri, functionName]", () => {
  it("位置参数 [uri, fn] 跑出 trace（不是错误）；对象形态 { uri, functionName } 仍然可用（桥不得吃掉既有形态）；非对象参数（裸字符串）⇒ 协议层 InvalidParams（不再把字符串当对象传下去）", async () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug780-"));
    try {
      const file = join(dir, "app.js");
      writeFileSync(file, SRC, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      const exec = mock.requests.get("workspace/executeCommand")!;
      const result = await exec({
        command: "nudo.trace",
        arguments: [uri, "run"],
      }) as { isError?: boolean; content?: { text?: string }[] };
      expect(result.isError).toBeFalsy();
      expect(result.content?.[0]?.text ?? "").toContain("Output:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug780-"));
    try {
      const file = join(dir, "app.js");
      writeFileSync(file, SRC, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      const exec = mock.requests.get("workspace/executeCommand")!;
      const result = await exec({
        command: "nudo.trace",
        arguments: [{ uri, functionName: "run" }],
      }) as { isError?: boolean; content?: { text?: string }[] };
      expect(result.isError).toBeFalsy();
      expect(result.content?.[0]?.text ?? "").toContain("Output:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug780-"));
    try {
      const file = join(dir, "app.js");
      writeFileSync(file, SRC, "utf-8");
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      const exec = mock.requests.get("workspace/executeCommand")!;
      await expect(async () =>
        exec({ command: "nudo.trace", arguments: [`file://${file}`] }),
      ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});


});
}

describe("trace-uri-bridge", () => {
/**
 * IDE 的 `entry@` / `call@` 观察透镜**必然抛 TypeError**：
 * `nudo.trace` 既没有「位置参数 → 对象」的桥，也不接受 `uri` 键 ⇒
 * `params.file` 是 `undefined` ⇒ `normalizeFilePath(undefined)` 抛。
 *
 * 根因（两半）：
 * - server 侧：`workspace/executeCommand` 的兜底分支把 `args[0]`（**uri
 * 字符串**）当参数对象传下去 ⇒ `params.file === undefined`
 * （server.ts 归片 D；本片交付 agent 侧的桥 `tracePositionalArgs`）；
 * - agent 侧（本片）：`trace` 工具只读 `params.file` ⇒ 连 IDE 自产的
 * `file://…` uri 形态也走不通。
 *
 * 修法（片 F，agent 侧）：
 * - `FunctionToolParams` 增 `uri` 键（`file` 与 `uri` 二选一）；
 * - `trace` / `suggestCase` 经 `resolveToolFile` 定位文件（缺省时抛共用
 * 入口闸的 TypeError，不让裸 TypeError 当工具文案）；
 * - 导出 `tracePositionalArgs`（位置参数桥，供片 D 接进命令桥）。
 *
 * 钉：`nudo/trace` 的 `{uri}` 形态成功出见证；`{file}` 形态不回归；
 * 位置参数桥的形状（合法 ⇒ `{uri, functionName}`；不合法 ⇒ undefined）。
 */








/** 带显式 case 的导出函数 ⇒ 观察透镜有见证可打印 */
const SRC = `/**
 * @nudo:case "one" (1) => 2
 */
export function run(x) {
  return x + 1;
}
`;

function openSession(): {
  mock: ReturnType<typeof createMockConnection>;
  file: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug780-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "bug780-trace", private: true, type: "module" }),
    "utf-8",
  );
  const file = join(dir, "app.js");
  writeFileSync(file, SRC, "utf-8");
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri: `file://${file}`, languageId: "javascript", version: 1, text: SRC },
  });
  return {
    mock,
    file,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function textOf(res: any): string {
  const c = res?.content;
  if (Array.isArray(c)) return c.map((x: any) => x.text).join("\n");
  return String(res ?? "");
}

describe("nudo.trace 必须接受 uri 键并有位置参数桥", () => {
  it("nudo/trace 的 {uri} 形态：出见证（不再 TypeError）；nudo/trace 的 {file} 形态：不回归；agent 侧：trace 工具直调也接受 uri 键；位置参数桥 tracePositionalArgs：[uri, fn] ⇒ { uri, functionName }", async () => {
  {
    const { mock, file, cleanup } = openSession();
    try {
      const res: any = await mock.requests.get("nudo/trace")!({
        uri: `file://${file}`,
        functionName: "run",
      });
      expect(res?.isError, `uri 形态仍失败：${textOf(res)}`).toBeFalsy();
      expect(textOf(res)).toContain("Input:");
    } finally {
      cleanup();
    }
  }
  {
    const { mock, file, cleanup } = openSession();
    try {
      const res: any = await mock.requests.get("nudo/trace")!({
        file,
        functionName: "run",
      });
      expect(res?.isError, `file 形态失败：${textOf(res)}`).toBeFalsy();
      expect(textOf(res)).toContain("Input:");
    } finally {
      cleanup();
    }
  }
  {
    const { file, cleanup } = openSession();
    try {
      const res = await trace({ uri: `file://${file}`, functionName: "run" });
      expect(res.isError, `trace(uri) 失败：${res.content[0]!.text}`).toBeFalsy();
      expect(res.content[0]!.text).toContain("Input:");
    } finally {
      cleanup();
    }
  }
  {
    expect(tracePositionalArgs(["file:///tmp/a.js", "run"])).toEqual({
      uri: "file:///tmp/a.js",
      functionName: "run",
    });
    // 形态不合法 ⇒ undefined（由调用方报协议层参数形态错误）
    expect(tracePositionalArgs(["file:///tmp/a.js"])).toBeUndefined();
    expect(tracePositionalArgs([123, "run"])).toBeUndefined();
  }
});



});
});
});

// ---------------------------------------------------------------------------
// URI 编解码互逆（编码侧 pathToFileURL / 解码侧 fileURLToPath）
// ---------------------------------------------------------------------------
describe("URI 编解码互逆（编码侧 pathToFileURL / 解码侧 fileURLToPath）", () => {
/**
 * `filePathToUri` / `uriToFilePath` **不互逆** ⇒ 服务端自产的
 * `location.uri` 是**非法 URI**（裸 `%`）⇒ 客户端回传后
 * `didOpen` / `didChange` / `didClose` 抛未捕获 `URIError`
 * ⇒ 该文档**零诊断**（L2 假绿）。
 *
 * 根因：编码侧 `filePathToUri`（`server-navigation.ts`）**裸拼** `file://` + 路径
 * （路径里的 `%` / `#` / `?` / 空格**不转义**）；解码侧 `uriToFilePath`
 * （`validation.ts`）**裸 `decodeURIComponent`** ⇒ 畸形百分号转义抛 `URIError`。
 *
 * 修法：编码侧改用 Node 内置 **`pathToFileURL(filePath).href`**（零新增导出、
 * 跨平台、天生与 `fileURLToPath` 互逆）；解码侧改用 **`fileURLToPath` +
 * `try/catch` 兜底**（畸形 ⇒ 回退到未解码原文，**绝不抛**）。
 * ⇒ `cacheKey` 自动受益。
 *
 * ⚠ **非 `file:` scheme**（`untitled:` 等）**原样返回**（行为不变）。
 * ⚠ **Windows 盘符**必须一并验证：`fileURLToPath` 给 `C:\...`，
 * 旧实现 `slice(7)` 会留 `/C:/...` ⇒ 本钉用 `cacheKey` 断言（跨平台同形）。
 */










  it("编码侧对保留字符做百分号转义（裸 % 不再出现）；普通路径的 URI 形态不变（file:/// 绝对路径）；解码侧：合法 URI 解回原路径（与编码侧互逆）；解码侧：畸形百分号转义**绝不抛**（回退到未解码原文）；解码侧：非 file: scheme 原样返回（行为不变）；Windows 盘符形态经 cacheKey 归一（file:///c:/… ⇒ c:/…）；协议面：客户端把服务端自己刚给的（裸 % 的）URI 回传给 didOpen ⇒ 不中断且该文档有诊断", async () => {
  {
    expect(filePathToUri("/x/100%.js")).toBe("file:///x/100%25.js");
    expect(filePathToUri("/x/a#b.js")).toBe("file:///x/a%23b.js");
    expect(filePathToUri("/x/a?b.js")).toBe("file:///x/a%3Fb.js");
    expect(filePathToUri("/x/a b.js")).toBe("file:///x/a%20b.js");
    expect(filePathToUri("/x/中文.js")).toBe("file:///x/%E4%B8%AD%E6%96%87.js");
  }
  {
    expect(filePathToUri("/tmp/a.js")).toBe("file:///tmp/a.js");
    expect(filePathToUri("file:///already/a.js")).toBe("file:///already/a.js");
  }
  {
    for (const p of ["/x/100%.js", "/x/a#b.js", "/x/a?b.js", "/x/a b.js", "/x/中文.js", "/tmp/a.js"]) {
      expect(uriToFilePath(filePathToUri(p)), `round-trip 失败：${p}`).toBe(p);
    }
  }
  {
    let out: string | undefined;
    expect(() => {
      out = uriToFilePath("file:///x/100%.js");
    }, "畸形 URI 抛了（didOpen/didChange/didClose 会中断 ⇒ 该文档零诊断）").not.toThrow();
    expect(typeof out).toBe("string");
    let out2: string | undefined;
    expect(() => {
      out2 = uriToFilePath("file:///x/%zz.js");
    }, "畸形 URI 抛了").not.toThrow();
    expect(typeof out2).toBe("string");
  }
  {
    expect(uriToFilePath("untitled:Untitled-1")).toBe("untitled:Untitled-1");
    expect(uriToFilePath("/plain/path.js")).toBe("/plain/path.js");
  }
  {
    expect(cacheKey("file:///c:/my%20dir/a.js")).toBe("c:/my dir/a.js");
    expect(cacheKey("file:///c:/proj/a.js")).toBe(cacheKey("c:/proj/a.js"));
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-748-"));
    try {
      // 服务端**旧实现**自产的 URI 形态：裸 `%`（非法 URI）
      const src = "export function f() { return unknownGlobal(); }\n";
      writeFileSync(join(dir, "100%.js"), src, "utf-8");
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      const uri = `file://${join(dir, "100%.js")}`;
      let thrown: unknown;
      try {
        mock.notifications.get("textDocument/didOpen")!({
          textDocument: { uri, languageId: "javascript", version: 1, text: src },
        });
      } catch (e) {
        thrown = e;
      }
      expect(thrown, "didOpen 抛了 ⇒ 该通知中断 ⇒ 该文档零诊断").toBeUndefined();
      await waitForDiagnostics(mock, uri);
      const published = mock.sentDiagnostics.filter((d) => d.uri === uri);
      expect(published.length, "该文档从未进入分析 ⇒ 零诊断").toBeGreaterThan(0);
      const last = published[published.length - 1];
      expect((last.diagnostics ?? []).length, "该文档零诊断").toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});







});

// ---------------------------------------------------------------------------
// [merged] didopen-dup-publish
// ---------------------------------------------------------------------------
describe("didopen-dup-publish", () => {
// MERGED (topic-related bug pins): didopen-dup-publish + validation-self-exclusion
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>








{
/**
 * `didOpen` 重复发布 `publishDiagnostics`。
 *
 * 症状：打开一个文件后，同一版本、同一内容的诊断被**发布两次**。
 * 根因：`vscode-languageserver` 的 `TextDocuments.listen()` 在 `didOpen` 时
 * **同时** fire `onDidOpen` 与 `onDidChangeContent`
 * （`vscode-languageserver/lib/common/textDocuments.js`）⇒ server 的
 * 「打开即验证」路径与「编辑防抖」路径对**同一内容**各跑一遍完整校验，
 * 各 publish 一次。
 *
 * 修法（片 D · `server.ts`）：
 * - `documents.onDidOpen` 记录文档指纹（version + 内容）；
 * - `documents.onDidChangeContent` 发现指纹相同 ⇒ 认定是 didOpen 回声 ⇒
 * 不再排一次防抖校验；
 * - publish 面加**内容去重**（同 uri + 同 version + 同诊断内容 ⇒ 只发一次），
 * 同版本但诊断内容变了（侧车/依赖变更后的 force 重检）仍照发。
 *
 * 钉：打开一个会出诊断的文件 ⇒ 只发布 1 次；打开一个不出诊断的文件 ⇒
 * 也只发布 1 次（空数组），不得出现「同一版本同内容发两次」。
 */







const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("didOpen 不得重复发布同一版本的诊断", () => {
  it("会出诊断的文件：didOpen 只发布一次（同 version 同内容）；不出诊断的文件：didOpen 也只发布一次（空数组）；编辑后仍会发布新版本的诊断（去重不得把后续诊断吞掉）", async () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug776-"));
    try {
      const src = "export function boom() {\n  throw new Error('x');\n}\n";
      const file = join(dir, "boom.js");
      writeFileSync(file, src, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: src },
      });
      await sleep(900);
      const published = mock.sentDiagnostics.filter((d) => d.uri === uri);
      expect(published).toHaveLength(1);
      expect(published[0]?.version).toBe(1);
      expect((published[0]?.diagnostics ?? []).map((d: { code?: string }) => d.code)).toContain(
        "nudo:entry-may-throw",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug776-"));
    try {
      const src = "export const a = 1;\n";
      const file = join(dir, "plain.js");
      writeFileSync(file, src, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: src },
      });
      await sleep(900);
      const published = mock.sentDiagnostics.filter((d) => d.uri === uri);
      expect(published).toHaveLength(1);
      expect(published[0]?.diagnostics).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug776-"));
    try {
      const src = "export function boom() {\n  throw new Error('x');\n}\n";
      const file = join(dir, "boom.js");
      writeFileSync(file, src, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: src },
      });
      await sleep(900);
      mock.notifications.get("textDocument/didChange")!({
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: src + "\nexport const b = 2;\n" }],
      });
      await sleep(900);
      const versions = mock.sentDiagnostics
        .filter((d) => d.uri === uri)
        .map((d) => d.version);
      expect(versions).toContain(1);
      expect(versions).toContain(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});


});
}

describe("validation-self-exclusion", () => {
/**
 * （validation.ts 半）—— 依赖文件变更的 **self-排除**。
 *
 * `handleNudoDepFileChanged` 把 `computeDirtySet(...)` 的返回值（含**种子**
 * 本身）整个塞进 `parentSet` ⇒ 变更文件被当成**自己的** parent ⇒ 触发对
 * 自己的 force 重检 ⇒ 自激重检（改一个文件把自己又重检一遍）。
 *
 * 修法（片 E 落，片 D 消费）：`parentSet` 排除变更文件自身
 * （`nudoDepParents` 边与 module graph 脏集两处都排除）。
 *
 * 钉：变更文件自己 ⇒ **不**重检自己（publish 次数不增加）；
 * 而**真正的** parent（@nudo:import 依赖方）仍被重检（不得误伤）。
 */







const norm = (p: string) => resolve(p).replace(/\\/g, "/");

describe("（validation 半）—— 依赖文件变更的 self-排除", () => {
  beforeEach(() => {
    clearValidationState();
  });

  it("变更文件自己 ⇒ 不重检自己（无自激重检）；真正的 parent（@nudo:import 依赖方）仍被重检（self-排除不得误伤）", async () => {
  {
    clearValidationState();


    const dir = mkdtempSync(join(tmpdir(), "nudo-bug776e-"));
    try {
      const file = join(dir, "self.js");
      const src = `export function s(x) { return x; }\n`;
      writeFileSync(file, src, "utf-8");
      let published = 0;
      const deps = makeValidateDeps({
        docs: [[norm(file), { uri: `file://${file}`, version: 2, getText: () => src }]],
        lookupKey: norm,
        onPublish: () => {
          published++;
        },
      });
      // 初验：登记 knownFiles（module graph 需要）
      await validateText(file, `file://${file}`, src, 2, deps, false);
      const afterInitial = published;
      expect(afterInitial).toBeGreaterThan(0);

      // 变更文件自己 ⇒ 不得再触发一次对自己的重检
      await handleNudoDepFileChanged(file, deps);
      expect(published).toBe(afterInitial);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    clearValidationState();


    const dir = mkdtempSync(join(tmpdir(), "nudo-bug776f-"));
    try {
      const parent = join(dir, "a.js");
      const dep = join(dir, "shapes.nudo.js");
      writeFileSync(dep, "export const positive = number().gt(0);\n");
      const parentSrc = `/// @nudo:import { positive } from "./shapes.nudo.js"
export function needsPositive(x) {
  return x;
}
`;
      writeFileSync(parent, parentSrc);
      registerNudoImportDeps(parent, parentSrc);

      let published = 0;
      const deps = makeValidateDeps({
        docs: [[norm(parent), { uri: `file://${parent}`, version: 2, getText: () => parentSrc }]],
        lookupKey: norm,
        onPublish: () => {
          published++;
        },
      });
      await handleNudoDepFileChanged(dep, deps);
      expect(published).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

});
});
});

// ---------------------------------------------------------------------------
// createNudoServer — initialize
// ---------------------------------------------------------------------------
describe("createNudoServer — initialize", () => {
/**
 * JSON-RPC-ish protocol tests for createNudoServer (importable without
 * starting a transport). Uses an in-memory mock Connection that records
 * request handlers — not the real stdio/node-ipc transport.
 *
 * Covered: initialize capabilities inventory, workspace/executeCommand and
 * custom-request dispatch (slash + dot forms), and fail-closed error paths.
 */









type Mock = MockConnection;

function startServer(): Mock {
  const mock = createMockConnection();
  const handle = createNudoServer(mock as unknown as Connection);
  // transport must not start on construction
  expect(mock.listened).toBe(false);
  void handle;
  return mock;
}

function handler(mock: Mock, method: string): AnyHandler {
  const h = mock.requests.get(method);
  expect(h, `handler "${method}" not registered`).toBeTruthy();
  return h!;
}

// （wave 3）：`x + y`（any 形参算术）原生 may TypeError → 不再是 clean
// 样本；本组用例意图是「clean 文件 → ok / 空诊断发布」，改用恒总 identity。
const CHECK_OK = `
export function id(x) {
  return x;
}
`;

const CHECK_FAIL = `
/**
 * @nudo:contract x: number() > 0
 */
function needsPositive(x) {
  return x;
}
needsPositive(-1);
`;

let dir: string;
let okFile: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-lsp-proto-"));
  okFile = join(dir, "add.js");
  writeFileSync(okFile, CHECK_OK, "utf-8");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});


  it("declares the full capability inventory and command list；registers slash- and dot-form request aliases for every agent tool", async () => {
  {
    const mock = startServer();
    const result = await handler(mock, "initialize")({
      processId: null,
      rootUri: null,
      workspaceFolders: [{ uri: "file:///tmp/nudo-proto-ws", name: "ws" }],
      capabilities: {},
    });
    for (const key of NUDO_INITIALIZE_CAPABILITIES) {
      expect(result.capabilities, `missing capability ${key}`).toHaveProperty(key);
    }
    expect(result.capabilities.hoverProvider).toBe(true);
    expect(result.capabilities.textDocumentSync).toBe(1); // Full
    expect(result.capabilities.executeCommandProvider.commands).toEqual([
      ...NUDO_EXECUTE_COMMANDS,
    ]);
    expect(result.capabilities.completionProvider.triggerCharacters).toEqual([".", "@"]);
    expect(result.capabilities.diagnosticProvider).toEqual({
      interFileDependencies: false,
      workspaceDiagnostics: false,
    });
  }
  {
    const mock = startServer();
    for (const name of NUDO_AGENT_TOOL_NAMES) {
      expect(mock.requests.has(`nudo/${name}`), `missing nudo/${name}`).toBe(true);
      expect(mock.requests.has(`nudo.${name}`), `missing nudo.${name}`).toBe(true);
    }
    expect(mock.requests.has("nudo/selectCase")).toBe(true);
    expect(mock.requests.has("nudo/getActiveCases")).toBe(true);
    expect(mock.requests.has("textDocument/hover")).toBe(true);
    expect(mock.requests.has("textDocument/diagnostic")).toBe(true);
  }
});



describe("createNudoServer — request dispatch", () => {
  it("workspace/executeCommand nudo.check analyzes a source payload；slash-form nudo/check and dot-form nudo.check share one handler；nudo.getActiveCases returns the empty case map for a fresh uri", async () => {
  {
    const mock = startServer();
    const result = await handler(mock, "workspace/executeCommand")({
      command: "nudo.check",
      arguments: [{ file: join(dir, "inline.js"), source: CHECK_OK, format: "json" }],
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.version).toBe(1);
    expect(payload.ok).toBe(true);
    expect(payload.summary.functions).toBeGreaterThanOrEqual(1);
  }
  {
    const mock = startServer();
    const params = { file: okFile, format: "json" };
    const viaSlash = await handler(mock, "nudo/check")(params);
    const viaDot = await handler(mock, "nudo.check")(params);
    expect(viaSlash.isError).toBeFalsy();
    expect(viaDot.isError).toBeFalsy();
    expect(viaDot.content[0].text).toBe(viaSlash.content[0].text);
    const payload = JSON.parse(viaSlash.content[0].text);
    expect(payload.ok).toBe(true);
  }
  {
    const mock = startServer();
    const result = await handler(mock, "nudo/getActiveCases")({
      file: join(dir, "fresh.js"),
    });
    expect(result).toEqual({});
  }
});


});

describe("createNudoServer — error paths", () => {
  it("unknown executeCommand raises a protocol-level MethodNotFound error；nudo.check on a missing file returns isError (fail-closed)；pull diagnostics for an unknown document are empty (no crash)；pull diagnostics catch 不得 items:[] — 标 Analysis err", async () => {
  {
    const mock = startServer();
    // 940：未声明的命令名不再回落 result:null（协议层假成功）——必须走协议层错误。
    await expect(async () =>
      handler(mock, "workspace/executeCommand")({
        command: "nudo.notARealCommand",
        arguments: [{ file: okFile }],
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.MethodNotFound });
  }
  {
    const mock = startServer();
    const result = await handler(mock, "workspace/executeCommand")({
      command: "nudo.check",
      arguments: [{ file: join(dir, "no-such-file.js") }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Error:/);
  }
  {
    const mock = startServer();
    const result = await handler(mock, "textDocument/diagnostic")({
      textDocument: { uri: "file:///definitely/not/open.js" },
    });
    expect(result).toEqual({ kind: "full", items: [] });
  }
  {
    const mock = startServer();
    // 打开一个会让 analyzeFile 抛错的文档：带 @nudo 指令（过 isNudoFile gate）+ 语法错误
    const uri = "file:///t/syntax-err.js";
    const openHandler = mock.notifications.get("textDocument/didOpen");
    expect(openHandler).toBeTruthy();
    openHandler!({
      textDocument: {
        uri,
        languageId: "javascript",
        version: 1,
        text: `/**
 * @nudo:case 't' (1)
 */
function (`,
      },
    });
    const result = await handler(mock, "textDocument/diagnostic")({
      textDocument: { uri },
    });
    // 不得 items:[] 把瞬时失败当「文件干净」——必须留错误面
    expect(result.items.length).toBeGreaterThan(0);
    expect(
      result.items.some((d: { message: string }) =>
        /Analysis error|Check error|syntax error/.test(d.message),
      ),
    ).toBe(true);
  }
  {
    const mock = startServer();
    const uri = "file:///t/preserve-last.js";
    const openHandler = mock.notifications.get("textDocument/didOpen")!;
    // 先开一个能成功分析的文档（带指令文法诊断 → items 非空）
    openHandler({
      textDocument: {
        uri,
        languageId: "javascript",
        version: 1,
        text: `/**
 * @nudo:case 't' (1)
 */
function f(x) { return x; }`,
      },
    });
    const okResult = await handler(mock, "textDocument/diagnostic")({
      textDocument: { uri },
    });
    expect(okResult.items.length).toBeGreaterThan(0);

    // 再换成带 @nudo 指令的语法错误源并 bump version → 分析抛错，应保留上次 items
    openHandler({
      textDocument: {
        uri,
        languageId: "javascript",
        version: 2,
        text: `/**
 * @nudo:case 't' (1)
 */
function (`,
      },
    });
    const errResult = await handler(mock, "textDocument/diagnostic")({
      textDocument: { uri },
    });
    expect(errResult.items.length).toBeGreaterThan(0);
    // 上次成功的诊断面仍在（不得被 catch 清空）
    expect(
      errResult.items.some((d: { code?: string }) => d.code === "nudo:directive-syntax"),
    ).toBe(true);
  }
  {
    const mock = createMockConnection();
    const handle = createNudoServer(mock as unknown as Connection);
    expect(mock.listened).toBe(false);
    handle.listen();
    expect(mock.listened).toBe(true);
  }
});





});

describe("createNudoServer — client settings (initializationOptions / didChangeConfiguration)", () => {
  // 无导出、无指令的普通 JS：exports 档静默；all 档纳入。documentSymbol 的
  // isNudoFile gate 是行为观察面（非 nudo 文件 → []）。
  const PLAIN_SRC = "function plain(x) {\n  return x;\n}\n";

  let settingsDir: string;

  beforeAll(() => {
    settingsDir = mkdtempSync(join(tmpdir(), "nudo-lsp-settings-"));
  });

  afterAll(() => {
    rmSync(settingsDir, { recursive: true, force: true });
  });

  function notification(mock: Mock, method: string): AnyHandler {
    const h = mock.notifications.get(method);
    expect(h, `notification "${method}" not registered`).toBeTruthy();
    return h!;
  }

  function openPlainDoc(mock: Mock, rel: string): string {
    const filePath = join(settingsDir, rel, "plain.js");
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, PLAIN_SRC, "utf-8");
    const uri = `file://${filePath}`;
    notification(mock, "textDocument/didOpen")({
      textDocument: { uri, languageId: "javascript", version: 1, text: PLAIN_SRC },
    });
    return uri;
  }

  async function symbolsFor(mock: Mock, uri: string): Promise<{ name: string }[]> {
    return handler(mock, "textDocument/documentSymbol")({ textDocument: { uri } });
  }

  async function initServer(
    initializationOptions?: unknown,
  ): Promise<{ mock: Mock; reconfigure: (mode: unknown) => Promise<void> }> {
    const mock = startServer();
    await handler(mock, "initialize")({
      processId: null,
      rootUri: null,
      workspaceFolders: [],
      capabilities: {},
      ...(initializationOptions === undefined ? {} : { initializationOptions }),
    });
    return {
      mock,
      reconfigure: async (mode) => {
        notification(mock, "workspace/didChangeConfiguration")({
          settings: { nudo: { analysis: { mode } } },
        });
        // revalidate 是 fire-and-forget；让一轮跑完避免悬挂 Promise
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
    };
  }

  it("plain non-export JS stays quiet without client settings (exports default)；initializationOptions analysis.mode=all widens the gate；invalid initializationOptions mode falls back to the product default；project package.json#nudo.analysis.mode w", async () => {
  {
    const { mock } = await initServer();
    const uri = openPlainDoc(mock, "default");
    expect(await symbolsFor(mock, uri)).toEqual([]);
  }
  {
    const { mock } = await initServer({ analysis: { mode: "all" } });
    const uri = openPlainDoc(mock, "all");
    const symbols = await symbolsFor(mock, uri);
    expect(symbols.map((s) => s.name)).toContain("plain");
  }
  {
    const { mock } = await initServer({ analysis: { mode: "loud" } });
    const uri = openPlainDoc(mock, "invalid");
    expect(await symbolsFor(mock, uri)).toEqual([]);
  }
  {
    const projDir = join(settingsDir, "proj-directives");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      join(projDir, "package.json"),
      JSON.stringify({ nudo: { analysis: { mode: "directives" } } }),
      "utf-8",
    );
    const { mock } = await initServer({ analysis: { mode: "all" } });
    const uri = openPlainDoc(mock, "proj-directives");
    expect(await symbolsFor(mock, uri)).toEqual([]);
  }
  {
    const projDir = join(settingsDir, "proj-all");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      join(projDir, "package.json"),
      JSON.stringify({ nudo: { analysis: { mode: "all" } } }),
      "utf-8",
    );
    const { mock } = await initServer({ analysis: { mode: "directives" } });
    const uri = openPlainDoc(mock, "proj-all");
    const symbols = await symbolsFor(mock, uri);
    expect(symbols.map((s) => s.name)).toContain("plain");
  }
  {
    const { mock, reconfigure } = await initServer();
    const uri = openPlainDoc(mock, "live");
    expect(await symbolsFor(mock, uri)).toEqual([]);

    await reconfigure("all");
    expect((await symbolsFor(mock, uri)).map((s) => s.name)).toContain("plain");

    await reconfigure(undefined);
    expect(await symbolsFor(mock, uri)).toEqual([]);
  }
});





});

describe("createNudoServer — 参数 inlay hints 开关（nudo.inlayHints.parameters，默认关）", () => {
  // 显式侧车契约（同名 *.nudo.js 自动绑定）→ 参数 `where …` inlay
  const PARAM_SRC = `export function need(x) {
  return x;
}
`;
  const PARAM_SIDECAR = `import { fn, number } from "@nudojs/core";
export const need = fn({ x: number() }, number());
`;

  let paramDir: string;

  beforeAll(() => {
    paramDir = mkdtempSync(join(tmpdir(), "nudo-lsp-paraminlay-"));
  });

  afterAll(() => {
    rmSync(paramDir, { recursive: true, force: true });
  });

  function notification(mock: Mock, method: string): AnyHandler {
    const h = mock.notifications.get(method);
    expect(h, `notification "${method}" not registered`).toBeTruthy();
    return h!;
  }

  /** 建独立子项目（避免 findProjectConfig memo 指纹撞车）并打开 need.js */
  async function startParamSession(
    initializationOptions?: unknown,
    projectNudo?: unknown,
  ): Promise<{ mock: Mock; uri: string }> {
    const sub = `proj-${Math.random().toString(36).slice(2, 8)}`;
    const projDir = join(paramDir, sub);
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "need.js"), PARAM_SRC, "utf-8");
    writeFileSync(join(projDir, "need.nudo.js"), PARAM_SIDECAR, "utf-8");
    if (projectNudo !== undefined) {
      writeFileSync(
        join(projDir, "package.json"),
        JSON.stringify({ nudo: projectNudo }),
        "utf-8",
      );
    }
    const mock = startServer();
    await handler(mock, "initialize")({
      processId: null,
      rootUri: null,
      workspaceFolders: [],
      capabilities: {},
      ...(initializationOptions === undefined ? {} : { initializationOptions }),
    });
    const uri = `file://${join(projDir, "need.js")}`;
    notification(mock, "textDocument/didOpen")({
      textDocument: { uri, languageId: "javascript", version: 1, text: PARAM_SRC },
    });
    return { mock, uri };
  }

  async function inlayLabels(mock: Mock, uri: string): Promise<string[]> {
    const hints = (await handler(mock, "textDocument/inlayHint")({
      textDocument: { uri },
      range: { start: { line: 0, character: 0 }, end: { line: 99, character: 0 } },
    })) as { label?: unknown }[];
    return hints.map((h) => String(h.label ?? ""));
  }

  it("默认关：无参数 where inlay（返回 inlay 仍在）；initializationOptions inlayHints.parameters=true 开启；非法宿主值回落默认关；workspace/didChangeConfiguration 实时开关；项目 package.json#nudo.inlayHints.parameters 显式值赢过宿主默认；折叠展示：侧车表达式原文 label + 完整 pred tooltip", async () => {
  {
    const { mock, uri } = await startParamSession();
    const labels = await inlayLabels(mock, uri);
    expect(labels.some((l) => l.includes("where"))).toBe(false);
    // 返回 inlay（`: x` 路径摘要）短小，不受开关影响
    expect(labels.some((l) => l.includes(": x"))).toBe(true);
  }
  {
    const { mock, uri } = await startParamSession({
      inlayHints: { parameters: true },
    });
    const labels = await inlayLabels(mock, uri);
    // 声明形态折叠（侧车表达式原文）——非 pred 无损展开
    // （`typeof x = "number"`）；exec 缓存跨路径命中时
    // 按当前路径补登记文本，折叠不丢
    expect(labels.some((l) => l.includes("where number()"))).toBe(
      true,
    );
    expect(
      labels.some((l) => l.includes('where typeof x = "number"')),
    ).toBe(false);
  }
  {
    const { mock, uri } = await startParamSession({
      inlayHints: { parameters: "yes" },
    });
    const labels = await inlayLabels(mock, uri);
    expect(labels.some((l) => l.includes("where"))).toBe(false);
  }
  {
    const { mock, uri } = await startParamSession();
    expect((await inlayLabels(mock, uri)).some((l) => l.includes("where"))).toBe(
      false,
    );
    notification(mock, "workspace/didChangeConfiguration")({
      settings: { nudo: { inlayHints: { parameters: true } } },
    });
    expect(
      await waitForValue(
        async () => (await inlayLabels(mock, uri)).some((l) => l.includes("where")),
        (v) => v === true,
        { timeout: 1000 },
      ),
    ).toBe(true);
    notification(mock, "workspace/didChangeConfiguration")({
      settings: { nudo: { inlayHints: { parameters: false } } },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await inlayLabels(mock, uri)).some((l) => l.includes("where"))).toBe(
      false,
    );
  }
  {
    // 项目关 + 宿主开 → 关
    const off = await startParamSession(
      { inlayHints: { parameters: true } },
      { inlayHints: { parameters: false } },
    );
    expect((await inlayLabels(off.mock, off.uri)).some((l) => l.includes("where"))).toBe(
      false,
    );
    // 项目开 + 宿主关 → 开
    const on = await startParamSession(
      { inlayHints: { parameters: false } },
      { inlayHints: { parameters: true } },
    );
    expect((await inlayLabels(on.mock, on.uri)).some((l) => l.includes("where"))).toBe(
      true,
    );
  }
  {
    const sub = `proj-${Math.random().toString(36).slice(2, 8)}`;
    const projDir = join(paramDir, sub);
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "need.js"), PARAM_SRC, "utf-8");
    writeFileSync(
      join(projDir, "need.nudo.js"),
      `import { fn, number } from "@nudojs/core";
export const need = fn({ x: number().gt(0) }, number());
`,
      "utf-8",
    );
    const mock = startServer();
    await handler(mock, "initialize")({
      processId: null,
      rootUri: null,
      workspaceFolders: [],
      capabilities: {},
      initializationOptions: { inlayHints: { parameters: true } },
    });
    const uri = `file://${join(projDir, "need.js")}`;
    notification(mock, "textDocument/didOpen")({
      textDocument: { uri, languageId: "javascript", version: 1, text: PARAM_SRC },
    });
    const hints = (await handler(mock, "textDocument/inlayHint")({
      textDocument: { uri },
      range: { start: { line: 0, character: 0 }, end: { line: 99, character: 0 } },
    })) as { label?: unknown; tooltip?: unknown }[];
    const param = hints.find((h) => String(h.label ?? "").includes("where"));
    expect(param).toBeDefined();
    // 表达式原文折叠（替代 pred 无损展开）
    expect(String(param!.label)).toBe("  where number().gt(0)");
    // 完整 pred 进 tooltip 供 hover 展开
    expect(typeof param!.tooltip).toBe("string");
    expect(String(param!.tooltip)).toContain("x");
    expect(String(param!.tooltip)).toContain(">");
  }
});





});

describe("createNudoServer — 观察选择器（contract 与各 case 互斥选项）", () => {
  // 同一文件同时具备契约选项（export → implicit 档 + persist/draft 动作）、
  // 指令 case 与未导出函数的字面量调用点合成 call@
  const LENS_SRC = `/**
 * @nudo:case "five" (2, 3)
 */
export function add(a, b) {
  return a + b;
}

function mul(a, b) {
  return a * b;
}
const r = mul(2, 3);
`;

  let lensDir: string;

  beforeAll(() => {
    lensDir = mkdtempSync(join(tmpdir(), "nudo-lsp-lensmode-"));
    writeFileSync(join(lensDir, "lens.js"), LENS_SRC, "utf-8");
  });

  afterAll(() => {
    rmSync(lensDir, { recursive: true, force: true });
  });

  function notification(mock: Mock, method: string): AnyHandler {
    const h = mock.notifications.get(method);
    expect(h, `notification "${method}" not registered`).toBeTruthy();
    return h!;
  }

  async function startSelectorSession(): Promise<{ mock: Mock; uri: string }> {
    const mock = startServer();
    await handler(mock, "initialize")({
      processId: null,
      rootUri: null,
      workspaceFolders: [],
      capabilities: {},
    });
    const uri = `file://${join(lensDir, "lens.js")}`;
    notification(mock, "textDocument/didOpen")({
      textDocument: { uri, languageId: "javascript", version: 1, text: LENS_SRC },
    });
    return { mock, uri };
  }

  async function lensTitles(mock: Mock, uri: string): Promise<string[]> {
    const lenses = await handler(mock, "textDocument/codeLens")({ textDocument: { uri } });
    return (lenses as { command?: { title?: string } }[]).map((l) => l.command?.title ?? "");
  }

  async function exec(mock: Mock, command: string, args: unknown[]) {
    return handler(mock, "workspace/executeCommand")({ command, arguments: args });
  }

  it("默认：契约选项 ●，全部 case ○；动作与观察层照常；selectCase 后契约转 ○、选中 case 转 ●；inlay 档投影同态；selectContract 切回契约（case 全 ○），幂等；nudo/selectContract 请求别名与命令同效", async () => {
  {
    const { mock, uri } = await startSelectorSession();
    const titles = await lensTitles(mock, uri);
    expect(titles).toContain("● contract / imp");
    expect(titles).toContain('○ case "five"');
    expect(titles.some((t) => t.startsWith("● case"))).toBe(false);
    expect(titles).toContain("⚡ persist contract");
    expect(titles).toContain("⚡ draft contract");
    expect(titles.some((t) => t.startsWith("call@"))).toBe(true);
  }
  {
    const { mock, uri } = await startSelectorSession();
    await exec(mock, "nudo.selectCase", [uri, "add", 0, "five"]);
    const titles = await lensTitles(mock, uri);
    expect(titles).toContain("○ contract / imp");
    expect(titles).toContain('● case "five"');

    const hints = await handler(mock, "textDocument/inlayHint")({
      textDocument: { uri },
      range: { start: { line: 0, character: 0 }, end: { line: 99, character: 0 } },
    });
    const labels = ((hints ?? []) as { label?: unknown }[]).map((h) => String(h.label ?? ""));
    expect(labels.some((l) => l.includes("○ contract / imp"))).toBe(true);
  }
  {
    const { mock, uri } = await startSelectorSession();
    await exec(mock, "nudo.selectCase", [uri, "add", 0, "five"]);
    expect((await lensTitles(mock, uri)).some((t) => t.startsWith("○ contract"))).toBe(true);

    await exec(mock, "nudo.selectContract", [uri, "add"]);
    const titles = await lensTitles(mock, uri);
    expect(titles).toContain("● contract / imp");
    expect(titles).toContain('○ case "five"');

    // 无激活 case 时再点契约：幂等保持 ●
    await exec(mock, "nudo.selectContract", [uri, "add"]);
    expect((await lensTitles(mock, uri)).some((t) => t.startsWith("● contract"))).toBe(true);
  }
  {
    const { mock, uri } = await startSelectorSession();
    await handler(mock, "nudo/selectCase")({ uri, functionName: "add", caseIndex: 0 });
    await handler(mock, "nudo/selectContract")({ uri, functionName: "add" });
    const titles = await lensTitles(mock, uri);
    expect(titles.some((t) => t.startsWith("● contract"))).toBe(true);
  }
});



});
});

// ---------------------------------------------------------------------------
// LSP session maps are LRU-capped (P-IDE6)
// ---------------------------------------------------------------------------
describe("LSP session maps are LRU-capped (P-IDE6)", () => {
/**
 * P-IDE6：LSP 会话 Map（analysisCache / knownFiles / nudoDepParents）LRU 上限。
 * 与 service getSessionCacheLimits 同源（maxFiles；dep 边按 4× 口径）——
 * 长 IDE 会话不再单调增长。
 */




const SRC = `export function f${"0"}(x) { return x; }\n`;

{
  beforeEach(() => {
    clearValidationState();
  });
  afterEach(() => {
    setSessionCacheLimits(null);
    resetSessionCacheLimitState();
    clearValidationState();
  });

  it("analysisCache trims to maxFiles as distinct files stream in；knownFiles caps at maxFiles (dirty-propagation registry)；nudoDepParents caps at 4× maxFiles with LRU refresh on access；maxFiles=0 disables the analysisCache layer (recompute, never", async () => {
  {
    clearValidationState();


    setSessionCacheLimits({ maxFiles: 2, maxFns: 16, maxEvalRuns: 4 });
    for (let i = 0; i < 6; i++) {
      getCachedOrAnalyze(`/t/lru/f${i}.js`, `export const v${i} = ${i};\n`, 1);
    }
    expect(analysisCache.size).toBeLessThanOrEqual(2);
    // LRU：最近访问的键保留
    expect(analysisCache.has("/t/lru/f5.js")).toBe(true);
    expect(analysisCache.has("/t/lru/f0.js")).toBe(false);
  }
  {
    clearValidationState();


    setSessionCacheLimits({ maxFiles: 2, maxFns: 16, maxEvalRuns: 4 });
    const sent: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      await validateText(`/t/lru/k${i}.js`, `file:///t/lru/k${i}.js`, SRC, 1, {
        sendDiagnostics: (p) => sent.push(p),
      });
    }
    expect(knownFiles.size).toBeLessThanOrEqual(2);
  }
  {
    clearValidationState();


    setSessionCacheLimits({ maxFiles: 2, maxFns: 16, maxEvalRuns: 4 });
    for (let i = 0; i < 20; i++) {
      registerNudoImportDeps(
        `/t/lru/p${i}.js`,
        `/// @nudo:import { t } from "./d${i}.nudo.js"\nexport function f(x) { return x; }\n`,
      );
    }
    expect(nudoDepParents.size).toBeLessThanOrEqual(8);
  }
  {
    clearValidationState();


    setSessionCacheLimits({ maxFiles: 0, maxFns: 16, maxEvalRuns: 4 });
    const r1 = getCachedOrAnalyze("/t/lru/off.js", SRC, 1);
    expect(r1).toBeTruthy();
    expect(analysisCache.size).toBe(0);
    // 再来一次：无条目 → 重算（新对象），不是陈旧命中
    const r2 = getCachedOrAnalyze("/t/lru/off.js", SRC, 1);
    expect(r2).toBeDefined();
  }
});



}
});

// ---------------------------------------------------------------------------
// A8 validateGeneration cancel
// ---------------------------------------------------------------------------
describe("A8 validateGeneration cancel", () => {
function makeDeps(): ValidateTextDeps & { sent: Array<{ uri: string; n: number }> } {
  const sent: Array<{ uri: string; n: number }> = [];
  return {
    sent,
    sendDiagnostics: ({ uri, diagnostics }) => {
      sent.push({ uri, n: diagnostics.length });
    },
    loadModule: () => undefined,
    isNudoUri: () => true,
  };
}

{
  beforeEach(() => {
    clearValidationState();
  });

  it("bumps generation per validateText call；bumpValidateGeneration (onDidClose path) discards in-flight publish；older overlapping validate does not publish after a newer one starts；stillCurrent gate: a completed older gen after newer bump does n", async () => {
  {
    clearValidationState();


    const deps = makeDeps();
    await validateText("/t/a.js", "file:///t/a.js", "function id(x){return x;}\n", 1, deps);
    expect(validateGeneration.get("/t/a.js")).toBe(1);
    await validateText("/t/a.js", "file:///t/a.js", "function id(x){return x;}\n", 2, deps);
    expect(validateGeneration.get("/t/a.js")).toBe(2);
  }
  {
    clearValidationState();


    const deps = makeDeps();
    const path = "/t/closed.js";
    const uri = "file:///t/closed.js";
    // 启动 validate，不 await；关闭文档时 bump generation
    const p = validateText(
      path,
      uri,
      "export function f(){return 1;}\n",
      1,
      deps,
    );
    const closedGen = bumpValidateGeneration(path);
    await p;
    expect(validateGeneration.get(path)).toBe(closedGen);
    // 关闭后不得再 publish 陈旧诊断
    expect(deps.sent.length).toBe(0);
  }
  {
    clearValidationState();


    const deps = makeDeps();
    const src1 = `
/**
 * @nudo:case "neg" (-1)
 */
function safe(x) {
  if (x < 0) throw new RangeError("neg");
  return x;
}
`;
    const src2 = `
/**
 * @nudo:case "pos" (1)
 */
function safe(x) {
  return x;
}
`;
    // 启动慢分析（v1），不 await；立刻启动 v2
    const p1 = validateText("/t/storm.js", "file:///t/storm.js", src1, 1, deps);
    const p2 = validateText("/t/storm.js", "file:///t/storm.js", src2, 2, deps);
    await Promise.all([p1, p2]);
    expect(validateGeneration.get("/t/storm.js")).toBe(2);
    expect(deps.sent.length).toBeGreaterThan(0);
    // P2：旧 generation 不得在 v2 之后再 publish
    // 最终 generation=2；sent 次数应 ≤2，且最后一次 send 发生在 gen 已到 2 之后
    expect(deps.sent.length).toBeLessThanOrEqual(2);
  }
  {
    clearValidationState();


    const deps = makeDeps();
    const uri = "file:///t/gate.js";
    const path = "/t/gate.js";
    // v1 启动
    const p1 = validateText(path, uri, "export function a(){return 1;}\n", 1, deps);
    // 立刻 bump 到 v2（空 validate 覆盖）
    const p2 = validateText(path, uri, "export function b(){return 2;}\n", 2, deps);
    await Promise.all([p1, p2]);
    expect(validateGeneration.get(path)).toBe(2);
    // 若旧 gen 在 bump 后仍 publish，sent 可能 >1；契约是 ≤ gen 且不 throw
    // 更强：所有 send 的诊断内容不得来自已被取代的 generation 专属结果——
    // 这里用 sent 次数与 gen 一致性做契约：不得出现「gen 已是 2 仍因 v1 再 push」导致 >2
    expect(deps.sent.length).toBeLessThanOrEqual(2);
  }
  {
    clearValidationState();


    const deps = makeDeps();
    await validateText("/t/b.js", "file:///t/b.js", "export function f(){return 1;}\n", 1, deps);
    clearValidationState();
    expect(validateGeneration.size).toBe(0);
  }
});




}
});

// ---------------------------------------------------------------------------
// validateText 文档 version 门（）
// ---------------------------------------------------------------------------
describe("validateText 文档 version 门（）", () => {
/**
 * validateText 文档 version 门回归（/ S5-003）。
 * 回归背景：stillCurrent 只比 validateGeneration——didChange 不 bump
 * generation，慢分析（await 期间）文档已更新时，旧结果会发布到
 * 新 buffer（squiggle 错位 / 幽灵报错）。修复：generation 之外
 * 再比打开文档的当前 version；发布带启动时 version（LSP 3.15
 * PublishDiagnosticsParams.version，宿主客户端据此丢弃陈旧发布）。
 */







const SRC_V1 = `export function f(x) {
  return x;
}
`;
const SRC_V2 = `export function f(x) {
  return x.toFixed(2);
}
`;


  it("superseded 文档版本的慢分析不发布陈旧诊断；未变更文档的分析正常发布且带启动时 version；无文档跟踪的宿主回落 generation-only 口径（照常发布）", async () => {
  {
    clearValidationState();
    await withTempDir("nudo-vgate-", async (dir) => {
      const filePath = join(dir, "a.js");
      // 带相对导入：分析中段会经 deps.loadModule 取依赖（E5 路径）——
      // 用它做「慢分析进行中」的接缝，无需 mock 实现
      const SRC_V1 = `import { g } from "./b.js";\nexport function f(x) {\n  return g(x);\n}\n`;
      const SRC_V2 = `import { g } from "./b.js";\nexport function f(x) {\n  return g(x).toFixed(2);\n}\n`;
      writeFileSync(filePath, SRC_V1);
      writeFileSync(join(dir, "b.js"), `export function g(x) { return x; }\n`);
      const uri = "file://" + filePath;

      // 文档跟踪器：version 可变（模拟宿主 didChange 实时更新）
      const doc = { uri, version: 1, getText: () => SRC_V1 };
      const sent: Array<{ uri: string; version?: number; n: number }> = [];
      const deps = makeValidateDeps({
        onPublish: (p) =>
          sent.push({ uri: p.uri, version: p.version, n: p.diagnostics.length }),
        getOpenDocumentByPath: () => doc,
        loadModule: (spec) => {
          if (spec.endsWith("b.js")) {
            // 分析中段：文档推进到 v2（didChange 先更新跟踪器，
            // 防抖排队的新 validate 尚未启动）
            doc.version = 2;
            doc.getText = () => SRC_V2;
          }
          return `export function g(x) { return x; }`;
        },
      });

      await validateText(filePath, uri, SRC_V1, 1, deps);

      // v1 的慢分析被 v2 取代（generation 未变但文档 version 已变）
      // → 不得发布任何陈旧诊断
      expect(sent).toEqual([]);

      // 对照：以当前 v2 文本/版本重验 → 正常发布（证明上一轮
      // 的沉默是 version 门拦截，而非分析失败/异常路径）
      await validateText(filePath, uri, SRC_V2, 2, deps);
      expect(sent.length).toBe(1);
      expect(sent[0]!.version).toBe(2);
    });
  }
  {
    clearValidationState();
    await withTempDir("nudo-vgate2-", async (dir) => {
      const filePath = join(dir, "a.js");
      writeFileSync(filePath, SRC_V1);
      const uri = "file://" + filePath;
      const doc = { uri, version: 1, getText: () => SRC_V1 };
      const sent: Array<{ uri: string; version?: number }> = [];
      const deps = makeValidateDeps({
        onPublish: (p) => sent.push({ uri: p.uri, version: p.version }),
        getOpenDocumentByPath: () => doc,
      });
      await validateText(filePath, uri, SRC_V1, 1, deps);
      expect(sent.length).toBe(1);
      expect(sent[0]!.version).toBe(1);
    });
  }
  {
    clearValidationState();
    await withTempDir("nudo-vgate3-", async (dir) => {
      const filePath = join(dir, "a.js");
      writeFileSync(filePath, SRC_V1);
      const uri = "file://" + filePath;
      const sent: Array<{ uri: string; version?: number }> = [];
      const deps = makeValidateDeps({
        onPublish: (p) => sent.push({ uri: p.uri, version: p.version }),
        // 宿主不提供文档跟踪 → 不加 version 门
      });
      await validateText(filePath, uri, SRC_V1, 1, deps);
      expect(sent.length).toBe(1);
      expect(sent[0]!.version).toBe(1);
    });
  }
});



});

// ---------------------------------------------------------------------------
// 配置变更不得抹掉未提及的宿主设置
// ---------------------------------------------------------------------------
describe("配置变更不得抹掉未提及的宿主设置", () => {
/**
 * `workspace/didChangeConfiguration` 的部分载荷把宿主的
 * `nudo.analysis.mode` 默认值**抹成 undefined**。
 *
 * 症状：初始化时 `analysis.mode = "all"`（宿主设置），一次**部分**或**无关**
 * 的设置变更后，分析范围收缩回产品默认（exports）⇒ 原本能分析的文件
 * 不再被分析 ⇒ hover 从有值变 null。
 *
 * 根因（片 D · `server.ts`）：server 把 `params.settings.nudo.*` 当**整棵
 * 子树**读——载荷没提到的键直接读成 `undefined` ⇒ 覆盖掉旧值。扁平键
 * （`"nudo.analysis.mode"`）也完全不被识别。
 *
 * 修法：宿主设置改为**累积合并树**——
 * - 新载荷出现的键覆盖旧值；**未出现的键保留旧值**；`null` = 显式重置；
 * - 扁平键按点号展开成嵌套路径（与嵌套形态等价）；
 * - 读取一律走合并树（`readSettingsPath`）。
 *
 * 钉：① 部分载荷（只带 inlayHints）后 hover 仍在；② 无关载荷（editor.*）
 * 后 hover 仍在；③ 扁平键 `"nudo.analysis.mode": "exports"` **必须被采纳**
 * （hover 变 null）；④ 整棵载荷 `"all"` 后 hover 回来。
 */







const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 无 export 的文件：只有 mode=all 才会被分析 ⇒ hover 是「分析范围」的探针。 */
const SRC = "function boom(x) {\n  return x + 1;\n}\nboom;\n";

function hoverText(mock: ReturnType<typeof createMockConnection>, uri: string): string | null {
  const hover = mock.requests.get("textDocument/hover")!;
  const res = hover({
    textDocument: { uri },
    position: { line: 0, character: 10 },
  }) as { contents?: { value?: string } } | null;
  return res?.contents?.value ?? null;
}


  it("部分载荷 / 无关载荷 / 扁平键：analysis.mode 不被抹掉；显式 null = 重置（回落产品默认 exports）", async () => {
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug777-"));
    try {
      const file = join(dir, "a.js");
      writeFileSync(file, SRC, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.requests.get("initialize")!({
        processId: null,
        rootUri: `file://${dir}`,
        workspaceFolders: [{ uri: `file://${dir}`, name: "ws" }],
        capabilities: {},
        initializationOptions: { analysis: { mode: "all" } },
      });
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await sleep(500);
      expect(hoverText(mock, uri)).toContain("boom");

      const change = mock.notifications.get("workspace/didChangeConfiguration")!;

      // ① 部分载荷：只带 inlayHints ⇒ analysis.mode 保留
      change({ settings: { nudo: { inlayHints: { parameters: true } } } });
      await sleep(400);
      expect(hoverText(mock, uri)).toContain("boom");

      // ② 无关载荷：整棵 editor.* ⇒ analysis.mode 保留
      change({ settings: { editor: { fontSize: 12 } } });
      await sleep(400);
      expect(hoverText(mock, uri)).toContain("boom");

      // ③ 扁平键必须被**采纳**（等价于嵌套 nudo.analysis.mode）
      change({ settings: { "nudo.analysis.mode": "exports" } });
      await sleep(400);
      expect(hoverText(mock, uri)).toBeNull();

      // ④ 整棵载荷：显式回到 all ⇒ hover 回来
      change({ settings: { nudo: { analysis: { mode: "all" } } } });
      await sleep(400);
      expect(hoverText(mock, uri)).toContain("boom");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug777-"));
    try {
      const file = join(dir, "a.js");
      writeFileSync(file, SRC, "utf-8");
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      mock.requests.get("initialize")!({
        processId: null,
        rootUri: `file://${dir}`,
        workspaceFolders: [{ uri: `file://${dir}`, name: "ws" }],
        capabilities: {},
        initializationOptions: { analysis: { mode: "all" } },
      });
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
      });
      await sleep(500);
      expect(hoverText(mock, uri)).toContain("boom");
      mock.notifications.get("workspace/didChangeConfiguration")!({
        settings: { nudo: { analysis: { mode: null } } },
      });
      await sleep(400);
      expect(hoverText(mock, uri)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});


});

// ---------------------------------------------------------------------------
// LSP project-config invalidation
// ---------------------------------------------------------------------------
describe("LSP project-config invalidation", () => {

  it("package.json change clears analysisCache and notifies host", async () => {
    clearValidationState();
    let configChanged = 0;
    const deps = {
      sendDiagnostics: () => {},
      isNudoUri: () => true,
      getActiveCases: () => new Map(),
      getOpenDocumentByPath: () => undefined,
      listOpenDocuments: () => [],
      onProjectConfigChanged: () => {
        configChanged++;
      },
    };
    analysisCache.set("/tmp/proj/a.js", {
      version: 1,
      result: { functions: [], diagnostics: [], bindings: new Map(), nodeAbsMap: new Map() } as never,
      sourceHash: "abc",
      cfgHash: "old",
    });
    await handleNudoDepFileChanged("/tmp/proj/package.json", deps);
    expect(configChanged).toBe(1);
    expect(analysisCache.has("/tmp/proj/a.js")).toBe(false);
  });

});
