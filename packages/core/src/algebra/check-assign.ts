/**
 * assign 通道一致性：mutable 拓宽 + 结构可赋值对账。
 *
 * 从 check.ts 拆出的内聚段：执行态 AbsAssignRecord 进、CheckIssue 出。
 */

import type { AbsAssignRecord } from "./ast-records.ts";
import type { Abs } from "./abs.ts";
import { abs, anyAbs } from "./abs.ts";
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
  if (s.k === "sum") {
    // 全数组成员的 sum（tuple/arr）按 tuple 分支同口径拓宽：join 成单个 arr。
    // 可变绑定曾持数组（长度 0|1 的 push-join 等）后赋任意数组是合法 JS
    // （`let a = cond ? [] : [x]; a = longerArr`）；sum 不拓宽会让 assign
    // 对账拿「无界长度的 filter/map 投影」撞「有界 sum」假 mismatch。
    // 非全数组（obj/prim/brand 混入）保持透传——obj 槽位缺失、标量改型
    // 仍按成员精确对账。
    if (s.members.length > 0 && s.members.every((m) => m.shape.k === "tuple" || m.shape.k === "arr")) {
      // 成员经 tuple/arr 分支拓宽：arr → 取元素；空 tuple → anyAbs（整个并入，
      // 与 tuple 分支空槽同口径）
      const els = s.members.map(widenForAssign).map((w) => (w.shape.k === "arr" ? w.shape.element : w));
      const el = els.reduce((x, y) => joinAbs(x, y));
      return abs({ k: "arr", element: el }, undefined, undefined, a.conf);
    }
    return a;
  }
  if (s.k === "tuple") {
    const holes = new Set(s.holes ?? []);
    const els = s.elements.filter((_, i) => !holes.has(i));
    // rest 槽与固定位同口径并入元素 join：`[1, ...string]` 拓宽不得丢 string 臂
    const parts = els.map(widenForAssign);
    if (s.rest) parts.push(widenForAssign(s.rest));
    const el: Abs = parts.length > 0 ? parts.reduce((x, y) => joinAbs(x, y)) : anyAbs;
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
  // litValue 哨兵：lit(undefined) 读出 undefined，必须直接看 term。
  // null/undefined 字面量无 prim 域（shape=unknown），mutable 拓宽时剥掉
  // lit 钉死（var x; x = 1 / let n = null; n = 1 是合法 JS），
  // 收成裸 unknown——既有形状端可再收任意值，新值端仍不得装进 number 等 prim。
  if (a.term?.op === "lit") {
    const lv = a.term.value;
    if (lv === null || lv === undefined) {
      return abs({ k: "unknown" }, undefined, undefined, a.conf);
    }
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
 * 记录已在 eval 通道 $assignRecord 侧标记。
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
