/**
 * 字面量 → 基类型的**唯一**顶层拓宽实现。
 *
 * 返回位（dts `widenReturnAbs` / validator `projection-policy`）共用同一函数：
 * 仅顶层（含 sum 成员）标量字面量退化成基类型，嵌套精度保留；`null` /
 * `undefined` / 对象 / 元组原样保留。此前 `dts-type`、`dts-widen`、
 * `projection-policy` 各有一份逐字复本。
 */
import { abs as makeAbs, type Abs } from "@nudojs/core";

export function widenTopLevelAbs(a: Abs): Abs {
  if (a.shape.k === "sum") {
    const prev = a.shape.members;
    const members = prev.map(widenTopLevelAbs);
    return members.every((m, i) => m === prev[i])
      ? a
      : makeAbs({ k: "sum", members }, undefined, undefined, a.conf);
  }
  return widenLiteralToPrimAbs(a);
}

export function widenLiteralToPrimAbs(a: Abs): Abs {
  if (a.term?.op !== "lit" || a.shape.k !== "prim") return a;
  const v = a.term.value;
  if (
    typeof v === "number" ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    typeof v === "bigint"
  ) {
    const widened = makeAbs(a.shape, undefined, undefined, a.conf);
    return a.facets !== undefined ? { ...widened, facets: a.facets } : widened;
  }
  return a;
}
