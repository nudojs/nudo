/**
 * assign 通道一致性：mutable 拓宽 + 结构可赋值对账。
 *
 * 从 check.ts 拆出的内聚段：执行态 AbsAssignRecord 进、CheckIssue 出。
 */

import type { AbsAssignRecord } from "./ast-records.ts";
import type { Abs } from "./abs.ts";
import type { PrimName } from "./pred.ts";
import { abs, anyAbs } from "./abs.ts";
import { joinAbs } from "./objects.ts";
import { leqAbs } from "./leq.ts";
import { formatAbs } from "./format.ts";
import type { CheckIssue } from "./check-report.ts";
import { DIAG } from "./diag-codes.ts";

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
    // 同 prim 的 sum（路径并集出来的字面量并集，如 `x = cond ? "a" : "b"`
    // 后的 `"a" | "b"`）按 lit→prim 同口径拓宽成该 prim：可变绑定曾持某 prim
    // 的字面量后赋**同 prim** 的任意值是合法 JS（`let s = "a"; s = "c"`）。
    // 不拓宽 ⇒ `leqAbs(prim string, sum{"a","b"})` 恒失败 ⇒ 把「同 prim 改写」
    // 误报成结构违例（Bug 363 配套：函数体赋值面打开后命中 real-package）。
    // 跨 prim 的 sum 保持透传（成员精确对账：`string | number` 与 number 的
    // 关系不是「同 prim 改写」）。
    const prim = samePrimOfSum(s.members);
    if (prim) return abs({ k: "prim", type: prim }, undefined, undefined, a.conf);
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
 * sum 成员是否**同一个 prim**（字面量或已是该 prim）——是则返回该 prim 名。
 * 跨 prim / 非 prim 成员（obj/arr/tuple/brand）→ undefined（保持透传）。
 */
function samePrimOfSum(members: Abs[]): PrimName | undefined {
  let out: PrimName | undefined;
  for (const m of members) {
    const t = primNameOf(m);
    if (!t) return undefined;
    if (out === undefined) out = t;
    else if (out !== t) return undefined;
  }
  return out;
}

/** 单个 Abs 的 prim 名（prim 形状取其 type；字面量按值的 typeof 归类） */
function primNameOf(a: Abs): PrimName | undefined {
  if (a.shape.k === "prim") return a.shape.type;
  const lv = a.term?.op === "lit" ? a.term.value : undefined;
  if (typeof lv === "string") return "string";
  if (typeof lv === "number") return "number";
  if (typeof lv === "boolean") return "boolean";
  if (typeof lv === "bigint") return "bigint";
  return undefined;
}

/**
 * Abs 形状判定：赋值记录的 prev/next 是**转译后的原始运行时值**
 * （transpile 插桩把绑定变量与右值的运行时值原样传给 $assignRecord），
 * 因此**可能不是 Abs**：
 *   - Bug 368：env 全局以 `let k = __nudoEnv[k]` 注入，构造器/函数型全局
 *     （parseInt / String / Promise / setTimeout …）的值是**裸宿主函数**；
 *     顶层 `let g = parseInt;` 把裸宿主函数存进 g ⇒ 重赋值时 prev 不是 Abs。
 *   - Bug 376：函数声明在转译后是普通宿主函数对象 ⇒ 赋值右侧 next 不是 Abs。
 * 读 `.shape` 前必须过这道闸，否则 `r.prev.shape.k` / `r.next.shape.k`
 * 抛 TypeError ⇒ 整轮 `nudo check` 被腰斩（排在后面的文件不再被检查）。
 */
function isAbsLike(v: unknown): v is Abs {
  return (
    !!v &&
    typeof v === "object" &&
    "shape" in (v as object) &&
    "conf" in (v as object)
  );
}

/**
 * 形状视角（shape-only）：只保留 shape，剥掉 term / pred。
 *
 * 族 07 收口片 Z（真实包 `ms` 假阳性）：`nudo:assign-mismatch` 的义务是
 * **形状级**的（诊断自己的措辞就是「assignment ⊭ existing shape」），而
 * `prev.pred` 描述的是**旧值**——真实代码里它常常是**调用点派生的精化事实**
 * （关于**调用方**的变量），**不是**该可变绑定自身的值域约束：
 * `ms@2.1.3` 的 `parse(str) { str = String(str); … }`——
 *   - 新值 `String(str)`：shape `prim string`、**pred 无信息**；
 *   - 旧值 `str`：shape `prim string`、pred `typeof text = "string"`
 *     （来自调用点 `parseAge("2d")` 对**调用方**变量 `text` 的精化）。
 * 两者**形状相同**⇒ 结构上完全可赋值（运行时 `String(str)` 确实是 string），
 * 但 `leqAbs` 还要判 **pred 蕴含** ⇒ 新值没有那条精化 ⇒ 判失败
 * ⇒ 真实包 `ms` 报「assignment ⊭ existing shape」**假阳性**。
 *
 * ⇒ 期望侧只取**形状**。形状改型（`let n = 1; n = "str"` ⇒ `prim string ⊭
 * prim number`）与缺槽（`{y:2}` ⇒ `missing slot x`）仍照旧被抓；
 * 绑定上的**约束**义务归**契约面**（`nudo:constraint-violated`），不归本通道。
 * （slot 内部的 pred 仍按既有口径参与对象槽对账——本通道只剥顶层 pred。）
 */
function shapeOnly(a: Abs): Abs {
  return abs(a.shape, undefined, undefined, a.conf);
}

/**
 * 结构可赋值：`let a = {x:1}; a = {y:2}` 应报 missing slot x；`let n = 1; n = "str"`
 * （无条件标量改型）报 violation（金标 assign-prim-mismatch-violates）。
 * 输入为执行态收集的赋值记录 AbsAssignRecord（与 scanLiteralCalls 共享一次求值）。
 *
 * 分支/循环体内的重赋值不参与：可变绑定在路径上取并集是合法 JS
 * （特性检测 `if (!x.__proto__) flag = false` 是常见模式），conditional
 * 记录已在 eval 通道 $assignRecord 侧标记。
 *
 * 义务是**形状级**的（诊断自己的措辞就是「assignment ⊭ existing shape」）：
 * 期望侧只取 `prev` 的**形状**，`prev.pred` 不参与（见 `shapeOnly`）。
 */
export function structuralAssignIssues(records: AbsAssignRecord[]): CheckIssue[] {
  const out: CheckIssue[] = [];
  for (const r of records) {
    if (!r.prev) continue;
    // Bug 368 / 376：prev/next 可能是裸宿主值（不是 Abs）⇒ 无信息可比，
    // fail-closed 跳过（不判）；不跳过则读 .shape 抛 TypeError 腰斩整轮门禁。
    if (!isAbsLike(r.prev) || !isAbsLike(r.next)) continue;
    // 分支/循环体内的重赋值：路径并集是合法 JS（特性检测等模式），不报
    if (r.conditional) continue;
    // 形参重赋值：JS 形参**没有声明类型**，`prev` 只是本次调用实参的形状
    // （不是绑定的声明的域）。归一化形参是常规写法——yargs 的
    // `global(globals) { globals = [].concat(globals); … }` 在实参为
    // `"_"` 的调用点上 `prev = "_"`、`next = ["_"]` ⇒ 结构检查假阳性
    // （真实域 `string | string[]`）。⇒ 本通道只对**有声明值的绑定**负
    // 义务；形参的实参形状义务归契约 / `nudo:arg-structure` 通道。
    // 标记来自 transpile 插桩：函数体边界把该体形参名表写进 opts.paramNames
    // （见 AbsAssignRecord.paramBinding）。
    if (r.paramBinding === true) continue;
    // 跳过 unknown / never 源（无信息）
    if (r.next.shape.k === "unknown" && !r.next.term) continue;
    if (r.prev.shape.k === "unknown" && !r.prev.term) continue;
    const leq = leqAbs(widenForAssign(r.next), shapeOnly(widenForAssign(r.prev)));
    if (!leq.ok) {
      out.push({
        severity: "error",
        code: DIAG.assignMismatch,
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
