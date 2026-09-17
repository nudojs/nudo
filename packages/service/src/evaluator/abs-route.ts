/**
 * Abs 代数辅助（TypeValue 路由已删）。
 * 对象 join / phi 再导出；二元/一元 TypeValue 路由随 TypeValue 评估器退出。
 */

import {
  type Abs,
  joinAbs as kJoinAbs,
  currentPhi,
  pushPhi,
  popPhi,
  resetPhi,
  withPhiConstraint,
  describePhi,
} from "@nudojs/core";

export { currentPhi, pushPhi, popPhi, resetPhi, withPhiConstraint, describePhi };

/**
 * 对象 join（异 key 保持 sum，不折 optional）。
 * 非 obj 或 join 失败 → undefined。
 */
export function tryAbsJoinObjects(a: Abs, b: Abs): Abs | undefined {
  if (a.shape.k !== "obj" || b.shape.k !== "obj") return undefined;
  try {
    return kJoinAbs(a, b);
  } catch {
    return undefined;
  }
}
