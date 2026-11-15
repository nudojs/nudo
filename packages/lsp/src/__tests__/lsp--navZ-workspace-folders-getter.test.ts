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
 * ⇒ Bug 783 的功能面（工作区文件夹变更 ⇒ 授权边界重算）**不被防御打死**。
 *
 * 钉：
 * ① 客户端**不声明** `capabilities.workspace.workspaceFolders` ⇒
 *    `createNudoServer` **不抛**；
 * ② 该客户端的 `onInitialize` **仍正常返回**（服务端能力声明一字不动）；
 * ③ 真语义（getter 在 `initialize` 之前抛、之后可用）⇒ 订阅**仍建立**
 *    且**只建立一次**（构造期那次抛了，不算）。
 */
import { describe, it, expect } from "vitest";
import { createMockConnection, type AnyHandler } from "./helpers.ts";
import { createNudoServer } from "../server.ts";

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

describe("族 24 Z —— workspaceFolders 的 getter 抛异常不得让 server 崩", () => {
  it("① 客户端不声明 workspaceFolders 能力 ⇒ createNudoServer 不抛异常", () => {
    const mock = mockClientWithoutWorkspaceFolders();
    expect(() => createNudoServer(mock as unknown as never)).not.toThrow();
  });

  it("② 该客户端的 onInitialize 仍正常返回（服务端能力声明一字不动）", () => {
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
  });

  it("③ 真语义（getter 在 initialize 之后才可用）⇒ 订阅仍建立且只建立一次", async () => {
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
    await new Promise((r) => setTimeout(r, 0));
    // initialize 之后：getter 可用 ⇒ 订阅补上（且不重复订阅）
    expect(listeners.length, "initialize 之后未建立订阅").toBe(1);

    // 订阅到的处理器可被调用（发通知不会把 server 掀翻）
    expect(() => listeners[0]({ added: [], removed: [] })).not.toThrow();
  });
});
