/**
 * BUG-172/173：类实例 brand **重铸**的单一原语。
 *
 * 背景：class 面的 Abs 身份不稳定——`$super` 返回新铸 brand Abs（内层 obj
 * 共享）、`constructClass` 嫁接内建父时返回新 Abs（Error 家族分支）、构造
 * 器 return 替代对象时 `$new` 出口过户。侧表（WeakMap，键 = Abs 对象身份）
 * 不会随值迁移 ⇒ 每个重铸点都要手工过户，漏一处就是 Bug 172/173 事故
 * （规格丢 → 成员查表按名牌串味；标记丢 → 二次 super 守卫失效）。本原语
 * 收敛全部过户面：**新增「重铸 Abs」路径只许走这里，不再每处手动过户**。
 *
 * ── 侧表盘点（过户清单）──────────────────────────────────────────────
 *
 * 过户（与重铸点旧手工面恒等的子集 + 伴随冗余，见各条）：
 * 1. classSpecByValue（class-registry.ts，BUG-172 随值规格）——类值/实例
 *    的定义规格身份。旧手工面：$super 重铸点 carryClassSpec、$new 出口
 *    carryClassSpec(thisVal, inst)，恒等。
 * 2. superCalledMarks（super-access.ts，Bug 245「已调 super」层名集）——
 *    旧手工面：$super 重铸点 markSuperCalled(next, childName)（只补本层）
 *    ⇒ 本原语整集复制（⊇ 只补本层：本层标记重铸前已落 prev）。伴随冗余
 *    （外层标记到达产物）不可观测：superCalledFor 的全部查询点
 *    （$super 二次守卫 / constructClass 出口检查 / assertThisAccessible）
 *    都在构造期，且键是**构造入口的 this 绑定**（constructClass 的 tv），
 *    不是重铸产物；构造完成后标记无查询点。
 *
 * **不过户**（盘点到、逐表裁决不携带，与旧手工面一致——携带反而改语义）：
 * - pendingSuperMarks（super-access.ts，BUG-173「构造中未调 super」）：
 *   构造期瞬时状态，登记/清除都落在**进入构造器体的那个 this 绑定**上
 *   （constructClass 的 tv，finally 保证清除）。重铸产物是 super() **之后**
 *   的值——携带它会让外层层名在 assertThisAccessible 误判（D extends B：B
 *   层重铸产物若带 pending{D} 而标记集缺 D ⇒ `this.b = 1` 假抛
 *   ReferenceError）。产物无 pending 登记 ⇒ this 访问门天然放行（原生语义）。
 * - collections.ts 条目表（mapTables/setTables，键 = Abs 身份）：不可过户
 *   ——这正是 $super「brand 名吻合 ⇒ 不重铸」分支存在的原因（重铸丢表 ⇒
 *   class MyMap extends Map 实例读不到条目）；走到重铸分支时保 brand 名/
 *   内层 obj 的口径已让位于构造语义。
 * - instance-id 新鲜实例标（markFreshInstance，R2b）：每次 new 事件语义，
 *   $new 出口显式重打；fork 快照面走 migrateFreshInstance（obj.ts，RT 域）。
 * - objects.ts 原型记录（setInstanceProto）/ builtins/invariants.ts
 *   extState·propFlags：由各自落点显式重建（$new 出口 setInstanceProto）；
 *   obj.ts 快照分支走 migrateInvariants（RT 域文件，不经本原语）。
 * - class-mark.ts 类值标记（markClassValue）：只落**类值**；本原语的重铸
 *   产物是实例 brand，永非类值。
 * - abs-fn.ts implByAbs / accessors.ts accessorTable / symbol.ts
 *   abstractKeySymbols / declare.ts bindCtorFacets：fn·对象字面量·符号·
 *   bind 产物面，与实例 brand 重铸无交集。
 *
 * ── 重铸点接线（现状）────────────────────────────────────────────────
 *
 * 走本原语：
 * - super.ts $super 出参重铸（原 carryClassSpec + markSuperCalled(next,
 *   childName) 双打点收敛于此）；
 * - declare.ts $new 出口（构造器返回替代对象 / Error·内建父嫁接产物，
 *   原 carryClassSpec(thisVal, inst)）。
 *
 * 不经本原语（非重铸 / 他人地盘，记录在案）：
 * - constructClass 内建父嫁接的 `built.shape = { ...built.shape, name }`：
 *   **原地**改 shape，Abs 身份不变 ⇒ 侧表天然存活（无重铸发生）；
 * - exec/runtime/containers/obj.ts 的 $copy/fork 快照 brand 分支：RT 域
 *   文件，已调 carryClassSpec（+migrateInvariants/migrateFreshInstance），
 *   其手工面与本原语的交集即 carryClassSpec，保持现状不动他人地盘。
 */

import type { Abs } from "../../abs.ts";
import { carryClassSpec } from "../class-registry.ts";
import { carrySuperCalledMarks } from "../super-access.ts";

/**
 * brand 重铸：把 prev 上随 Abs 身份驻留的类面侧表过户到 next（返回 next）。
 * prev 无任何登记时 no-op（非类值/实例、未开构造的普通值）。
 */
export function rebrandClassAbs(prev: Abs, next: Abs): Abs {
  carryClassSpec(prev, next);
  carrySuperCalledMarks(prev, next);
  return next;
}
