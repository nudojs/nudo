/**
 * 数值界蕴含（leaf）：gt/ge/lt/le 单比较 Pred 的界宽窄判定。
 *
 * L1 的两条证明通道共用同一实现（`leq.ts` 的 leqPred 与 `postcondition.ts`
 * 的 assertScalar）：各留一份私有副本会让「可赋值（≤）」与「后置可证（⊨）」
 * 对同一条边界给出不同结论（`x>5 ⊨ x>0` 与 `x>5 ≤ x>0` 必须同真同假）。
 */

import type { Pred } from "./pred.ts";
import type { Term } from "./term.ts";
import { termEquals } from "./term.ts";

/** gt/ge/lt/le 单比较 pred（a/b 两侧均为 Term） */
type CmpPred = Extract<Pred, { op: "gt" | "ge" | "lt" | "le" }>;

const isCmpPred = (p: Pred): p is CmpPred =>
  p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le";

/** 数值界蕴含：src 的界更紧则可赋给更宽 tgt（x>5 ⇒ x>0） */
export function numericBoundsImply(src: Pred, tgt: Pred): boolean {
  if (!isCmpPred(src) || !isCmpPred(tgt)) return false;
  if (src.op !== tgt.op) {
    // gt ⇒ ge；lt ⇒ le
    if (src.op === "gt" && tgt.op === "ge") {
      return sameTermSide(src, tgt) && litGE(src.b, tgt.b);
    }
    if (src.op === "lt" && tgt.op === "le") {
      return sameTermSide(src, tgt) && litLE(src.b, tgt.b);
    }
    return false;
  }
  if (!sameTermSide(src, tgt)) return false;
  const sb = src.b.op === "lit" ? src.b.value : undefined;
  const tb = tgt.b.op === "lit" ? tgt.b.value : undefined;
  if (typeof sb !== "number" || typeof tb !== "number") return false;
  if (src.op === "gt" || src.op === "ge") {
    return sb >= tb; // 更大的下界 ⇒ 更小的下界
  }
  return sb <= tb; // 更小的上界 ⇒ 更大的上界
}

function sameTermSide(a: CmpPred, b: CmpPred): boolean {
  // termEquals 走结构比较，避免 sum×sum 场景 JSON.stringify 爆炸
  return termEquals(a.a, b.a);
}

function litGE(a: Term, b: Term): boolean {
  if (a.op !== "lit" || b.op !== "lit") return false;
  return (
    typeof a.value === "number" &&
    typeof b.value === "number" &&
    a.value >= b.value
  );
}

function litLE(a: Term, b: Term): boolean {
  if (a.op !== "lit" || b.op !== "lit") return false;
  return (
    typeof a.value === "number" &&
    typeof b.value === "number" &&
    a.value <= b.value
  );
}
