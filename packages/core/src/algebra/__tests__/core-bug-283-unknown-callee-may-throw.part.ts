/**
 * Bug 283：**`unknown` 形状的被调者**不在可调用判定表内。
 *
 * ## 裁决（按 oracle 改判 · 主 agent 2026-10-23）
 *
 * 原始报告的修法是「`$callDispatch` 的判定表补 `unknown` 档 ⇒ 记
 * `may TypeError`（与 `any` 档同口径）」。**本钉已改判为守护钉**，因为
 * 该修法被 oracle 证伪：
 *
 * 1. **报告的症状本来就不走这条路径** —— 报告的 P1 夹具是 `o.a.b()`
 *    （成员调用），实测**成员调用走 `exec/class/invoke.ts` 的 `$invokeInner`**，
 *    **从不进 `$callDispatch`** ⇒ 在 `$callDispatch` 记账修不到报告的症状。
 * 2. **该修法对普通代码是假阳性** —— `unknown` 是引擎的 **fail-closed 令牌**，
 *    只说明「引擎不知道被调者」，**不说明「它不是函数」**。实测三类形态：
 *    - `import { add2 } from "./add.js"`（**add2 存在**）+ `add2(x)`
 *      ⇒ 引擎把导入绑定折成 unknown Abs ⇒ 记 TypeError ⇒
 *      `nudo check` 对**合法代码**报 `nudo:entry-may-throw`（error 级）⇒ **假阳性**；
 *    - 未解析的导入绑定 ⇒ 原生是**模块装载错误**（不是调用点 TypeError）⇒ 错记；
 *    - `any` 档 ⇒ 「无约束值」（可能是非函数）⇒ 记 may 是对的 ⇒ **两个档必须分开**。
 * 3. **报告的症状已被成员读侧覆盖** —— 实测「成员缺失」（`o.a.b()` 在 number
 *    接收者上）⇒ 读侧产出 error 级 `nudo:entry-may-throw` ⇒ **283 无需额外记账**。
 *
 * ⇒ **最终口径**：`$call(unknown)` **不记** may-throw（引擎不知道 ≠ 不是函数）；
 * 值域仍折 `unknown`；`nudo:opaque-result` 诚实报出这层精度债。
 *
 * 遗留（不在本族）：「成员存在但接收者形态不对」（如 `o.toFixed()` 在 number 上
 * ⇒ 原生定抛，引擎不报）—— 成员调用面的记账缺口，落点在 `exec/class/invoke.ts`。
 */
import { describe, it, expect } from "vitest";
import { abs, $call } from "@nudojs/core";
import { effects } from "./eval-helpers.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../exec/may-throw.ts";

function collectEffects(fn: () => unknown): MayThrowEffect[] {
  const eff: MayThrowEffect[] = [];
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => eff.push(e));
    try {
      fn();
    } catch {
      /* NudoThrow 由调用边界收成 throws，不进效果列表 */
    }
    setMayThrowCollector(null);
  });
  return eff;
}

describe("Bug 283: unknown callee **不**记 may-throw（引擎令牌 ≠ 不是函数）", () => {
  it("$call(unknown) → 不记 TypeError 效果（守卫：防止再被当成「不是函数」）", () => {
    const unknownCallee = abs({ k: "unknown" }, undefined, undefined, "path");
    expect(collectEffects(() => $call(unknownCallee, [])).length).toBe(0);
  });

  it("$call(unknown) → 值域保持 unknown", () => {
    const r = $call(abs({ k: "unknown" }, undefined, undefined, "path"), []);
    expect(r.shape.k).toBe("unknown");
  });

  it("对照：any callee → 记 TypeError（any 是「无约束值」，与 unknown 档必须分开）", () => {
    const anyAbs = abs({ k: "any" }, undefined, undefined, "path");
    expect(collectEffects(() => $call(anyAbs, [])).map((e) => e.kind)).toContain("TypeError");
  });

  it("283 的报告症状（成员缺失）→ 由成员读侧覆盖：记 TypeError", () => {
    // 成员调用走 `exec/class/invoke.ts` 的 $invokeInner（不进 $callDispatch）⇒
    // 读侧在成员缺失时产出 error 级 nudo:entry-may-throw。
    expect(
      effects(
        `export function f() {
  const o = 1;
  return o.a.b();
}
`,
        "f",
      ),
    ).toContain("TypeError");
  });

  it("守卫：导入绑定被调（引擎折成 unknown）→ 不记 TypeError（否则对合法代码假阳性）", () => {
    // 导入绑定在引擎里折成 unknown Abs（形状未知）⇒ 不得升级成 L2 error。
    // 实测（oracle）：这条路径在 HEAD 上会记 TypeError ⇒ 是本族的假阳性来源。
    expect(
      effects(
        `import { add2 } from "./add.js";
export function f(x) {
  return add2(x);
}
`,
        "f",
      ),
    ).not.toContain("TypeError");
  });

  it("守卫：本地函数被调 → 不记 TypeError（普通代码路径不受影响）", () => {
    expect(
      effects(
        `export function f() {
  const g = (x) => x + 1;
  return g(1);
}
`,
        "f",
      ),
    ).not.toContain("TypeError");
  });
});
