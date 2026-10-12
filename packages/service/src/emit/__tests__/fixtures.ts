/**
 * emit 投影测试共享夹具：
 * - BUG-020 tuple 洞构造器（sparse/dense/lead/trail/multi——hole 槽 vs 显式
 *   undefined 槽的区分面，dts / schema 投影测试共用）
 * - 'scale' CallRecord 构造器（跨文件域根记录，interface-emitter /
 *   interface-surface 的注入证据形态）
 * - 小助手：absExact/absUnknown/absUnion（case-emitter 投影面）与
 *   neverAbs/undefLit/litAbs（字面量面）
 */
import { abs as makeAbs, numLit, strLit, boolLit, joinAbs, type Abs } from "@nudojs/core";
import type { CallRecord } from "../../evaluator/call-record.ts";

export function absExact(shape: Abs["shape"]): Abs {
  return makeAbs(shape, undefined, undefined, "exact");
}

export function absUnknown(): Abs {
  return makeAbs({ k: "unknown" }, undefined, undefined, "partial");
}

export function absUnion(members: Abs[]): Abs {
  if (members.length === 0) return absExact({ k: "never" });
  return members.reduce((acc, m) => joinAbs(acc, m));
}

export const neverAbs = (): Abs => makeAbs({ k: "never" }, undefined, undefined, "exact");

export const undefLit = (): Abs =>
  makeAbs({ k: "unknown" }, { op: "lit", value: undefined }, undefined, "exact");

export function litAbs(v: string | number | boolean | null | undefined): Abs {
  if (typeof v === "number") return numLit(v);
  if (typeof v === "string") return strLit(v);
  if (typeof v === "boolean") return boolLit(v);
  if (v === null) return makeAbs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
  return undefLit();
}

// ---- BUG-020 tuple 洞夹具（conf 全部 exact） ----

/** hole 槽（`1 in a` 为 false）：[1, hole, 3] */
export const tupleSparse = (): Abs =>
  absExact({ k: "tuple", elements: [numLit(1), undefLit(), numLit(3)], holes: [1] });

/** 显式 undefined 元素：[1, undefined, 3]（与 sparse 同 elements、无 holes） */
export const tupleDense = (): Abs =>
  absExact({ k: "tuple", elements: [numLit(1), undefLit(), numLit(3)] });

/** 前置洞：[hole, 1] */
export const tupleLead = (): Abs =>
  absExact({ k: "tuple", elements: [undefLit(), numLit(1)], holes: [0] });

/** 后置洞：[1, hole] */
export const tupleTrail = (): Abs =>
  absExact({ k: "tuple", elements: [numLit(1), undefLit()], holes: [1] });

/** 多洞：[hole, 1, hole] */
export const tupleMulti = (): Abs =>
  absExact({ k: "tuple", elements: [undefLit(), numLit(1), undefLit()], holes: [0, 2] });

// ---- 'scale' CallRecord（跨文件域根注入证据） ----

/**
 * 域根导出的跨文件调用记录（interface-emitter §11 验收形态）：
 * number/string/boolean/null|undefined 四臂实参 → numLit(84) 结果。
 */
export function scaleRec(file: string, arg: string | number | boolean | null | undefined) {
  const argAbs =
    typeof arg === "number"
      ? numLit(arg)
      : typeof arg === "string"
        ? strLit(arg)
        : typeof arg === "boolean"
          ? makeAbs({ k: "prim", type: "boolean" }, { op: "lit", value: arg }, undefined, "exact")
          : makeAbs({ k: "unknown" }, { op: "lit", value: arg ?? null }, undefined, "exact");
  return {
    fnName: "scale",
    targetModule: file,
    targetExport: "scale",
    argAbs: [argAbs],
    resultAbs: numLit(84),
    throwsAbs: makeAbs({ k: "never" }, undefined, undefined, "exact"),
    callLoc: { line: 3, column: 0 },
  };
}

/** 测试夹具：Abs CallRecord（analyzer 注入证据通用形态） */
export function absRec(p: {
  fnName: string;
  argAbs: Abs[];
  resultAbs: Abs;
  throwsAbs: Abs;
  callLoc?: { line: number; column: number };
  targetModule?: string;
  targetExport?: string;
  targetAliases?: string[];
}): CallRecord {
  return {
    fnName: p.fnName,
    argAbs: p.argAbs,
    resultAbs: p.resultAbs,
    throwsAbs: p.throwsAbs,
    ...(p.callLoc ? { callLoc: p.callLoc } : {}),
    ...(p.targetModule ? { targetModule: p.targetModule } : {}),
    ...(p.targetExport ? { targetExport: p.targetExport } : {}),
    ...(p.targetAliases ? { targetAliases: p.targetAliases } : {}),
  };
}
