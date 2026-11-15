/**
 * Bug 749 — LSP server **从不保存**客户端能力（`initialize` 的
 * `params.capabilities`）⇒ 协议面无从按客户端声明的能力作答。
 *
 * 根因：`onInitialize` 只回**自己**的能力声明、**从不读** `params.capabilities`
 * ⇒ 全文没有任何一处读客户端能力 ⇒ `onDocumentSymbol` 恒回「层级式 +
 * 全量 SymbolKind」（形状违规 + 取值违规）。
 *
 * 本钉钉住**能力读取侧**（片 C）的契约：
 * 1. `initialize` 时捕获 `params.capabilities`；
 * 2. 经**既有 deps** 注入导航面（`deps.clientCapabilities`）——`deps` 是模块内
 *    参数 ⇒ **零新增 package 导出**、公开面零变更；
 * 3. **缺省语义**：客户端没发能力段（老客户端可能根本不发）⇒ `undefined`
 *    ⇒ 消费方必须走**默认**（层级式 + 全量 SymbolKind），**不得**因拿不到
 *    能力就退化；
 * 4. `initialize` 的**返回值不变** ⇒ `NUDO_INITIALIZE_CAPABILITIES` 冻结表
 *    一行不动（服务端**声明**的能力键 ≠ 客户端**声明**的能力）。
 *
 * ⚠ 输出侧（按能力决定返回形状 / SymbolKind 夹取）归片 B（`server-navigation.ts`）。
 */
import { describe, it, expect, vi } from "vitest";
import { createMockConnection, withLspServerCapabilities } from "./helpers.ts";
import { createNudoServer } from "../server.ts";
import { NUDO_INITIALIZE_CAPABILITIES } from "../public-api.ts";

/**
 * 捕获 server 注入导航面的 deps：`attachNavigation` 是**模块内注入点**
 * （`server.ts` 组装 deps 的唯一位置），钉住它就钉住了契约本身。
 */
const nav = vi.hoisted(() => ({ deps: undefined as any }));

vi.mock("../server-navigation.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server-navigation.ts")>();
  return {
    ...actual,
    attachNavigation: (deps: any) => {
      nav.deps = deps;
    },
  };
});

/** 客户端声明：不要层级式 + 只接受 [Function, Variable] 两种 kind。 */
const CLIENT_CAPS = {
  textDocument: {
    documentSymbol: {
      hierarchicalDocumentSymbolSupport: false,
      symbolKind: { valueSet: [12, 13] },
    },
  },
};

describe("Bug 749 — initialize 捕获客户端能力并注入导航面", () => {
  it("客户端能力被捕获，并经既有 deps 注入导航面", async () => {
    await withLspServerCapabilities({ "a.js": "export const a = 1;\n" }, CLIENT_CAPS, async () => {
      expect(nav.deps, "导航面 deps 未注入").toBeTruthy();
      expect(
        typeof nav.deps.clientCapabilities,
        "deps.clientCapabilities 未注入（能力读取侧缺失）",
      ).toBe("function");
      expect(nav.deps.clientCapabilities()).toEqual(CLIENT_CAPS);
    });
  });

  it("客户端没发能力段 ⇒ undefined（消费方必须走默认：层级式 + 全量 kind）", async () => {
    await withLspServerCapabilities({ "a.js": "export const a = 1;\n" }, undefined, async () => {
      expect(typeof nav.deps.clientCapabilities).toBe("function");
      expect(nav.deps.clientCapabilities()).toBeUndefined();
    });
  });

  it("initialize 的返回值不变（服务端声明的能力键清单零变更）", () => {
    const mock = createMockConnection();
    createNudoServer(mock as unknown as never);
    const initialize = mock.requests.get("initialize");
    expect(initialize, "initialize handler not registered").toBeTruthy();
    const result = initialize!({
      processId: null,
      rootUri: null,
      workspaceFolders: null,
      capabilities: CLIENT_CAPS,
    }) as { capabilities: Record<string, unknown> };

    // 冻结表里的键一个不少
    for (const key of NUDO_INITIALIZE_CAPABILITIES) {
      expect(result.capabilities, `initialize 缺能力键 ${key}`).toHaveProperty(key);
    }
    // 服务端仍声明 documentSymbol 支持（不因客户端声明而改返回值）
    expect(result.capabilities.documentSymbolProvider).toBe(true);
    // 客户端能力**不得**被回显进服务端的能力声明
    expect(result.capabilities).not.toHaveProperty("hierarchicalDocumentSymbolSupport");
    expect(result.capabilities).not.toHaveProperty("symbolKind");
  });
});
