/**
 * assign 通道一致性：mutable 拓宽 + 结构可赋值对账。
 *
 * 从 check.ts 拆出的内聚段：执行态 AbsAssignRecord 进、CheckIssue 出。
 */

import type { AbsAssignRecord } from "./ast-records.ts";
import type { Abs } from "./abs.ts";
import { abs, anyAbs, litValue } from "./abs.ts";
import { joinAbs } from "./objects.ts";
import { leqAbs } from "./leq.ts";
import { formatAbs } from "./format.ts";
import type { CheckIssue } from "./check-report.ts";

/**
 * assign 通道 mutable 拓宽：lit→prim、tuple→arr。
 * 与对象槽同口径（leq.ts「同 prim 字面量视为可赋」）：
 * `let n = 1; n = 2` / `let xs = [1,2]; xs = [3,4,5]` 是合法 JS 可变绑定。
 * 契约字面量（eq pred / lit() 约束）不走本通道，P1-5 仍由 leqAbs 顶层钉住。
 */
// ---------------------------------------------------------------------------
// 赋值一致性（widenForAssign / structuralAssignIssues）
// ---------------------------------------------------------------------------

export function widenForAssign(a: Abs): Abs {
  const s = a.shape;
  if (s.k === "tuple") {
    const holes = new Set(s.holes ?? []);
    const els = s.elements.filter((_, i) => !holes.has(i));
    let el: Abs = anyAbs;
    if (els.length > 0) {
      el = els.map(widenForAssign).reduce((x, y) => joinAbs(x, y));
    } else if (s.rest) {
      el = widenForAssign(s.rest);
    }
    return abs({ k: "arr", element: el }, undefined, undefined, a.conf);
  }
  if (s.k === "obj") {
    const slots: Record<string, { value: Abs; optional?: boolean; readonly?: boolean }> = {};
    for (const [k, slot] of Object.entries(s.slots)) {
      slots[k] = {
        value: widenForAssign(slot.value),
        ...(slot.optional ? { optional: true } : {}),
        ...(slot.readonly ? { readonly: true } : {}),
      };
    }
    return abs(
      {
        k: "obj",
        slots,
        ...(s.index
          ? { index: { key: s.index.key, value: widenForAssign(s.index.value) } }
          : {}),
        ...(s.open ? { open: true } : {}),
      },
      undefined,
      undefined,
      a.conf,
    );
  }
  const lv = litValue(a);
  if (lv !== undefined && a.term?.op === "lit") {
    if (typeof lv === "number") {
      return abs({ k: "prim", type: "number" }, undefined, undefined, a.conf);
    }
    if (typeof lv === "string") {
      return abs({ k: "prim", type: "string" }, undefined, undefined, a.conf);
    }
    if (typeof lv === "boolean") {
      return abs({ k: "prim", type: "boolean" }, undefined, undefined, a.conf);
    }
    if (typeof lv === "bigint") {
      return abs({ k: "prim", type: "bigint" }, undefined, undefined, a.conf);
    }
  }
  return a;
}

/**
 * 结构可赋值：`let a = {x:1}; a = {y:2}` 应报 missing slot x；`let n = 1; n = "str"`
 * （无条件标量改型）报 violation（金标 assign-prim-mismatch-violates）。
 * 输入为执行态收集的赋值记录 AbsAssignRecord（与 scanLiteralCalls 共享一次求值）。
 *
 * 分支/循环体内的重赋值不参与：可变绑定在路径上取并集是合法 JS
 * （特性检测 `if (!x.__proto__) flag = false` 是常见模式），conditional
 * 记录已在 B 通道 $assignRecord 侧标记。
 */
export function structuralAssignIssues(records: AbsAssignRecord[]): CheckIssue[] {
  const out: CheckIssue[] = [];
  for (const r of records) {
    if (!r.prev) continue;
    // 分支/循环体内的重赋值：路径并集是合法 JS（特性检测等模式），不报
    if (r.conditional) continue;
    // 跳过 unknown / never 源（无信息）
    if (r.next.shape.k === "unknown" && !r.next.term) continue;
    if (r.prev.shape.k === "unknown" && !r.prev.term) continue;
    const leq = leqAbs(widenForAssign(r.next), widenForAssign(r.prev));
    if (!leq.ok) {
      out.push({
        severity: "error",
        code: "nudo:assign-mismatch",
        message: `${r.name}: assignment ⊭ existing shape`,
        actual: formatAbs(r.next),
        expected: formatAbs(r.prev),
        suggestion: leq.reason ?? "use a compatible value, or widen the binding type",
        fn: r.name,
        line: r.line,
        column: r.column,
      });
    }
  }
  return out;
}
