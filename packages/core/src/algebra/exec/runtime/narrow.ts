/**
 * 空值 / 类型 / 相等 / 关系守卫的臂剪影（narrowing）运行时。
 *
 * 域：转译器在守卫臂内对绑定名做的影子重绑（`exec/transpile/stmt-predicates.ts`
 * 发射、`runtime.ts` facade 转出）：
 * - nullish：`$removeNullish` / `$removeNull` / `$removeUndefined` /
 *   `$removeMemberNullish`——按 term 字面量逐成员剥离 null / undefined
 *   （Bug 3 粒度），`$nullishTest` 产出 `??` / `??=` 的测试值；
 * - typeof：`$narrowTypeOf` 按 typeof 分类剪 union 成员（事实臂 / 补集臂）；
 * - 判别等值：`$narrowMemberEq` 按 key 槽的字面量事实剪成员（issue #126）；
 * - 关系：`$refineRel` 给关系事实臂挂界（Bug 1）。
 *
 * 共享 nullish 谓词：`isNullishLitAbs` / `definitelyNotNullishShape`
 * （surface.ts）与本地 `isNullLitAbs` / `isUndefLitAbs` /
 * `definitelyNullishAbs` 是同一套逐成员判定口径——各剪影的「剪空 → 原样
 * 返回」保守分支都以此为准；其它 runtime 文件不要另造第二套。
 *
 * 本文件不依赖 async / generator 机制（单向：runtime/async.ts 与
 * runtime.ts 只做转出）；新增 narrow 算子放这里，不要回填 async.ts。
 */
import type { Abs } from "../../abs.ts";
import { abs, bool, boolLit, isNumPrim, numLit, strLit } from "../../abs.ts";
import { lit, termEquals } from "../../term.ts";
import { pTrue, and, implies, type Pred, type PrimName } from "../../pred.ts";
import { migrateNullProto, type ObjShape } from "../../objects.ts";
import { refineAbsForRelTrue } from "../../arithmetic.ts";
import { OBJECT_PROTO_METHOD_NAMES, migrateInvariants } from "../../builtins.ts";
import { accessorTable, migrateAccessors } from "../../accessors.ts";
import { leqAbs } from "../../leq.ts";
import { isNullishLitAbs, definitelyNotNullishShape, typeofName } from "../../surface.ts";

/**
 * `??` 非 nullish 臂：从左值 Abs 剥离 nullish 部分（$nullishTest 判 true
 * 的成员）。索引访问 `M[k]` 对抽象键产出 joinAbs(element, undef())，
 * 左值 sum 保留 undefined 臂；`l ?? fallback` 的 alt（非 nullish 路径）
 * 必须只取左值的非 nullish 部分——否则 false-positive `nullish return arm`
 * （issue #90）、`for (const x of o.items ?? [])` 假 may-throw。
 */
export function $removeNullish(a: Abs): Abs {
  // 裸宿主值（非 Abs）：原样透传——调用边界（$fork 臂）经 asAbsVal 收拢，
  // 提前折 unknown 是无谓退化（与 $fork 对缺参/宿主裸值的口径一致）
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (definitelyNotNullishShape(a.shape)) return a;
  if (isNullishLitAbs(a)) return a;
  if (a.shape.k === "sum") {
    const members = (a.shape as { members: Abs[] }).members;
    const kept = members.filter((m) => !isNullishLitAbs(m));
    if (kept.length === members.length) return a;
    if (kept.length === 0) return a;
    return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
  }
  return a;
}

/** 守卫剪除粒度（Bug 3）：null/undefined 成员各自的字面量判定 */
function isNullLitAbs(a: Abs): boolean {
  return a.term?.op === "lit" && a.term.value === null;
}
function isUndefLitAbs(a: Abs): boolean {
  return a.term?.op === "lit" && a.term.value === undefined;
}

/**
 * 严格 `p === null` 守卫的假值臂剪影：只剥 null 成员（Bug 3 粒度——
 * `null === undefined` 为 false，假值臂的 p **仍可能是 undefined**，
 * 不得连 undefined 一起剪，否则 `p.major` 漏报真实 TypeError）。
 */
export function $removeNull(a: Abs): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (isNullLitAbs(a)) return a;
  if (a.shape.k === "sum") {
    const members = (a.shape as { members: Abs[] }).members;
    const kept = members.filter((m) => !isNullLitAbs(m));
    if (kept.length === members.length) return a;
    if (kept.length === 0) return a;
    return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
  }
  return a;
}

/**
 * `typeof u === "undefined"` / 严格 `u === undefined` 守卫的假值臂剪影：
 * 只剥 undefined 成员（`typeof null === "object"`——假值臂的 u 仍可能是
 * null，`u.v` 对 null 仍原生抛 TypeError，不得剪）。
 */
export function $removeUndefined(a: Abs): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (isUndefLitAbs(a)) return a;
  if (a.shape.k === "sum") {
    const members = (a.shape as { members: Abs[] }).members;
    const kept = members.filter((m) => !isUndefLitAbs(m));
    if (kept.length === members.length) return a;
    if (kept.length === 0) return a;
    return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
  }
  return a;
}

/**
 * 成员真值守卫臂剪影（issue #118 / #129）：`if (o.p)` 真值臂 / `if (!o.p)`
 * 假值臂 / `o?.p` 真值守卫里，槽 p 的值必为真值 ⇒ 非 nullish 且槽必在场——
 * 重建 obj slots：槽值过与 $removeNullish 同款成员剥离，并摘除 optional
 * 标记（真值 ⇒ 在场；$get 的 join(value, undef) 随之消失）。槽值剥空（纯
 * nullish）→ 保守原样（臂不可达近似，与 $removeNullish 空集口径一致）；
 * 键缺席 / 非 obj / 裸宿主值 → 透传（同 $removeNullish 契约）。真值 ⇒ 非
 * nullish 是 sound 下界：0/''/false 等 falsy-but-not-nullish 成员保留。
 *
 * sum 容器（issue #129）：判别窄化后参数常为多臂 union——守卫事实按成员
 * 分发：key 槽确定 nullish 的成员（闭 shape 槽缺席且缺席读确定 undefined
 * ——open/index/proto 方法名/getter 均不在场；或槽值整体 nullish）在真值
 * 守卫下必走早退 → 剪除；其余成员按 obj 分支同款重建（重建迁移
 * accessor/propFlags/nullProto 侧表）。open/index 缺席（读 unknown 不可
 * 判）/ proto 方法名与 constructor 缺席（原型链读出函数）/ getter-only
 * 缺席（读 getter 结果）/ any / unknown 槽值 / 非对象成员不可判保留（宁
 * 缺毋假，与 $get 缺席读同口径）。全剪空 → 原样；单成员剪余塌缩（与
 * $narrowMemberEq 同口径）。
 */
export function $removeMemberNullish(a: Abs, key: string): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (a.shape.k === "sum") {
    const members = (a.shape as { members: Abs[] }).members;
    const kept: Abs[] = [];
    let changed = false;
    for (const m of members) {
      const r = memberSlotTruthyRefine(m, key);
      if (r.kind === "prune") {
        changed = true;
        continue;
      }
      if (r.kind === "keep") {
        kept.push(m);
        continue;
      }
      changed = true;
      const sh = m.shape as ObjShape;
      const next: Abs = { ...m, shape: { ...sh, slots: { ...sh.slots, [key]: r.slot } } };
      // 重建产生新 Abs 身份 → 迁移侧表（getter / propFlags / nullProto），
      // 否则守卫后对同对象其它键的 getter 读退化为缺席槽 undefined（$set 同口径）
      migrateAccessors(m, next);
      migrateInvariants(m, next);
      migrateNullProto(m, next);
      kept.push(next);
    }
    if (!changed || kept.length === 0) return a;
    return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
  }
  if (a.shape.k !== "obj") return a;
  const slots = (a.shape as ObjShape).slots;
  if (!Object.prototype.hasOwnProperty.call(slots, key)) return a;
  const r = memberSlotTruthyRefine(a, key);
  // 纯 nullish 槽在单 obj 上无「臂不可达」可表 → 保守原样（与 #118 口径一致）
  if (r.kind !== "refine") return a;
  const next: Abs = { ...a, shape: { ...a.shape, slots: { ...slots, [key]: r.slot } } };
  migrateAccessors(a, next);
  migrateInvariants(a, next);
  migrateNullProto(a, next);
  return next;
}

/** 槽值整体确定 nullish（nullish lit / 全 nullish-lit 成员的 sum） */
function definitelyNullishAbs(a: Abs): boolean {
  if (isNullishLitAbs(a)) return true;
  if (a.shape.k === "sum") {
    const members = (a.shape as { members: Abs[] }).members;
    return members.length > 0 && members.every((m) => isNullishLitAbs(m));
  }
  return false;
}

/** 单成员 key 槽真值守卫分类（issue #129）：
 * - prune：剪除该成员——闭 shape 槽缺席且缺席读确定 undefined（无
 *   open/index/proto 方法名/getter——与 $get 容器读同口径）或槽值整体
 *   确定 nullish 且该键无 getter（占位槽 undefined-lit 不可信，读走
 *   getter）；真值守卫下必 falsy，成员在守卫臂内不可达；
 * - refine：重建该成员的槽——槽值剥 nullish 成员 + 摘 optional 标记
 *   （$get 的 join(value, undef) 消失）；
 * - keep：原样——缺席但缺席读不可判（open/index 读 unknown、proto 方法
 *   名/constructor 原型链读出函数）、键上有 getter（读 getter 结果，真值
 *   性不可判；setter-only 原生读 undefined 除外）/ 槽值非 nullish 且无
 *   optional / 非 obj 成员（保守，与 memberEqClass 的 may 同口径）。
 */
type MemberSlotRefine =
  | { kind: "prune" }
  | { kind: "keep" }
  | { kind: "refine"; slot: { value: Abs; readonly?: boolean } };

function memberSlotTruthyRefine(m: Abs, key: string): MemberSlotRefine {
  if (m.shape.k !== "obj") return { kind: "keep" };
  const slots = (m.shape as ObjShape).slots;
  if (!Object.prototype.hasOwnProperty.call(slots, key)) {
    // 缺席槽 ≠ 读 undefined（与 $get 的 obj 缺席分支同口径，containers.ts）：
    // open/index 签名（读 unknown 不可判）、Object.prototype 方法名与
    // constructor（原型链读出函数，真值守卫必过）、accessorTable getter
    //（读 getter 结果，真值性不可判）→ 保守保留；其余闭缺席 → undefined
    const sh = m.shape as ObjShape;
    if (sh.open || sh.index) return { kind: "keep" };
    if (OBJECT_PROTO_METHOD_NAMES.has(key) || key === "constructor") return { kind: "keep" };
    if (accessorTable.get(m)?.has(key)) return { kind: "keep" };
    return { kind: "prune" };
  }
  // getter 在场：读走 getter 而非数据槽（字面量/defineProperty 的占位槽值
  // 是 undefined-lit，不可信）——真值性不可判 → 保留；setter-only 原生读
  // undefined（与占位口径一致）→ 照常按槽值分类
  if (accessorTable.get(m)?.get(key)?.get) return { kind: "keep" };
  const slot = slots[key]!;
  if (definitelyNullishAbs(slot.value)) return { kind: "prune" };
  let value = slot.value;
  if (!definitelyNotNullishShape(value.shape) && value.shape.k === "sum") {
    const members = (value.shape as { members: Abs[] }).members;
    const kept = members.filter((x) => !isNullishLitAbs(x));
    if (kept.length > 0 && kept.length < members.length) {
      value = kept.length === 1 ? kept[0]! : { ...value, shape: { k: "sum" as const, members: kept } };
    }
  }
  if (value === slot.value && !slot.optional) return { kind: "keep" };
  const next: { value: Abs; optional?: boolean; readonly?: boolean } = { ...slot, value };
  delete next.optional;
  return { kind: "refine", slot: next };
}

/** 成员 → JS typeof 名；any/unknown（无 nullish lit term）不可判 → undefined */
function typeofOfMember(m: Abs): string | undefined {
  const t = m.term;
  if (t?.op === "lit") {
    if (t.value === null) return "object";
    if (t.value === undefined) return "undefined";
  }
  const n = typeofName(m.shape);
  return n === "unknown" ? undefined : n;
}

/**
 * typeof 类型守卫臂剪影（Bug 23）：`typeof v === "string"` 真臂把 v 重绑为
 * union 中 typeof 匹配的成员（keep=true）/ 假臂绑补集（keep=false）——臂内
 * `+`/关系/迭代/模板串拿到成员类型而非 union，不再记假 may-throw。
 * 裸 any 在事实臂窄化为对应 prim（issue #105）；sum 内不可判成员
 * （any/unknown）两侧都保留（保守，不引假阴性）；全剪空 →
 * 原样返回（臂不可达的保守近似，与 $removeNullish 空集口径一致）。
 */
export function $narrowTypeOf(a: Abs, typeOf: string, keep: boolean): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (a.shape.k !== "sum") {
    // 单形态：判定的 typeof 与守卫一致（或补集臂判不一致但值本就单一）
    // 无可剪；不一致属臂不可达，原样返回（保守）。
    // issue #105：裸 any（无约束入口参数）在事实臂（keep=true）可健全窄化为
    // 对应 prim——typeof v === "string" 的真臂里 v 必是 string，exec/test
    // 等 ToString 强转面不再记假 may-throw。补集臂（keep=false）不可表示
    // （"非 string" 覆盖其余全域），保留 any；object/function/undefined 无
    // 单一 Abs 可表（null/数组/函数各有形态），同样保留；unknown 是引擎
    // fail-closed 令牌，窄化会凭空捏造信息，原样返回。
    if (keep && a.shape.k === "any") {
      const p = primShapeOfTypeOf(typeOf);
      if (p) return abs(p, a.term, a.pred, a.conf);
    }
    return a;
  }
  const members = (a.shape as { members: Abs[] }).members;
  const kept = members.filter((m) => {
    const t = typeofOfMember(m);
    if (t === undefined) return true;
    return keep ? t === typeOf : t !== typeOf;
  });
  if (kept.length === members.length) return a;
  if (kept.length === 0) return a;
  return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
}

/**
 * 关系守卫臂剪影（Bug 1）：`x >= 0` 真臂把 x 重绑为带 ge(x,0) 界的 Abs
 * ——守卫建立的隐含约束随**普通变量读取**进入返回值 / 签名面。此前只有
 * 算术折叠消费 exec Φ（`x + 0` 携带界），裸 `return x` 丢守卫事实 →
 * return-constraint gate 假阳（可证合规的函数过不了 CI）。只做事实臂：
 * ¬(x≥0) 含 NaN 可能（NaN 与任何比较皆假），补集界不可健全表示。精确
 * 字面量（lit term）的界由域隶属折叠，不加 pred 保持精确面干净。
 * 只精化 number prim：any 的真臂还含 bigint（`10n >= 0` 为真）与
 * ToPrimitive 对象面，refineAbsForRelTrue 的 number|string 并集会
 * 凭空排除 bigint → 假证明；any/unknown 保持原样（宁缺毋假）。
 */
export function $refineRel(a: Abs, op: "gt" | "ge" | "lt" | "le", k: number): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (a.term?.op === "lit" || !isNumPrim(a) || !a.term) return a;
  return refineAbsForRelTrue(a, op, k);
}

/**
 * 判别联合成员分类（issue #126）：成员 m 在「m.key === lit」事实下可判定的
 * 匹配性。三态：
 * - "only"：槽值域恰为该字面量（pred ⊢ eq(t, lit)）——事实假臂可剪；
 * - "never"：槽值域排除该字面量（pred ⊢ ne(t, lit) / eq(t, litV≠lit) /
 *   形态不容 / 槽缺席（宽容读 undefined ≠ lit））——事实臂可剪；
 * - "may"：不可判（any/unknown 令牌、typeof-only 域、or 域…）——双侧保守保留。
 * 非对象成员：lit term（含 nullish 字面量）上自定义键读出 undefined（nullish
 * 读抛——测试自身记账）→ "never"；其余（prim/tuple/arr/fn/brand/eff 与无
 * lit term 的 unknown）保守 "may"。
 */
type MemberEqClass = "only" | "may" | "never";

/** 同 prim 字面量互斥判定：eq(t, V) 事实下 t === L 为假 ⟺ V ≢ L（NaN ≠ NaN 恒假，同为 never） */
function litRefutesEq(other: unknown, v: string | number | boolean): boolean {
  return other !== v;
}

/** 剥 term/pred 的纯 shape Abs（形态赋值检查口径） */
const shapeOnly = (s: Abs["shape"]): Abs => abs(s, undefined, undefined, "exact");

function memberEqClass(m: Abs, key: string, litAbs: Abs, value: string | number | boolean): MemberEqClass {
  const sh = m.shape;
  if (sh.k === "obj") {
    const slots = (sh as ObjShape).slots;
    if (!Object.prototype.hasOwnProperty.call(slots, key)) {
      // 缺席槽宽容读出 undefined ≠ lit；open 形态缺席键读 unknown → 不可判
      return (sh as ObjShape).open ? "may" : "never";
    }
    const slotValue = slots[key]!.value;
    if (slotValue.shape.k === "any" || slotValue.shape.k === "unknown") return "may";
    if (!leqAbs(shapeOnly(litAbs.shape), shapeOnly(slotValue.shape)).ok) return "never";
    const t = slotValue.term;
    const p = slotValue.pred;
    if (!t || !p || p.op === "true") return "may";
    const litTerm = lit(value);
    if (implies(p, { op: "eq", a: t, b: litTerm })) return "only";
    if (implies(p, { op: "ne", a: t, b: litTerm })) return "never";
    // implies 的字符串/布尔 diseq 盲区：eq(t, litV) 合取事实逐字面量排除
    //（eq(t,'Identifier') ⊢ ne(t,'TemplateLiteral')——跨 prim 亦排除）
    const conjuncts: Pred[] = [];
    const visit = (c: Pred): void => {
      if (c.op === "and") {
        c.args.forEach(visit);
        return;
      }
      conjuncts.push(c);
    };
    visit(p);
    for (const c of conjuncts) {
      if (c.op !== "eq") continue;
      const other =
        termEquals(c.a, t) && c.b.op === "lit" ? c.b.value :
        termEquals(c.b, t) && c.a.op === "lit" ? c.a.value :
        undefined;
      if (other !== undefined && litRefutesEq(other, value)) return "never";
    }
    return "may";
  }
  if (m.term?.op === "lit") return "never";
  return "may";
}

/**
 * 判别等值守卫臂剪影（issue #126）：`x.key === lit` 事实臂（keep=true）内把
 * x 重绑为「key 值域可能等于 lit」的成员子集（剪 "never" 成员）；对偶补集臂
 * （keep=false）剪 "only" 成员。单形态无可剪原样返回；全剪空 → 原样返回
 * （臂不可达的保守近似，与 $removeNullish / $narrowTypeOf 同口径）；
 * 单成员剪余直接返回该成员。
 */
export function $narrowMemberEq(
  a: Abs,
  key: string,
  value: string | number | boolean,
  keep: boolean,
): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (a.shape.k !== "sum") return a;
  const litAbs =
    typeof value === "string" ? strLit(value) :
    typeof value === "number" ? numLit(value) :
    boolLit(value);
  const members = (a.shape as { members: Abs[] }).members;
  const kept = members.filter((m) => {
    const c = memberEqClass(m, key, litAbs, value);
    return keep ? c !== "never" : c !== "only";
  });
  if (kept.length === members.length) return a;
  if (kept.length === 0) return a;
  if (keep) {
    // keep 臂内 `x.key === lit` 事实成立 → 存活成员的兼容槽值挂
    // eq(term, lit) 谓词（lit 在 term/pred 层，shape 保持同型）：
    // formatShape(showLits) 经 litPredValue 渲染 lit(...)（尾臂判别窄化
    // 可见于展示），memberEqClass 升级 only（链式窄化 / 补集臂剪除
    // 受益）。既有谓词合取保留；无 term 的纯声明槽直接落 lit term。
    // any/unknown 槽不收窄（unknown 是推断失败标记 / any 即「无信息」）；
    // keep=false 补集臂无字面量可落（string \ lit 不可表示）。
    const refined = kept.map((m) => {
      const sh = m.shape;
      if (sh.k !== "obj") return m;
      const slots = (sh as ObjShape).slots;
      const slot = slots[key];
      if (!slot) return m;
      const v = slot.value;
      if (v.shape.k === "any" || v.shape.k === "unknown") return m;
      if (!leqAbs(shapeOnly(litAbs.shape), shapeOnly(v.shape)).ok) return m;
      const litTerm = lit(value);
      const value2: Abs =
        v.term !== undefined
          ? { ...v, pred: and(v.pred ?? pTrue, { op: "eq", a: v.term, b: litTerm }) }
          : { ...v, term: litTerm, pred: pTrue };
      return {
        ...m,
        shape: { ...sh, slots: { ...slots, [key]: { ...slot, value: value2 } } },
      } as Abs;
    });
    return refined.length === 1 ? refined[0]! : { ...a, shape: { k: "sum" as const, members: refined } };
  }
  return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
}

/** typeof 结果 → 可健全表示的 prim shape（string/number/boolean/bigint/symbol） */
function primShapeOfTypeOf(typeOf: string): { k: "prim"; type: PrimName } | undefined {
  switch (typeOf) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
      return { k: "prim", type: typeOf };
    default:
      return undefined;
  }
}

/** `??` / `??=` 测试：确定非 nullish → false；lit nullish → true；否则抽象 boolean */
export function $nullishTest(v: Abs): Abs {
  if (definitelyNotNullishShape(v.shape)) return boolLit(false);
  if (isNullishLitAbs(v)) return boolLit(true);
  const t = v.term;
  if (t?.op === "lit" && t.value !== null && t.value !== undefined) return boolLit(false);
  return bool();
}
