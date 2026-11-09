/**
 * Abs 指称守卫（设计 §2.7）：保留 pred。
 *
 * Bug 512：产物落盘为 `<stem>.nudo.guard.ts`——**是 TypeScript 文件**，在
 * strict 工程里必须能过 `tsc --noEmit --strict`。故守卫签名补齐类型标注：
 * 入参 `data: unknown`（守卫接受任意值——这正是「类型守卫」的语义）、
 * 返回 `boolean`。
 *
 * 守卫体是**运行时谓词**（对被检查值做成员读 / 比较 / instanceof），
 * TS 无法静态验证这些动态访问，故体内用一个**按 Abs 形态选出的最窄类型**
 * 承接被检查值：
 * - prim / lit → 该原始类型（精确；顺带让 `data > 5` 这类关系谓词可编译——
 *   关系运算符只接受数值类型，`unknown` / 对象类型都会报 TS2365）；
 * - 结构形态（obj / arr / tuple / brand / eff）→ `Record<string, any>`：
 *   守卫要读**嵌套**成员（`data.inner.k`），槽位的静态类型未跟踪 ⇒ 槽位取
 *   `any`（取 `unknown` 会让 `data.inner.k` 报 TS18046 / TS2339——见
 *   `absToSchemaShape` 的 obj 分支为何要产出成员访问）；
 * - sum → 各成员类型的并集（结构成员在场时并入原始类型并集，否则顶层的
 *   `data === "x"` 报 TS2367「无可比较的重叠」）。
 *
 * 不变量：产物里出现的每个类型名都是 **TS 内建类型名**（不引用用户类名
 * ⇒ 不会 TS2304）；产物**必可编译**（strict）。
 */

import type { Abs, Pred, Slot, Term } from "@nudojs/core";
import { lookupObjAccessor, termEquals, unknown as absUnknown } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";
import { isInvisibleObjSlot } from "./internal-slot.ts";
import { safeExportIdent, widenUncertainLiteral } from "./schema-generator.ts";

/**
 * BUG-130 / BUG-131：把**产物面不可见**的槽从 Abs 树上摘掉，再交给 core 的
 * `denoteGuard`。
 *
 * 判据在 `internal-slot.ts`（symbol 键槽 + 生成器数字下标槽都不可见）。
 * `denoteGuard` 只剔 `internal` 且**保留**规范数组下标的例外 ⇒ 「数字下标承载
 * 元素域」的口径直接落到产物面 ⇒ 守卫要求一个运行时不存在的自有属性
 * （`Object.hasOwn(gen(), "0")` 恒假）⇒ **拒绝被导出函数自己的返回值**。
 *
 * 拷贝是浅层重建 + memo（Abs 是允许成环的 DAG，见 `hasIdentityClause`）：
 * 环上的节点返回同一个副本，不会无限递归。
 */
/**
 * Bug 53：算术**推导**出的数值界在 guard 面整段蒸发（同一次导出的 zod /
 * standard 面保留 `gt 0.9999…`），而 three 面同源两面有界一面无界。
 *
 * 根因在 core `denote.ts` 的 `termIsValue`：它只认 `var` / `lit` /
 * `app(get)`，对算术 app 项（`x + 1`）保守不绑 ⇒ 比较谓词左端不等于
 * "值本身" ⇒ `predAsJs` 落到 `return "true"`。但守卫要检查的值**就是**
 * `x + 1` 的值：左端与 Abs 自身 `term` 同项即可判定（与 `app(get)` 特例
 * 同一口径，见 `denote.ts` 的详细注释）。
 *
 * core 不在本次可修范围 ⇒ 在投影前把这类比较谓词的**左端**规范成
 * `__nudo_self__` var（`termIsValue` 对 var 恒 true）⇒ `predAsJs` 产出
 * `data > 0.9999…`。只改左端，不动 Abs 的 term / shape / 其它 pred
 * ⇒ 不撒谎、不收紧，且与 zod / standard 面同源同界。
 */
function anchorSelfTermPred(p: Pred, term: Term | undefined): Pred {
  if (!term || term.op !== "app" || term.fn === "get") return p;
  switch (p.op) {
    case "and":
    case "or":
      return { ...p, args: p.args.map((x) => anchorSelfTermPred(x, term)) };
    case "not":
      return { ...p, arg: anchorSelfTermPred(p.arg, term) };
    case "gt":
    case "ge":
    case "lt":
    case "le":
      if (p.a.op === "app" && termEquals(p.a, term)) {
        return { ...p, a: { op: "var", id: "__nudo_self__" } };
      }
      return p;
    default:
      return p;
  }
}

function stripInvisibleSlots(a: Abs, memo: Map<Abs, Abs> = new Map()): Abs {
  const hit = memo.get(a);
  if (hit) return hit;
  const copy: Abs = { ...a };
  memo.set(a, copy);
  // Bug 53：见 anchorSelfTermPred——投影前锚定与自身 term 同项的算术比较左端。
  if (copy.pred) copy.pred = anchorSelfTermPred(copy.pred, a.term);
  const s = a.shape;
  switch (s.k) {
    case "obj": {
      const slots: Record<string, Slot> = {};
      for (const [k, slot] of Object.entries(s.slots)) {
        if (isInvisibleObjSlot(k, slot, s.slots)) continue;
        // Bug 104：访问器侧表按 Abs **对象身份**键控（core/accessors.ts 的
        // WeakMap）。这里 `{ ...a }` 克隆后 `accessorReadDomain(copy, k)` 查不到
        // ⇒ `denote.ts` 的 obj 分支回落占位槽 `$lit(void 0)` ⇒ 守卫写成
        // `data.g === undefined`，对函数自己的返回值报假红（standard / zod /
        // dts 都写 3）。克隆前按**原对象**取 getter 读域，把读域烘焙进槽值；
        // getter 抛 ⇒ 读域不可判 ⇒ 落到 `unknown`（只判 presence，与
        // `denote.ts` / dts 面 Bug 191 同口径）。
        let value = slot.value;
        const acc = lookupObjAccessor(a, k);
        if (acc?.get) {
          try {
            value = acc.get(a) ?? value;
          } catch {
            value = absUnknown;
          }
        }
        slots[k] = { ...slot, value: stripInvisibleSlots(value, memo) };
      }
      copy.shape = { ...s, slots };
      break;
    }
    case "arr":
      copy.shape = { ...s, element: stripInvisibleSlots(s.element, memo) };
      break;
    case "tuple":
      copy.shape = {
        ...s,
        elements: s.elements.map((e) => stripInvisibleSlots(e, memo)),
        ...(s.rest ? { rest: stripInvisibleSlots(s.rest, memo) } : {}),
      };
      break;
    case "sum":
      copy.shape = { ...s, members: s.members.map((m) => stripInvisibleSlots(m, memo)) };
      break;
    case "eff":
      copy.shape = { ...s, inner: stripInvisibleSlots(s.inner, memo) };
      break;
    case "brand":
      // Bug 106：class brand 的内层 obj 也须经 service 判据裁剪——否则符号键
      // 槽原样传给 denoteGuard，写成 Object.hasOwn(data, "@@sym#1") 恒假子句
      // ⇒ 守卫拒绝函数自己的返回值（dts / zod / standard 面却放行）。
      copy.shape = { ...s, shape: stripInvisibleSlots(s.shape, memo) };
      break;
    default:
      break;
  }
  return copy;
}

/** 结构形态的动态对象形状（守卫读嵌套成员 ⇒ 槽位取 any）。 */
const DYNAMIC_OBJECT_TYPE = "Record<string, any>";

/** 原始类型并集（sum 里结构成员在场时并入，保证顶层比较可比）。 */
const PRIMITIVE_UNION = "string | number | boolean | bigint | null | undefined";

/** 结构形态判定（守卫体在这些形态上做成员读 / instanceof）。 */
function isStructuralShape(a: Abs): boolean {
  const k = a.shape.k;
  return k === "obj" || k === "arr" || k === "tuple" || k === "brand" || k === "eff";
}

/** 被检查值的 TS 类型（按 Abs 形态取；只出 TS 内建类型名）。 */
function guardValueType(a: Abs): string {
  // lit term 优先：字面量的类型比 shape 更具体（lit(null) 的 shape 是 unknown）
  const t = a.term;
  if (t?.op === "lit") {
    const v = t.value;
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    if (typeof v === "number") return "number";
    if (typeof v === "string") return "string";
    if (typeof v === "boolean") return "boolean";
    if (typeof v === "bigint") return "bigint";
  }
  const s = a.shape;
  switch (s.k) {
    case "prim":
      switch (s.type) {
        case "number":
          return "number";
        case "string":
          return "string";
        case "boolean":
          return "boolean";
        case "bigint":
          return "bigint";
        case "symbol":
          return "symbol";
        default:
          return "unknown";
      }
    case "obj":
    case "arr":
    case "tuple":
    case "brand":
    case "eff":
      return DYNAMIC_OBJECT_TYPE;
    case "sum": {
      const parts: string[] = [];
      let structural = false;
      for (const m of s.members) {
        const mt = guardValueType(m);
        if (!parts.includes(mt)) parts.push(mt);
        if (isStructuralShape(m)) structural = true;
      }
      if (structural && !parts.includes(PRIMITIVE_UNION)) parts.push(PRIMITIVE_UNION);
      return parts.length > 0 ? parts.join(" | ") : "unknown";
    }
    case "never":
      return "never";
    case "any":
    case "unknown":
    default:
      return "unknown";
  }
}

/**
 * 守卫源码：`export function <name>(value: unknown): boolean { … }`。
 *
 * 被检查值在体内以 `data` 承接（`const data = value as <T>`）——`data` 这个
 * 名字是守卫体的既有约定（成员访问 / 比较都落在它上面）。
 *
 * `used`（可选）：**模块内去重集合**——与 zod 面 `safeExportIdent(name, used)`
 * 同一套口径（`isA_bOutput` / `isA_bOutput_2`）。
 *
 * Bug 608：守卫名只过字符清洗（`A.b` → `isA_bOutput`）⇒ **两个不同的源函数
 * 清洗后同名** ⇒ 同一个守卫模块里出现两个 `export function isA_bOutput`
 * （node 下 `SyntaxError: Identifier 'isA_bOutput' has already been declared`、
 * tsc 下 TS2323 / TS2393）。调用方**按模块**（一份守卫产物 = 一个源文件）
 * 传同一个 `used` 集合即可消歧——集合由本函数写入（`safeExportIdent` 的语义）。
 *
 * 不传 `used` 时行为与旧版一致（只清洗、不去重）。
 */
export function generateGuardFunctionFromAbs(name: string, abs: Abs, used?: Set<string>): string {
  // Bug 1008：不确切置信度的字面量观测**不是**出口域 ⇒ 放宽到基类型
  // （否则守卫写成 `data === 1`，把「一次兜底观测」钉成出口域）。
  const widened = widenUncertainLiteral(abs);
  const src = stripInvisibleSlots(widened ?? abs);
  // 2026-11-06：生成器身份子句由 core `denoteGuardB` 递归生成（顶层 + 嵌套
  // 槽值一视同仁），此处不再单独注入 ⇒ 与 zod / standard 面同口径，也不会
  // 在产物里重复两次身份判定。
  const hasIdentity = hasIdentityClause(src);
  const body0 = denoteGuard(src, "data");
  const valueType = guardValueType(src);
  // BUG-250：身份子句会收窄 `data` ⇒ 索引读报 TS7053（见 hasIdentityClause）
  const dataDecl = hasIdentity ? `const data: any = ` : `const data = `;
  // Bug 97：`Array.isArray(data)` 也是一条类型收窄（把 data 收窄成 `any[]`），
  // 即便 data 显式声明为 `: any` 也照样收窄 ⇒ 数组视图（RegExpExecArray）的
  // `index` / `input` / `groups` 读报 TS2551 / TS2339，而 `nudo export` 静默
  // exit 0。把被检查值写成 `data as unknown`（运行时完全等价，但 TS 不再
  // 收窄 data）⇒ 产物在 `tsc --noEmit --strict` 下可编译。只在身份子句在场
  // （data 已降级成 any）时替换 ⇒ 普通数组 / 普通对象产物文本逐字不变。
  const body = hasIdentity
    ? body0.replaceAll("Array.isArray(data)", "Array.isArray(data as unknown)")
    : body0;
  return `export function ${safeExportIdent(name, used)}(value: unknown): boolean {\n  ${dataDecl}value as ${valueType};\n  return ${body};\n}`;
}

/**
 * BUG-250：形态树里是否含**身份子句**（`brand` / `eff` 的 `instanceof`）。
 *
 * 身份子句把被检查值放进 `instanceof` 的**左操作数** ⇒ TS 对它做**类型收窄**
 * ⇒ `data` 的静态类型从 `Record<string, any>` 变成
 * `<内建类型> | Record<string, any>` ⇒ 随后 `data["0"]` 报 **TS7053**（内建
 * 类型上没有该属性）⇒ 产物在 strict 工程里编不过，而 `nudo export` 静默
 * exit 0。声明成 `: any` 后收窄不再限制索引读（`any` 收窄仍是 `any`）。
 */
function hasIdentityClause(a: Abs, seen: Set<Abs> = new Set()): boolean {
  // 求值器产出的 Abs 是**允许成环**的 DAG（DESIGN-001）⇒ 递归必须带 visited，
  // 否则环形结构直接把栈打爆（projection-cycle-depth）。
  if (seen.has(a)) return false;
  seen.add(a);
  const s = a.shape;
  switch (s.k) {
    case "brand":
    case "eff":
      return true;
    case "obj":
      // Bug 97：数组视图（`view: "array"`，RegExpExecArray 等）头部会发
      // `Array.isArray(data)` —— 与 brand / eff 的 `instanceof` 一样是一条
      // 类型收窄来源 ⇒ 必须把 data 降级成 `: any`（随后见
      // generateGuardFunctionFromAbs 里对 Array.isArray 的等价改写）。
      if (s.view === "array") return true;
      return Object.values(s.slots).some((slot) => hasIdentityClause(slot.value, seen));
    case "arr":
      return hasIdentityClause(s.element, seen);
    case "tuple":
      return (
        s.elements.some((el) => hasIdentityClause(el, seen)) ||
        (s.rest !== undefined && hasIdentityClause(s.rest, seen))
      );
    case "sum":
      return s.members.some((m) => hasIdentityClause(m, seen));
    default:
      return false;
  }
}
