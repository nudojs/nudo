/**
 * 族 29 S3 共享探针（node env 声明面 → 调用点行为）。
 *
 * 只用 `@nudojs/core` 的 `$call` / `getFnImpl` + 本包自己的 `defineEnv()`
 * （不引 `@nudojs/service`——那是 service→env 的反向依赖）。
 *
 * 断言口径与 S0 机制层测试（`env-bug-s0-mechanism.test.ts`）一致：
 * - **may-throw** ⇒ 调用点记一条 throw exit（`takeThrowExits()`），不冒泡；
 * - **必抛**（always-throw）⇒ `NudoThrow` 冒泡（`isNudoThrow`）。
 */
import {
  $call,
  getFnImpl,
  isNudoThrow,
  runWithLoopExits,
  takeThrowExits,
  type Abs,
} from "@nudojs/core";
import { defineEnv } from "../node.ts";

/** env 模块表（≡ service 侧 env-loader 的 allModules）。 */
export function nodeEnvModules(): Record<string, Record<string, Abs>> {
  return { ...defineEnv().modules };
}

/** env 模块里的某个成员（如 `node:path` 的 `join`）。 */
export function envMember(mod: string, member: string): Abs {
  const m = nodeEnvModules()[mod]?.[member];
  if (!m) throw new Error(`env module ${mod} has no member ${member}`);
  return m;
}

/** 品牌名（错误品牌 Abs 的品牌名，如 "TypeError" / "Error"）。 */
export function brandName(a: Abs | undefined): string | undefined {
  return a?.shape.k === "brand" ? (a.shape as { name: string }).name : undefined;
}

/** 调用点的结果面：值 / throw exits / 冒泡的异常。 */
export function callSite(
  fn: Abs,
  args: Abs[],
): { value?: Abs; exits: Abs[]; threw?: unknown } {
  return runWithLoopExits(() => {
    try {
      const value = $call(fn, args);
      return { value, exits: takeThrowExits(), threw: undefined };
    } catch (e) {
      return { exits: takeThrowExits(), threw: e };
    }
  });
}

/** apply 的原始返回值（裸 Abs 或带 throws 通道的 AbsApplyResult）。 */
export function applyOut(fn: Abs, args: Abs[]): unknown {
  const impl = getFnImpl(fn);
  if (!impl?.apply) throw new Error("envFn without apply");
  return impl.apply(args);
}

/** fn 形的返回类型（`shape.returnType`）。 */
export function returnTypeOf(fn: Abs): Abs | undefined {
  if (fn.shape.k !== "fn") return undefined;
  return (fn.shape as { returnType?: Abs }).returnType;
}

/** obj 形的槽位表。 */
export function slotsOf(a: Abs): Record<string, { value: Abs }> {
  if (a.shape.k !== "obj") return {};
  return (a.shape as { slots: Record<string, { value: Abs }> }).slots;
}

/** brand 形的内层 shape。 */
export function innerOf(a: Abs): Abs | undefined {
  if (a.shape.k !== "brand") return undefined;
  return (a.shape as { shape: Abs }).shape;
}

/** 恒抛判定辅助：是否 NudoThrow 冒泡。 */
export function threwNudoThrow(threw: unknown): boolean {
  return isNudoThrow(threw);
}
