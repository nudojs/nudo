/**
 * 公开产物面的**位置投影策略**单一入口。
 *
 * 背景（BUG-370）：同一个观测 Abs 在 dts 面被拓宽成 `number[]`，而 guard /
 * zod / standard 三面固化成 `[1, 2]` ⇒ 同一份产物自相矛盾。此前规则散落在
 * 每个 validator 面；现在所有 validator 的 `<fn>Output` 都经过本模块。
 *
 * 当前策略只覆盖「返回位观测的同构 prim 元组 → 数组」。字面量联合拓宽仍由
 * 各渲染器内部完成（`widenObservedLiteralDomains` / `widenUncertainLiteral`），
 * 因为它们需要把「精度下降」写进各自的 dropped 台账；把这一步上提到这里会
 * 丢失台账证据。
 *
 * 明确不在本模块：
 * - 形参位：`[number, number]` 是作者申报的定长契约，不得拓宽；
 * - 单个标量字面量：契约面测试把 `z.literal(42)` 当作声明域；
 * - 对象/数组元素的递归 widen：需要 provenance（观测 vs case 域）才能安全
 *   上提，见后续阶段。
 */
import type { Abs } from "@nudojs/core";
import { widenAbsPrim } from "../evaluator/call-record.ts";

/**
 * validator 输出面（`<fn>Output`）的投影。
 *
 * 只对**无洞、无 rest、元素同 prim 类型**的观测元组生效；空元组与混合元组
 * 原样返回（空数组由 dts/validator 各自的 `unknown[]` 路径处理）。
 */
export function projectValidatorOutput(a: Abs): Abs {
  return widenHomogeneousPrimTuple(a) ?? a;
}

function widenHomogeneousPrimTuple(a: Abs): Abs | undefined {
  const s = a.shape;
  if (s.k !== "tuple" || (s.holes?.length ?? 0) > 0 || s.rest !== undefined) return undefined;
  const els = s.elements;
  if (els.length === 0) return undefined;
  const first = els[0]!;
  if (first.shape.k !== "prim") return undefined;
  const firstType = first.shape.type;
  if (!els.every((e) => e.shape.k === "prim" && e.shape.type === firstType)) return undefined;
  return {
    ...a,
    shape: { k: "arr", element: widenAbsPrim(first) },
    term: undefined,
    pred: undefined,
    conf: "exact",
  };
}
