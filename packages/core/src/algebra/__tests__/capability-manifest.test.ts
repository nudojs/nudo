/**
 * ABS-12 R12-D · 宿主能力清单的**漂移门禁**。
 *
 * 策略（default-deny）：未列名 = denied；未分类的新宿主全局不得静默可执行。
 * 本夹具把「当前宿主的全部全局 / 内建模块」与提交的快照对比：
 * - 新名字出现（Node 升级 / 运行器注入） ⇒ **红**（必须先分类再进快照）；
 * - 快照内每个名字必须**恰好**归入 allowed 或 denied 之一（禁止两边都有 / 都无）；
 * - 未列名查询返回 denied（default-deny 的可观察面）。
 *
 * 运行器 / 工具链注入的探针全局（`__vitest_*` 等）按形态豁免——它们不是
 * 被分析代码可见的宿主面（见 ABS-14 的 isInjectedHostGlobal 同口径）。
 */
import { describe, it, expect } from "vitest";
import { builtinModules } from "node:module";
import {
  ALLOWED_HOST_GLOBALS,
  ALLOWED_NODE_BUILTINS,
  DENIED_HOST_GLOBALS,
  DENIED_NODE_BUILTINS,
  HOST_GLOBAL_SNAPSHOT,
  NODE_BUILTIN_SNAPSHOT,
  hostGlobalCapability,
  nodeModuleCapability,
} from "../exec/capabilities.ts";
import { neverExecHostName } from "../exec/calls.ts";

/** 测试运行器 / 工具链注入的全局（不是产品宿主面）。 */
function isInjectedHostGlobal(name: string): boolean {
  return /^__(vitest|vite)/i.test(name) || /_LOADED__$/.test(name);
}

const presentGlobals = Object.getOwnPropertyNames(globalThis).filter(
  (n) => !isInjectedHostGlobal(n),
);

describe("ABS-12 · 宿主全局能力清单", () => {
  it("当前宿主的每个全局都在快照里（新增名字必须先分类）", () => {
    const snapshot = new Set(HOST_GLOBAL_SNAPSHOT);
    const missing = presentGlobals.filter((n) => !snapshot.has(n));
    expect(missing, `unclassified host globals: ${missing.join(", ")}`).toEqual([]);
  });

  it("快照内每个名字恰好归入 allowed / denied 之一", () => {
    const both = HOST_GLOBAL_SNAPSHOT.filter(
      (n) => ALLOWED_HOST_GLOBALS.has(n) && DENIED_HOST_GLOBALS.has(n),
    );
    const neither = HOST_GLOBAL_SNAPSHOT.filter(
      (n) => !ALLOWED_HOST_GLOBALS.has(n) && !DENIED_HOST_GLOBALS.has(n),
    );
    expect(both, `both: ${both.join(", ")}`).toEqual([]);
    expect(neither, `neither: ${neither.join(", ")}`).toEqual([]);
  });

  it("快照是排序去重的（避免手改漏项）", () => {
    expect(HOST_GLOBAL_SNAPSHOT).toEqual([...new Set(HOST_GLOBAL_SNAPSHOT)].sort());
  });

  it("default-deny：未列名查询 = denied", () => {
    expect(hostGlobalCapability("__nudo_not_a_real_global__")).toBe("denied");
    expect(hostGlobalCapability("fetch")).toBe("denied");
    // Function / FinalizationRegistry 由引擎显式建模（Bug 29 / Bug 43）
    // ⇒ 分类为 allowed（建模面不执行宿主实现）
    expect(hostGlobalCapability("Function")).toBe("allowed");
    expect(hostGlobalCapability("FinalizationRegistry")).toBe("allowed");
    expect(hostGlobalCapability("eval")).toBe("denied");
    expect(hostGlobalCapability("Array")).toBe("allowed");
    expect(hostGlobalCapability("structuredClone")).toBe("allowed");
  });
});

describe("ABS-12 · node: 内建模块能力清单", () => {
  it("宿主 builtinModules 全部在快照里", () => {
    const snapshot = new Set(NODE_BUILTIN_SNAPSHOT);
    const missing = builtinModules.filter((n) => !snapshot.has(n));
    expect(missing, `unclassified node builtins: ${missing.join(", ")}`).toEqual([]);
  });

  it("快照内每个内建恰好归入 allowed / denied 之一", () => {
    const both = NODE_BUILTIN_SNAPSHOT.filter(
      (n) => ALLOWED_NODE_BUILTINS.has(n) && DENIED_NODE_BUILTINS.has(n),
    );
    const neither = NODE_BUILTIN_SNAPSHOT.filter(
      (n) => !ALLOWED_NODE_BUILTINS.has(n) && !DENIED_NODE_BUILTINS.has(n),
    );
    expect(both, `both: ${both.join(", ")}`).toEqual([]);
    expect(neither, `neither: ${neither.join(", ")}`).toEqual([]);
  });

  it("node: 前缀与裸名同口径；只有内建模块 default-deny", () => {
    expect(nodeModuleCapability("node:fs")).toBe("denied");
    expect(nodeModuleCapability("fs")).toBe("denied");
    expect(nodeModuleCapability("node:path")).toBe("allowed");
    // 未列名的“内建形状” default-deny；相对路径 / npm 包不是能力面
    expect(nodeModuleCapability("node:__nudo_not_a_builtin__")).toBe("denied");
    expect(nodeModuleCapability("./local.js")).toBe("allowed");
    expect(nodeModuleCapability("lodash")).toBe("allowed");
  });
});

describe("ABS-12 · 运行期身份拦截覆盖 denied 函数", () => {
  it("denied 函数按**身份**命中（别名 \`const f = BroadcastChannel\` 同样拦）", () => {
    const bc = (globalThis as Record<string, unknown>)["BroadcastChannel"];
    if (typeof bc === "function") {
      expect(neverExecHostName(bc)).toBe("BroadcastChannel");
    }
    expect(neverExecHostName(globalThis.eval)).toBe("eval");
    expect(neverExecHostName(globalThis.Function)).toBeNull();
  });

  it("allowed 函数不被身份拦截（Buffer / structuredClone 由 env 或既有纯函数面处理）", () => {
    expect(neverExecHostName((globalThis as Record<string, unknown>)["Buffer"])).toBeNull();
    expect(neverExecHostName(globalThis.structuredClone)).toBeNull();
    expect(neverExecHostName(globalThis.Array)).toBeNull();
  });
});
