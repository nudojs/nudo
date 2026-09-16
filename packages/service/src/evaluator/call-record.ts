/**
 * 调用点记录（CallRecord）。Abs 为主（TypeValue 退出后真理源）。
 *
 * argAbs/resultAbs/throwsAbs：无损 Abs（B/Abs 路径必填）。
 * argTypes/resultType/throws：外延 TypeValue 兼容字段（display / 旧消费端）；
 * 构造时由 Abs 桥出，消费端应优先读 Abs。
 */
import type { TypeValue, Abs } from "@nudojs/core";

export type CallRecord = {
  fnName: string;
  /** 无损参数 Abs */
  argAbs: Abs[];
  /** 无损结果 Abs（threw 时为 never） */
  resultAbs: Abs;
  /** 无损抛出值 Abs（未抛为 never） */
  throwsAbs: Abs;
  /** @deprecated 外延投影；优先 argAbs */
  argTypes: TypeValue[];
  /** @deprecated 外延投影；优先 resultAbs */
  resultType: TypeValue;
  /** @deprecated 外延投影；优先 throwsAbs */
  throws: TypeValue;
  /** Line-relative. Per-fn cache replay shifts this by lineDelta — if you
   *  add another position field (callee loc, arg loc), extend
   *  shiftCallRecordLines in analyzer.ts in the same change. */
  callLoc?: { line: number; column: number };
  targetModule?: string;
  targetExport?: string;
  /** export names the same function value was re-exported under after its
   * defining module (barrel `index.js`, CJS forwarding shims); usage-site
   * records stay name-matchable against them */
  targetAliases?: string[];
  /** module whose evaluation created the function value (definition site). */
  fnModule?: string;
};

