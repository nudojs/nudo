/**
 * 族 29 · S4 共享测试助手（env 包）。
 *
 * 只服务 `env-bug-<编号>-<slug>.test.ts`（族 29 S4 的 7 条 bug）：
 * - `callSite`：调用点取证（值 / may-throw exits / 冒泡的 NudoThrow）；
 * - `brandName` / `thrownBrand`：错误品牌名（TypeError / AssertionError / RangeError …）。
 *
 * 口径与 core 的 throws 通道一致：
 * - **may-throw**（原生在该实参域上可能抛）⇒ 调用点记一条 throw exit，**不冒泡**；
 * - **必抛**（原生在该实参上确定抛）⇒ abs 面 = never ⇒ NudoThrow 冒泡。
 */
import {
  $call,
  isNudoThrow,
  runWithLoopExits,
  takeThrowExits,
  type Abs,
} from "@nudojs/core";

/** 错误品牌名（brand 的 name，如 "TypeError" / "AssertionError"） */
export function brandName(a: Abs | undefined): string | undefined {
  return a?.shape.k === "brand" ? (a.shape as { name: string }).name : undefined;
}

/** NudoThrow 携带的错误品牌名（非 NudoThrow ⇒ undefined） */
export function thrownBrand(e: unknown): string | undefined {
  if (!isNudoThrow(e)) return undefined;
  return brandName((e as { absValue: Abs }).absValue);
}

/** 调用点取证 */
export function callSite(
  fn: Abs,
  args: Abs[],
): { value?: Abs; exits: Abs[]; threw?: unknown } {
  return runWithLoopExits(() => {
    try {
      const value = $call(fn, args);
      return { value, exits: takeThrowExits() };
    } catch (e) {
      return { exits: takeThrowExits(), threw: e };
    }
  });
}
