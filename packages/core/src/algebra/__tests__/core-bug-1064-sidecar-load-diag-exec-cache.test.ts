/**
 * Bug 1064 —— 侧车装载失败（`nudo:interface-load`）在 **check 门禁面彻底隐形**
 * ⇒ 门禁假绿（exit 0）。
 *
 * 根因在 core（`packages/core/src/algebra/refine.ts`）：侧车装载诊断在
 * `execSidecar` **内部**产生 ⇒ exec 结果进缓存后，**缓存命中不再跑 exec**
 * ⇒ 该诊断在后续分析里消失。CLI 的固定顺序是「分析器先跑 → checkSource
 * 后跑」⇒ 分析器那轮（冷）拿到诊断、checkSource 那轮（缓存命中）拿不到
 * ⇒ `nudo check` 看不到侧车写坏 ⇒ 门禁绿灯。
 *
 * 修复（core）：装载诊断**随 exec 结果缓存**，每次调用（含缓存命中）重发
 * （与既有「撞名诊断」同口径：作用域内去重 + 每个分析作用域一份新去重表 ⇒
 * 分析器一轮 / checkSource 一轮各拿得到一份）。
 *
 * 注：诊断去重表是**作用域**级的（每个分析作用域一份新表）⇒ 本测试用
 * `runWithCollectorScope` 模拟「两轮分析」（分析器轮 / checkSource 轮）。
 */
import { describe, it, expect } from "vitest";
import {
  execNudoModule,
  resetNudoModuleExecCache,
  takeRefineDiags,
} from "../refine.ts";
import { runWithCollectorScope } from "../collector-scope.ts";

/** 侧车 import 了一个非构建器名 ⇒ 装载期报 nudo:interface-load */
const BAD_SIDECAR = `import { fn, number, totallyBogus } from "@nudojs/core";
export const f = fn({ x: number() });
`;

/** 一个分析作用域内执行一次侧车装载 ⇒ 返回该作用域看到的装载诊断 */
function execInScope(fromFile: string): string[] {
  return runWithCollectorScope(() => {
    execNudoModule(BAD_SIDECAR, { fromFile });
    return takeRefineDiags()
      .filter((d) => d.code === "nudo:interface-load")
      .map((d) => d.message);
  });
}

describe("bug 1064: 侧车装载诊断随 exec 结果缓存（缓存命中时重发）", () => {
  it("第二个分析作用域（exec 缓存命中）仍报 interface-load", () => {
    resetNudoModuleExecCache();
    const fromFile = "/tmp/bug1064/lib.nudo.js";

    const cold = execInScope(fromFile);
    expect(cold.some((m) => m.includes("is not an injected builder"))).toBe(true);

    // 第二轮：exec 缓存命中（不重跑 execSidecar）⇒ 旧实现这里诊断消失
    const warm = execInScope(fromFile);
    expect(
      warm.some((m) => m.includes("is not an injected builder")),
      "缓存命中必须重发装载诊断（否则 check 面看不到侧车写坏）",
    ).toBe(true);
  });

  it("同一作用域内重复装载 ⇒ 诊断只报一次（作用域内去重，不刷屏）", () => {
    resetNudoModuleExecCache();
    const fromFile = "/tmp/bug1064c/lib.nudo.js";
    const msgs = runWithCollectorScope(() => {
      execNudoModule(BAD_SIDECAR, { fromFile });
      execNudoModule(BAD_SIDECAR, { fromFile });
      return takeRefineDiags()
        .filter((d) => d.code === "nudo:interface-load")
        .map((d) => d.message);
    });
    expect(msgs.filter((m) => m.includes("is not an injected builder"))).toHaveLength(1);
  });

  it("resetNudoModuleExecCache 后重新装载 ⇒ 诊断仍可见（不因去重表残留而消失）", () => {
    resetNudoModuleExecCache();
    const fromFile = "/tmp/bug1064b/lib.nudo.js";
    expect(execInScope(fromFile).length).toBeGreaterThan(0);
    resetNudoModuleExecCache();
    expect(execInScope(fromFile).length).toBeGreaterThan(0);
  });
});
