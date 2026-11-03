/**
 * 类构造/查找期（自 declare.ts 拆出；定义期 $class 留在 declare.ts，本文件
 * 的导出经 declare.ts 尾部 facade re-export 维持既有 import 面）：
 * - 构造：$new（[[Construct]] 全形态派发：用户类 / 宿主构造器 / 内建 /
 *   fn Abs / bind 产物 / Proxy 陷阱）/ constructClass（继承链构造 +
 *   super() 门）/ applyInstanceFields（实例字段落地）；
 * - 查找：specOf / findMethod / findStaticMethod / chainHasStaticMember /
 *   instanceOwnFaceHasMember / deleteProtoMethod；
 * - Bug 253 bind 产物 [[Construct]] facet 侧表（bindCtorFacets——本文件
 *   模块级 WeakMap；定义期的 wellKnownSymbolKeys 在 declare.ts，各一份）。
 *
 * 类域 Invariants（随值携带 spec / 实例字段就地突变 / ctor 帧）见
 * declare.ts 头注释——两期共享，此处不重复。
 */
import type { Abs } from "../../abs.ts";
import { abs, unknown, never, litValue, strLit, isAbsLike } from "../../abs.ts";
import { objOf, getSlot, setSlot, setInstanceProto } from "../../objects.ts";
import { markFreshInstance } from "../../instance-id.ts";
import { hostBuiltinCtorOf, evalClassChain } from "../runtime/members.ts";
import {
  protoBrandAbs,
  extStateOf,
  getPropFlags,
  setPropFlags,
  errorBrandAbs,
  isErrorCtorName,
  evalBuiltinNew,
  builtinCtorNameOf,
  hostBuiltinCtorName,
  makeProxyAbs,
  makeArrayCtorAbs,
  evalPromiseCtor,
  evalRegExpCtor,
  evalDateCtor,
  makeDynamicFunctionAbs,
  makeBoxedAbs,
  makeUrlAbs,
  makeTextDecoderAbs,
  makeUrlSearchParamsAbs,
  makeArrayBufferAbs,
  makeSharedArrayBufferAbs,
  makeDataViewAbs,
  makeTypedArrayAbs,
  makeWeakRefAbs,
  makeFinalizationRegistryAbs,
} from "../../builtins.ts";
import { makeMapAbs, makeSetAbs, ctorArgDefinitelyInvalid, makeWeakCollectionAbs } from "../../collections.ts";
import { typedArrayElementOf } from "../../builtins/shared.ts";
import { $set, asAbsVal, callAtFunctionBoundary, clearStaleTermPred, NudoThrow } from "../runtime.ts";
import { pushCtorFrame, popCtorFrame, withNewTargetReset, throwStrictWrite } from "../runtime/state.ts";
import { $call } from "../call.ts";
// 直连 calls.ts（不经 barrel）：原单文件（declare.ts）拓扑中本导入伴随
// 「模块体加载期即回调 setter」的 vite SSR barrel 再导出陷阱注释——构造期
// 代码移入本文件后沿用直连口径（与 invoke-arr.ts 的同类注释同源）。
import { evalEnterCall, evalExitCall, evalTruncatedAbs, isHostGlobalFn, blockHostSideEffect } from "../calls.ts";
import { getFnImpl, absFunction, hostFnCtorFacet, isAbsApplyResult } from "../../abs-fn.ts";
import { isDefinitelyUndefinedAbs } from "./this-member.ts";
import { proxyPartsOf, proxyTrapOf } from "../match-iter.ts";
import { errorTypeAbs, recordMayThrow } from "../may-throw.ts";
import {
  registerEvalClass,
  getEvalClass,
  lookupClassValue,
  classSpecOfAbs,
  attachClassSpec,
  ensureFnParentName,
  resolveChainSpec,
  type EvalClassSpec,
} from "../class-registry.ts";
import { rebrandClassAbs } from "./rebrand.ts";
import { notePendingSuper, clearPendingSuper, superCalledFor } from "../super-access.ts";

/** 类值/实例 → 定义 spec 的身份查询（BUG-172：侧表在 class-registry.ts） */
function isDeclaredClassValue(v: object): boolean {
  return classSpecOfAbs(v as Abs) !== undefined;
}

/**
 * Bug 253：bind 产物的 [[Construct]] facet（**模块级 WeakMap 侧表**）。
 *
 * 原生：`new (f.bind(thisArg, ...bound))()` 走**绑定目标的 [[Construct]]**
 * ——以 newTarget.prototype 建新实例、绑定实参前置、`this` = 新实例（**忽略**
 *   绑定的 thisArg）；普通调用 `f.bind(thisArg)(...)` 才用绑定的 thisArg。
 * 引擎此前 bind 产物只带 apply 钩子 ⇒ `$new` 复用 `impl.apply(args, thisVal)`
 *   ⇒ 目标构造器在 `this === boundThis`（常为 null）上执行 ⇒ `new B()` 假抛
 *   TypeError。
 *
 * 选型理由（AGENT-CONTEXT §4 指定）：`AbsFnImpl` 是**公共类型**（algebra/
 *   index.ts + core/src/index.ts 导出）⇒ 不加 `construct` 成员；改用模块级
 *   WeakMap 侧表承载「bind 产物可构造」，零公共类型面改动。
 */
export type BindCtorFacet = {
  /** 新实例的 brand 名（取自绑定目标——原生实例属目标构造器）。
   *  惰性求值：伪父名注册 / 空 spec 注册的副作用不进 bind 期。 */
  instName: () => string;
  /** 新实例的 [[Prototype]]（绑定目标的 prototype 载体；不可知时 undefined） */
  proto: () => Abs | undefined;
  /** [[Construct]]：以新实例为 this、绑定实参前置调目标构造器 */
  construct: (instance: Abs, args: Abs[]) => Abs;
};

const bindCtorFacets = new WeakMap<object, BindCtorFacet>();

/** 登记 bind 产物的构造 facet（invoke.ts 的 bind 臂调用） */
export function markBindCtorFacet(fn: Abs, facet: BindCtorFacet): void {
  if (!fn || typeof fn !== "object") return;
  bindCtorFacets.set(fn as object, facet);
}

/** 读 bind 产物的构造 facet（非 bind 产物 ⇒ undefined） */
export function bindCtorFacetOf(fn: Abs): BindCtorFacet | undefined {
  if (!fn || typeof fn !== "object") return undefined;
  return bindCtorFacets.get(fn as object);
}

/**
 * Bug 250：原生 [[Construct]] 的返回值判定——「返回值是 Object 就用它」。
 *
 * 引擎此前只认 `brand|obj` 两个形态 ⇒ 构造器返回**数组 / 函数 / Promise**
 * 时被静默换回 `this`（`new F()` 返回数组却折成空实例：`Array.isArray`
 * 假 false、`instanceof F` 假 true）。对象形态全集：obj / arr / tuple /
 * fn / brand（类实例）/ eff（Promise）——`prim` / nullish 不是对象。
 */
function isObjectLikeAbs(v: Abs | undefined | null): boolean {
  if (!isAbsLike(v)) return false;
  const k = (v as Abs).shape.k;
  return (
    k === "brand" || k === "obj" || k === "arr" || k === "tuple" || k === "fn" || k === "eff"
  );
}

/**
 * Bug 257：IsConstructor(target) 判定——靶是否**可构造**。
 * true = 可构造；false = 确定不可构造；undefined = 不可判。
 *
 * 判据（复用既有机制，不重造）：
 * - 宿主函数：`hostFnCtorFacet`（Bug 9 机制）——false = 箭头 / 方法 /
 *   generator / async（原生 IsConstructor 恒 false）；undefined = 未知。
 * - fn 形 Abs：`shape.ctor` 旗标（Bug 9 机制）——true 可构造 / false 不可 /
 *   缺省不可判。
 * - brand 形 Abs：`ctor:true` = 类值（可构造）；其余 brand = 实例 / 原型
 *   对象（原生 IsConstructor 恒 false）。
 * - obj / arr / tuple / prim：恒不可构造。
 */
function ctorFacetOfTarget(t: Abs | undefined): boolean | undefined {
  if (typeof t === "function") {
    const facet = hostFnCtorFacet(t as (...a: unknown[]) => unknown);
    if (facet === false) return false;
    if (facet === true) return true;
    return undefined;
  }
  if (!isAbsLike(t)) return false;
  const sh = (t as Abs).shape;
  if (sh.k === "fn") {
    if (sh.ctor === true) return true;
    if (sh.ctor === false) return false;
    return undefined;
  }
  if (sh.k === "brand") {
    // 代理靶：代理本身的可构造性随**被代理的靶**（ProxyCreate 只在靶可
    // 构造时装 [[Construct]]）——递归一层（原生代理链可嵌套）。
    if (sh.name === "Proxy") {
      const parts = proxyPartsOf(t as Abs);
      if (!parts) return undefined;
      return ctorFacetOfTarget(parts.target);
    }
    return sh.ctor === true;
  }
  if (sh.k === "obj" || sh.k === "arr" || sh.k === "tuple" || sh.k === "prim") return false;
  return undefined;
}

/**
 * Bug 205：fn Abs 构造器的实例 [[Prototype]]（构造期捕获用）。
 *
 * - 宿主函数 **facade**（member.ts 的 `$set` 宿主函数臂建）：其
 *   "prototype" 槽即被替换后的新原型——实例的 [[Prototype]] 就是它
 *   （原生 `F.prototype = {}` 之后 `new F()` 的实例原型是新对象）。
 * - 其它 fn Abs（$fnVal 函数表达式 / env 构造器）：按名 protoBrandAbs
 *   （与 evalProtoChain / `f.prototype` 读同一载体）。
 */
export function fnAbsCtorProtoOf(cls: Abs, instName: string): Abs {
  const sh = cls.shape;
  if (sh.k === "fn" && sh.slots) {
    const slot = getSlot(sh.slots, "prototype");
    if (slot) return slot.value;
  }
  return protoBrandAbs(instName);
}

/**
 * Bug 90：spec 记录读点的 own-property 取值（第二道，防御纵深）——
 * 非 $class 注册面（手写/mock spec）仍可能携带普通对象记录，派发关键
 * 读点直接判自有键，与 ownRec 双保险。
 */
function ownMember<T>(rec: Record<string, T> | undefined, key: string): T | undefined {
  return rec !== undefined && Object.hasOwn(rec, key) ? rec[key] : undefined;
}

export function specOf(cls: Abs): EvalClassSpec | undefined {
  const mounted = classSpecOfAbs(cls);
  if (mounted) return mounted;
  if (cls.shape.k === "brand") return getEvalClass(cls.shape.name);
  return undefined;
}

/** 沿继承链找方法 */
export function findMethod(
  startName: string,
  method: string,
  startSpec?: EvalClassSpec,
): ((thisVal: Abs, ...args: Abs[]) => Abs) | undefined {
  let cur: string | undefined = startName;
  const seen = new Set<string>();
  // BUG-172 继承链图化：首环用接收者**随身携带的规格**（跨模块同名类不串
  // 味；名字吻合才用）；其余环优先沿 superSpec **引用链**（定义期解析的
  // 父规格身份），无引用的环（内建父 / fn 伪父 / 手写注册面）才按
  // superName 名牌回表（display 与兑底同源）。环名序列不变。
  let pending: EvalClassSpec | undefined = startSpec;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    // 双查点优先序：superSpec 引用 → superName 名牌回表（游标原语见
    // class-registry.ts resolveChainSpec；显式注解断 TS7022 推断环）
    const spec: EvalClassSpec | undefined = resolveChainSpec(cur, pending);
    pending = spec?.superSpec;
    // Bug 90：own-property 取值——宿主 Object.prototype 继承名不得命中
    const m = ownMember(spec?.methods, method);
    if (m) return m;
    cur = spec?.superName;
  }
  return undefined;
}

/**
 * Bug 194：原型方法删除钩子——`delete X.prototype.m` 从**方法注册表**移除
 * 该方法（原生：类方法就是原型对象的**自有属性**，delete 后原型上（及沿
 * 原型链继承它的派生类原型上）都没有该方法）。
 *
 * 注册表 `spec.methods` 是引擎方法面的单一事实源——移除条目后三面同步缺席：
 * - 读面（containers/member.ts 沿类链查 `spec.methods`）；
 * - 调用面（`findMethod`）；
 * - in 面（`brandHasProtoMember` 查 `spec.methods`）。
 *
 * **接线点在 `runtime/members.ts` 的 `$del`**（S1 的文件，本片不改）：删除
 * 的接收者是 `.prototype` brand（`A.prototype`）时，按名取 owner 类并调用
 * 本函数。原型对象上本就没有该方法的槽（方法在注册表里），`$del` 只删槽
 * ⇒ 删除事件此前**不留任何痕迹**（注册表侧无人通知）——这正是本钩子的
 * 存在理由。原生 `delete` 的返回值恒 true（与是否命中无关），故本函数只
 * 报告「是否确有该方法条目」。
 */
export function deleteProtoMethod(ctorName: string, key: string): boolean {
  const spec = getEvalClass(ctorName);
  if (!spec?.methods || !Object.hasOwn(spec.methods, key)) return false;
  delete spec.methods[key];
  return true;
}

/**
 * Bug 260：类值 **own 静态槽**（静态字段 `static m = 2` / 动态写 `C.m = v`）。
 *
 * 原生属性查找序是 own → [[Prototype]] 链：派生类自己声明的同名静态字段
 * **遮蔽**继承的静态方法（`class A { static m(){} } class B extends A
 * { static m = 2 }` ⇒ `B.m` 是 own 静态字段 `2`，`B.m()` 原生抛
 * `TypeError: B.m is not a function`，此前引擎沿链调到 A.m()）。
 *
 * 槽位取自类值内层 obj 槽（静态字段的落点，与读面
 * `runtime/containers/member.ts` 的 own 槽读同一载体）。
 */
function ownStaticSlotOf(className: string, key: string): Abs | undefined {
  const cv = lookupClassValue(className);
  if (!cv) return undefined;
  const inner = cv.shape.k === "brand" ? (cv.shape as { shape?: Abs }).shape : undefined;
  if (inner?.shape.k === "obj") {
    const slot = getSlot(inner.shape.slots, key);
    if (slot && !slot.optional) return slot.value;
  }
  // fn 伪父（宿主/函数表达式构造器）的 expando 静态槽
  if (cv.shape.k === "fn" && cv.shape.slots) {
    const fslot = getSlot(cv.shape.slots, key);
    if (fslot && !fslot.optional) return fslot.value;
  }
  return undefined;
}

/** 静态槽值是否**确定**非可调用（原生 `B.m is not a function` 的前提） */
function staticSlotDefinitelyNotCallable(v: Abs): boolean {
  const k = v.shape.k;
  if (k === "fn") return false;
  // brand：ctor 类值可调用；实例 brand（new Map()）不可调用
  if (k === "brand") return (v.shape as { ctor?: boolean }).ctor !== true;
  // 抽象值（unknown / any）：不可证非可调用 → 保守不抛
  if (k === "unknown" || k === "any") return false;
  return true;
}

/** 沿继承链找静态方法（Bug 18）：原生静态方法挂构造器 [[Prototype]] 链
 *  （ClassDefinitionEvaluation 设 B.__proto__ = A）——空派生类
 *  `class B extends A {}` 的 B.m() 不得断链（与 findMethod 实例链同口径）。
 *  Bug 260：每级先查**类值 own 静态槽**（静态字段 / 动态写）——原生 own
 *  属性优先于链上的继承静态成员。 */
export function findStaticMethod(
  startName: string,
  method: string,
  startSpec?: EvalClassSpec,
): ((thisVal: Abs, ...args: Abs[]) => Abs) | undefined {
  let cur: string | undefined = startName;
  const seen = new Set<string>();
  // BUG-172 继承链图化：双查点优先序——每环先用上一环 superSpec 引用
  //（定义期父规格身份；名字吻合才用，类值接收者的随身规格作首环），
  // 无引用的环才按 superName 名牌回表（display 与兑底同源）。
  let pending: EvalClassSpec | undefined = startSpec;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    // 显式注解断开推断环（TS7022：superSpec 引用链上 pending↔spec 循环
    // 推断）；游标原语见 class-registry.ts resolveChainSpec
    const spec: EvalClassSpec | undefined = resolveChainSpec(cur, pending);
    pending = spec?.superSpec;
    // Bug 260：own 静态槽遮蔽继承的静态方法
    const own = ownStaticSlotOf(cur, method);
    if (own !== undefined) {
      // 槽值可调用 → 调用它（this = 类值，与静态方法同口径）
      if (
        own.shape.k === "fn" ||
        (own.shape.k === "brand" && (own.shape as { ctor?: boolean }).ctor === true)
      ) {
        const v = own;
        return (thisVal: Abs, ...args: Abs[]) => $call(v, args, thisVal);
      }
      // 槽值确定非可调用 → 原生 TypeError（B.m is not a function）
      if (staticSlotDefinitelyNotCallable(own)) {
        return () => {
          throw new NudoThrow(errorTypeAbs("TypeError"));
        };
      }
      // 抽象值：自有槽仍遮蔽继承链（不回落找父类方法），但不可证非可调用
      return undefined;
    }
    // Bug 90：own-property 取值（D.hasOwnProperty / D.toString 不得命中）
    const sm = ownMember(spec?.staticMethods, method);
    if (sm) return sm;
    cur = spec?.superName;
  }
  return undefined;
}

/**
 * P4a：类值链（含自有层）是否注册/落槽了该静态名——静态方法/静态访问器
 * （spec 表）+ 静态字段（statics 表，自有层也认）+ 类值自有槽（声明静态
 * 字段的求值产物 + 动态写 C.q = v）。与 classValueHasStatic（`"m" in C`
 * presence，祖先槽面）互补：此处面向「实例接收者调静态独占成员」的
 * static-only 证明，自有层 statics/槽都必须在场。
 */
export function chainHasStaticMember(startName: string, key: string, startSpec?: EvalClassSpec): boolean {
  // BUG-172 继承链图化：环序仍由 evalClassChain 生成（".prototype" owner
  // 入环 / 内建错误层级兑底口径不变），每环规格优先用上一环 superSpec
  // 引用（定义期身份；名字吻合才用），无引用才按名牌回表。
  let pending: EvalClassSpec | undefined = startSpec;
  for (const n of evalClassChain(startName)) {
    // 显式注解断开推断环（TS7022，同 findMethod）
    const spec: EvalClassSpec | undefined = resolveChainSpec(n, pending);
    pending = spec?.superSpec;
    // Bug 90：own-property 取值（含 `key in statics` → hasOwn——`in` 走
    // 原型链，宿主 Object.prototype 名恒真）
    if (ownMember(spec?.staticMethods, key) || ownMember(spec?.staticAccessors, key)) return true;
    if (spec?.statics !== undefined && Object.hasOwn(spec.statics, key)) return true;
    const cv = lookupClassValue(n);
    const inner = cv && cv.shape.k === "brand" ? (cv.shape as { shape?: Abs }).shape : undefined;
    if (inner?.shape.k === "obj" && getSlot(inner.shape.slots, key)) return true;
  }
  return false;
}

/**
 * P4a：实例**自有**面是否可能有该成员——接收者内层闭槽（ctor
 * `this.m = fn` 写入 / 字段落地的承载者，Bug 84）或链上同名实例字段
 * （instanceFields：字段值可能是可调用，每次构造必然落地）。命中即不抛
 * （成员可能在场，调用合法性交给通用派发面）。
 */
export function instanceOwnFaceHasMember(recv: Abs, brandName: string, key: string): boolean {
  const s = recv.shape;
  const inner = s.k === "brand" ? s.shape : undefined;
  if (inner?.shape.k === "obj" && getSlot(inner.shape.slots, key)) return true;
  // BUG-172 继承链图化：接收者随身规格作首环身份（名字吻合才用），其余环
  // 沿 superSpec 引用链，无引用按名牌回表（与 findMethod 同口径）。
  let pending: EvalClassSpec | undefined = classSpecOfAbs(recv);
  for (const n of evalClassChain(brandName)) {
    // 显式注解断开推断环（TS7022，同 findMethod）
    const spec: EvalClassSpec | undefined = resolveChainSpec(n, pending);
    pending = spec?.superSpec;
    if (spec?.instanceFields?.some((f) => f.name === key)) return true;
  }
  return false;
}

/**
 * Bug 247：实例字段落地 = **CreateDataPropertyOrThrow**（原生
 * InitializeInstanceElements → DefineField）：在接收者上**创建自有数据
 * 属性**，**不沿原型链派发 setter**。
 *
 * 引擎此前走 `$set` = `[[Set]]` ⇒ 父类原型上的同名**访问器**拦截了字段
 * 落地（`class A { get x(){return 1} } class B extends A { x = 2 }` 原生
 * 读出 2——字段是 B 实例的自有数据属性，父类 getter 不参与；引擎却把
 * 字段写穿到父类 setter / getter-only 时**假抛 TypeError**）。
 *
 * 结构性门禁保留（原生同款）：frozen ⇒ 定抛 TypeError；sealed / 不可扩展
 * ⇒ 新键定抛 TypeError；自有槽不可写（writable:false）⇒ 定抛 TypeError。
 */
function defineOwnDataProperty(
  target: Abs,
  key: string,
  value: Abs,
  opts?: { internal?: boolean },
): Abs {
  const sh = target.shape;
  if (sh.k === "brand") {
    const inner = sh.shape;
    if (inner.shape.k === "obj") {
      const st = extStateOf(target);
      if (st === "frozen") throwStrictWrite();
      const slots = inner.shape.slots;
      if ((st === "sealed" || st === "nonext") && !getSlot(slots, key)) throwStrictWrite();
      if (getPropFlags(target)?.get(key)?.writable === false) throwStrictWrite();
      const prev = getSlot(slots, key);
      setSlot(slots, key, {
        value,
        ...(prev?.internal || opts?.internal ? { internal: true } : {}),
        ...(prev?.symbolKey ? { symbolKey: true } : {}),
      });
      // Bug 66：原型链解析槽（errorBrandAbs 的 name）被自有数据属性覆盖 ⇒
      // 转**自有可枚举**（原生建自有可枚举属性；$set 同口径）。
      if (prev?.inherited) setPropFlags(inner, key, { enumerable: true });
      clearStaleTermPred(target);
      return target;
    }
    return $set(target, key, value, opts);
  }
  if (sh.k === "obj") {
    const st = extStateOf(target);
    if (st === "frozen") throwStrictWrite();
    const slots = sh.slots;
    if ((st === "sealed" || st === "nonext") && !getSlot(slots, key)) throwStrictWrite();
    if (getPropFlags(target)?.get(key)?.writable === false) throwStrictWrite();
    const prev = getSlot(slots, key);
    setSlot(slots, key, {
      value,
      ...(prev?.internal || opts?.internal ? { internal: true } : {}),
      ...(prev?.symbolKey ? { symbolKey: true } : {}),
    });
    if (prev?.inherited) setPropFlags(target, key, { enumerable: true });
    clearStaleTermPred(target);
    return target;
  }
  // 非对象形态（退化副本 / 抽象）：沿通用写面
  return $set(target, key, value, opts);
}

/**
 * Bug 59：实例字段落地——以 thisVal 为 this 按源序求值（原生
 * InitializeInstanceElements：基类 ctor 体前 / super() 返回后）。
 * 就地写槽，每构造一个新实例各自持有字段。
 *
 * Bug 224：实例字段初始化器是**普通函数**（原生：field initializer 里的
 * `new.target` 恒 undefined——`new.target` 只在构造器体里有值）。$new 的
 * ctor 帧覆盖「构造器体 + 实例字段初始化器」整段，字段初始化器又**不走
 * 调用边界**（不经 $call/$invoke ⇒ withNewTargetReset 不触发）⇒ 继承外层
 * ctor 帧、折成类值。此处求值期清掉 new.target 帧（构造器帧只在构造器体
 * 内成立；嵌套 new 自带帧，不串）。
 */
export function applyInstanceFields(spec: EvalClassSpec, thisVal: Abs): Abs {
  let cur = thisVal;
  for (const f of spec.instanceFields ?? []) {
    let key = f.name;
    if (!key && f.key) {
      const kv = asAbsVal(f.key(cur));
      const lv = litValue(kv);
      if (lv.ok && (typeof lv.value === "string" || typeof lv.value === "number")) {
        key = String(lv.value);
      } else {
        continue; // Bug 60：抽象计算键不可静态命名——不挂名（不假精确）
      }
    }
    if (!key) continue;
    // Bug 84：私有字段落地槽打 Slot.internal（introspection 面剔除；
    // $get/$set 直连访问与 $in 存在性不受影响）
    const initVal = withNewTargetReset(() => f.init(cur));
    // Bug 247：自有数据属性语义（不走原型链 setter）
    cur = defineOwnDataProperty(cur, key, asAbsVal(initVal), { internal: f.private === true });
  }
  return cur;
}

/**
 * Bug 59：构造链（原生 [[Construct]] 沿继承链逐类初始化实例字段）：
 * - 显式 ctor 基类：实例字段 → ctor 体；
 * - 显式 ctor 派生类：直接跑 ctor 体（内部 super() → $super 递归父链，
 *   super 返回后应用本类实例字段）；
 * - 隐式 ctor（constructor(...a){ super(...a) }）：递归父构造，返回后
 *   应用本类实例字段；extends null 链隐式 super 原生抛 TypeError。
 */
export function constructClass(
  className: string,
  thisVal: Abs,
  args: Abs[],
  specIn?: EvalClassSpec,
): Abs {
  // BUG-172：带进来的规格优先——`$new` 从类值身份取到的是**本模块那一份**
  // 类定义；裸名回表（getEvalClass）在多模块同名类下会拿到别的模块的构造
  // 体（A 的实例被跑 B 的 ctor：`this.b = 2` 落地、`this.a` 从未初始化）。
  const spec = specIn ?? getEvalClass(className);
  if (!spec) {
    // issue #110：env/宿主内建构造器作基类（class X extends Error）——此前
    // 原样返回 thisVal，super(message) 静默 no-op：args 被丢弃，e.message /
    // e.name 折假精确 undefined（原生为 message 字符串 / 原型链 "Error"）。
    // Error 家族按 errorBrandAbs 落 name/message 槽（与 new Error(...) 同
    // 口径：lit message 保精确、symbol ToString 校验、AggregateError
    // errors/cause）；brand 名保持被构造实例 thisVal（B extends A extends
    // Error 的中间用户类链不换名）。其余内建（Promise/Date/…）无槽建模，
    // 维持原样。用户同名类优先（上方 getEvalClass 命中即不走此分支）。
    if (isErrorCtorName(className)) {
      const eb = errorBrandAbs(className, args);
      const instName = thisVal.shape.k === "brand" ? thisVal.shape.name : className;
      const inner = eb.shape.k === "brand" ? eb.shape.shape : objOf({});
      return abs(
        { k: "brand", name: instName, shape: inner },
        eb.term,
        eb.pred,
        eb.conf,
      );
    }
    // P3a：N2 名单外的宿主内建父（URL/ArrayBuffer/SAB/DataView/WeakRef/
    // FCR——hostBuiltinCtorOf 路由表内可扩展类）：实例按 evalBuiltinNew
    // 建模（new AB(8).byteLength → 8；URL href 槽、TA 家族同面），内建
    // 自有槽嫁接到**被构造 brand 名**上（与 Error 家族同构——instanceof
    // 沿 evalClassChain(AB) 命中 ArrayBuffer，brand 名不换）。未建模名 /
    // $new 直达面维持原样 thisVal（$new 宿主分支自有建模范）。
    if (hostBuiltinCtorOf(className) !== undefined) {
      const built = evalBuiltinNew(className, args);
      if (built !== undefined) {
        // 非 brand 产物（Array ctor 的数组 / Promise 的 eff 面）原生就是
        // 第一形态值，直接返回；brand 产物嫁接内建槽到被构造 brand 名。
        if (built.shape.k !== "brand") return built;
        const instName = thisVal.shape.k === "brand" ? thisVal.shape.name : className;
        // 内建集合的**条目表按 Abs 身份驻留**（collections.ts 的 WeakMap：
        // mapTables / setTables）——**重铸 Abs 会丢表** ⇒ 含内建父的类链
        // （class MyMap extends Map ⇒ new MyMap([["a",1]])）的实例读不到
        // 条目（`.get` / `.size` 折 unknown = 族 02 遗留「含内建父的类链
        // 保守不判」）。改为**就地改 brand 名**（Abs 身份不变 ⇒ 侧表存活；
        // brand 名换成「被构造类名」与原生一致——instanceof 沿类链命中）。
        built.shape = { ...built.shape, name: instName };
        return built;
      }
    }
    return thisVal;
  }
  if (spec.ctor) {
    let tv = thisVal;
    if (!spec.superName && !spec.superNull) tv = applyInstanceFields(spec, tv);
    const derived = !!(spec.superName || spec.superNull);
    // BUG-173：派生类构造器体执行期间登记「尚未调 super」——构造器体里的
    // this 读写（$get/$set/$idx/$idxSet/$invoke）据此硬抛 ReferenceError
    // （原生 GetThisBinding）。构造器返回/抛出后清登记。
    if (derived) notePendingSuper(tv, className);
    const after = (() => {
      try {
        return spec.ctor(tv, ...args);
      } finally {
        if (derived) clearPendingSuper(tv, className);
      }
    })();
    // 「构造体返回的就是本实例」判定：类构造器发射面**恒**以
    // `return <thisSlot>` 收尾（用户没写 return 时也一样），所以「返回值是
    // 对象」不等于「用户 return 了一个替代对象」——必须把**本实例**（同
    // Abs 身份，或 super() 重铸的同内层 shape brand）排除在外，否则 Bug 245
    // 的「一次都没调 super」门会被静默绕过。
    const isOwnInstance = (v: Abs): boolean =>
      v === tv ||
      (v.shape.k === "brand" &&
        v.shape.name === className &&
        tv.shape.k === "brand" &&
        v.shape.shape === tv.shape.shape);
    // BUG-177 / Bug 17：ES [[Construct]] 的返回值语义——**顺序即规范顺序**：
    // ① 构造体返回**替代对象**（不是本实例）⇒ 直接返回它（派生类
    //    `return {…}` **合法**，不需要、也不检查 super() 是否被调用——此前
    //    「必须调 super」的门放在返回值语义之前 ⇒ 这种惯用法被误报
    //    ReferenceError（假红））；
    // ② 结果是 undefined 或本实例 ⇒ 才要求「本层已调 super」（未调 ⇒
    //    ReferenceError，Bug 245）；
    // ③ 结果是原始值（含 null）⇒ 派生类 TypeError（"Derived constructors
    //    may only return object or undefined"），基类忽略 → this。
    if (isObjectLikeAbs(after) && !isOwnInstance(after)) return after;
    if (derived && !superCalledFor(tv, className)) {
      // Bug 245：派生类构造器**必须**调用一次 super()——一次都没调 ⇒ 原生
      // ReferenceError（"Must call super constructor in derived class before
      // accessing 'this' or returning from derived constructor"）。
      // 判定面：$super 在**本层**（className）标记过 ⇒ 已调；未标记 ⇒ 未调。
      // 基类（无 superName / superNull）不适用本门。
      throw new NudoThrow(errorTypeAbs("ReferenceError"));
    }
    if (after === undefined || after === null || isDefinitelyUndefinedAbs(after)) return tv;
    // 原始值（含 `null` 字面量——它在 Abs 里未必落在 `prim` 形状上）：
    // 派生类 TypeError，基类忽略 → this。
    if (
      after.shape.k === "prim" ||
      (after.term?.op === "lit" && after.term.value === null)
    ) {
      if (derived) throw new NudoThrow(errorTypeAbs("TypeError"));
      return tv;
    }
    return after;
  }
  if (spec.superNull) {
    // Bug 11：extends null 链上的隐式构造器等价 super(...args)，原生抛
    // TypeError（Super constructor null … is not a constructor）
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (spec.superName) {
    const afterSuper = constructClass(spec.superName, thisVal, args, spec.superSpec);
    return applyInstanceFields(spec, afterSuper);
  }
  return applyInstanceFields(spec, thisVal);
}

/**
 * Bug 322：`new URL(...)` 实例补 `searchParams` 槽。
 *
 * 原生 `new URL(u).searchParams` **恒**是 URLSearchParams 实例（读面不是
 * undefined）——core 的 URL 组件槽表（`builtins/error/web.ts` 的
 * urlBrandAbs）只列了 10 个 URL 组件（href/origin/protocol/hostname/
 * pathname/search/hash/port/username/password），**独缺 searchParams** ⇒
 * 读它落「槽缺失 ⇒ undefined」⇒ `.get(...)` 在 undefined 上调用 ⇒
 * **确定 TypeError** ⇒ 返回值折 `never`（错的确定值）⇒ 对完全合法、
 * 确定性的代码报 `nudo:entry-may-throw` **假红**（L2/L5）。
 *
 * 本函数在**构造面**（$new 的宿主构造器分支）补槽：URL brand 的内层 obj
 * 加一个 `searchParams` 槽，值 = URLSearchParams brand。
 *
 * 精度口径（不得折假精确）：URLSearchParams 的**条目表不建模**（仓内既有
 * 精度债——builtin-coverage-registry 登记 "URLSearchParams.proto.get：
 * 条目表不建模，接受 unknown"）⇒ `searchParams.get(k)` 折 **unknown**
 * （原生给具体字符串），但**绝不再折 undefined / never / 假抛**。
 * 越界诉求：条目表建模（get/has 按查询串取值）须落在
 * `builtins/error/web.ts`（URLSearchParams brand 建模）+ 品牌方法派发面
 * ——非本分片地盘，由主 agent 裁决合并。
 */
function withUrlSearchParamsSlot(u: Abs): Abs {
  const sh = u.shape;
  if (sh.k !== "brand" || sh.name !== "URL") return u;
  const inner = sh.shape;
  if (inner.shape.k !== "obj") return u;
  const slots = inner.shape.slots;
  if (getSlot(slots, "searchParams") !== undefined) return u;
  // 就地加槽（brand 内层 obj 由 makeUrlAbs 每次新建 ⇒ 无跨实例共享）
  setSlot(slots, "searchParams", { value: makeUrlSearchParamsAbs(undefined) });
  return u;
}

/**
 * BUG-159：宿主全局构造器的**原生探测**（IsConstructor + 零实参构造）。
 *
 * `$new` 的宿主全局兜底此前无条件铸空 brand：既不查 `IsConstructor`，也不查
 * 宿主构造器本身是否恒抛 ⇒ 「恒不可构造」的宿主类（`Storage` / `Crypto` /
 * `Iterator` / `Navigator` …，原生 "Illegal constructor" / "Abstract class …
 * not directly constructable"）被判「不抛」⇒ L2 假绿；而无 env 时目标
 * runtime 就是分析器自己的宿主 ⇒ 与自身 runtime 矛盾。
 *
 * 两项探针都不执行被分析代码（Abs 实参绝不喂真 JS 函数）：
 * 1. `Reflect.construct(Object, [], cls)` —— spec 只校验 `cls` 可作
 *    **newTarget**（`IsConstructor(newTarget)` 为假 ⇒ TypeError），**不调用**
 *    构造器本体 ⇒ 零副作用；不可构造 ⇒ 原生 `new cls()` 定抛 TypeError。
 * 2. 零实参构造：仅当本次 `new` 调用**没有实参**时探 `new cls()`——与用户
 *    代码同形，抛即原生必抛（WebIDL 必填实参缺失 / Illegal constructor /
 *    "Constructor cannot be called"）。实参在场时不探测：必填参数可能被补齐，
 *    且真构造的副作用不可回滚。
 *
 * 错误 kind 统一记 **TypeError**（WebIDL / ES 口径："Illegal constructor" 是
 * TypeError；宿主个别实现抛裸 Error，不改变规范面）。
 */
function probeHostGlobalCtor(cls: Function, args: Abs[]): void {
  try {
    Reflect.construct(Object, [], cls as unknown as new () => object);
  } catch {
    // IsConstructor(cls) === false ⇒ `new cls()` 确定抛 TypeError
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (args.length > 0) return;
  try {
    Reflect.construct(cls as unknown as new () => object, []);
  } catch {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
}

/** new C(...) → 空 brand 实例 + ctor 写字段；非类构造走 impl/$call */
/**
 * BUG-160：TextEncoder 的实例面建模（宿主全局分支 / 无专门 builtin 表条目）。
 *
 * `PROTOTYPED_BRAND_NAMES` 登记 TextEncoder 为「原型面已建模」，但
 * `BUILTIN_BRAND_METHODS` / `ACCESSORS` 没有条目 ⇒ 空 brand ⇒ 三个成员读
 * 折 **exact undefined**（`e.encoding === undefined` 静态判 true，运行时
 * false）。宿主真值：encoding 恒 "utf-8"、encode / encodeInto 是函数
 * （encode 返回 Uint8Array；调用面返回 unknown 诚实，不折假值）。
 */
function makeTextEncoderAbs(): Abs {
  const method = (): Abs => absFunction([], { apply: () => unknown }, { ctor: false });
  return abs(
    {
      k: "brand",
      name: "TextEncoder",
      shape: objOf({
        encoding: { value: strLit("utf-8"), readonly: true },
        encode: { value: method() },
        encodeInto: { value: method() },
      }),
    },
    undefined,
    undefined,
    "path",
  );
}

export function $new(cls: Abs | ((...a: unknown[]) => unknown), args: Abs[]): Abs {
  // Bug 932 顺带清理：具名导入物化不再把 fn Abs 包成 JS 箭头 wrapper
  // （bindImport 原样直出声明 Abs）⇒ `__nudoAbsFn` 回读已无生产方（死代码）。
  // Abs 一等函数在两条调用面原生可派发（标识符调用走 $callNamed 的 Abs
  // 分支 → $call(fn,args)；new 走本函数的 Abs 分支）。
  // Abs 侧内建构造器（builtinCtorAbs / env fn）：按名派发。
  // dual-facet 全局（Array/Date/Promise/Number…）经 env 遮蔽后 cls 是 Abs，
  // 必须走 evalBuiltinNew 按名构造，否则 $call 回退对无 apply 的 obj 折 unknown。
  if (isAbsLike(cls)) {
    const cs = (cls as Abs).shape;
    // Bug 122：new <proxy 实例> 是靶的 [[Construct]]（或 construct 陷阱）——
    // 不是重入 Proxy 构造器。brand 名 "Proxy" 与构造器同名，此前
    // evalBuiltinNew("Proxy") 把 new 表达式的实参当 target/handler 重造
    // 新代理（函数靶假抛 / 对象靶凭空造值，双向错）。
    if (cs.k === "brand" && cs.name === "Proxy") {
      const parts = proxyPartsOf(cls as Abs);
      if (!parts) return unknown; // 退化副本：靶不可知，不凭空造代理/实例
      const trap = proxyTrapOf(parts.handler, "construct");
      if (trap.k === "fn") {
        // Bug 257：ProxyCreate 只在靶**是构造器**时装 [[Construct]]——
        // 引擎此前**先查陷阱再派发**，无 IsConstructor(target) 判定 ⇒
        // 靶不可构造（箭头函数 / 普通对象）时引擎照样派发 construct 陷阱
        // （陷阱副作用发生、构造"成功"），原生恒抛 TypeError
        // （"not a constructor"）⇒ 假绿 + 假值。
        // 判定：true = 可构造；false = 确定不可构造；undefined = 不可判。
        const targetFacet = ctorFacetOfTarget(parts.target);
        if (targetFacet === false) {
          // 确定不可构造 ⇒ 原生 TypeError（且**不派发陷阱**——原生根本没装
          // [[Construct]]，陷阱副作用不发生）。
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
        if (targetFacet === undefined) {
          // 不可判（fn 形构造性未知）⇒ fail-closed：不派发陷阱（原生语义
          // 不可判定时不制造副作用），记 may-throw + 值域 never。
          recordMayThrow({
            kind: "TypeError",
            cause: "Proxy construct target constructibility unknown",
          });
          return never;
        }
        // construct(target, argsList, newTarget)；receiver = handler。
        // 原生要求陷阱返 Object（TrapResultValidation：`[[Construct]] … must
        // return an object`）——非对象字面量定抛 TypeError（node 实测
        // construct(){ return 1; } → TypeError）；抽象面 may 抛。
        const argsList = abs({ k: "tuple", elements: args }, undefined, undefined, "path");
        return callAtFunctionBoundary(() => {
          const r = $call(trap.fn, [parts.target, argsList, cls as Abs], parts.handler);
          const rv = litValue(r);
          if (rv.ok && (rv.value === null || typeof rv.value !== "object")) {
            throw new NudoThrow(errorTypeAbs("TypeError"));
          }
          if (
            r.shape.k === "prim" ||
            (r.term?.op !== "lit" && (r.shape.k === "any" || r.shape.k === "unknown" || r.shape.k === "sum"))
          ) {
            recordMayThrow({ kind: "TypeError", cause: "Proxy construct trap must return an object" });
          }
          return r;
        });
      }
      // dead：有槽不可调用——原生 GetMethod 定抛 TypeError
      if (trap.k === "dead") throw new NudoThrow(errorTypeAbs("TypeError"));
      // opaque：handler 形态不可判（陷阱可能在）——诚实 unknown
      if (trap.k === "opaque") return unknown;
      // absent：无陷阱 → 靶的 [[Construct]]（IsConstructor 校验在递归里
      // 自然发生：obj/arr/tuple 靶 → TypeError，fn 靶 → ctor 旗标分支）
      return $new(parts.target, args);
    }
    const ctorName =
      cs.k === "brand"
        ? cs.name
        : builtinCtorNameOf(cls) ?? (cs.k === "fn" ? (cs.name ?? undefined) : undefined);
    if (ctorName) {
      // BUG-166：用户类**遮蔽**同名宿主全局（JS 词法作用域语义）——`class
      // URL { … }` / `class Map { … }` 的类值与内建构造器**同名**。本 Abs
      // 若就是 $class 产出的类值（随值规格身份命中），必须走用户类构造链
      //（下方 specOf/constructClass）；此前直接 evalBuiltinNew 按名派发 ⇒
      // 用户的构造体从未执行（`this.a = 1` 从未发生）⇒ 假红（URL/Promise
      // 判必须抛）+ 自信的错类型（Error/Map/Date 给内建 brand）+ guard 面
      // 恒假。身份判定（不用裸名查注册表）⇒ 内建 Abs 不受跨 run 同名用户
      // 类污染。
      if (!isDeclaredClassValue(cls as object)) {
        const built = evalBuiltinNew(ctorName, args);
        if (built !== undefined) return built;
      }
    }
  }
  // JS 内建构造器（Error/Date/URL…）：直接 brand，避免 $call 对非 Abs 炸掉
  if (typeof cls === "function") {
    const clsName = cls.name || "Object";
    // Bug 37：Proxy 无 .prototype（hostFnCtorFacet 的 prototype 启发式会误判
    // 不可构造 → 假 TypeError），但原生 Proxy 是合法构造器——先按名走
    // target/handler IsObject 校验派发
    if (clsName === "Proxy") return makeProxyAbs(args[0], args[1]);
    // Bug 9：宿主 generator/async 函数（求值引擎的函数声明产物）不可 new——
    // 原生 new g() → TypeError（g is not a constructor），不得落空 brand 假精确
    if (hostFnCtorFacet(cls) === false) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    // 宿主副作用构造器（new WebSocket / XMLHttpRequest / EventSource…）：
    // 与 $callNamed 同一 never-execute 守卫——真构造会开真实连接。
    // 命中 fail-closed 为 unknown#opaque，不落入下方空 brand（那是
    // 「碰巧安全」而非显式拦截）。
    const blockedHost = blockHostSideEffect(cls, args);
    if (blockedHost) return blockedHost;
    // new Array(n) → n 元空洞 tuple；new Array(a,b,c) → 字面量 tuple；
    // 非法 length（1.5/-1/NaN/超 2^32-1）→ RangeError
    // （makeArrayCtorAbs 口径）
    if (cls === Array) {
      return makeArrayCtorAbs(args);
    }
    // new RegExp(pattern, flags)：字面量真构造验证（evalRegExpCtor 单一
    // builder——字面量精确 brand / 抽象 pattern 全槽 path brand / 非法实参
    // 硬抛 SyntaxError/TypeError，与 evalBuiltinNew Abs 面同口径）
    if (cls === RegExp) {
      return evalRegExpCtor(args);
    }
    // C2.2：Error 家族携带 name/message 槽（catch 形参可读）
    if (isErrorCtorName(clsName)) {
      return errorBrandAbs(clsName, args);
    }
    // C1.1 / C1.2：Map / Set 条目表（按 ctor 名比对，避开 TS 全局接口无交集）
    // 确定非法实参（非可迭代字面量 / Map prim 条目）→ 原生 TypeError hard throw
    if (clsName === "Map") {
      if (ctorArgDefinitelyInvalid("Map", args[0])) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return makeMapAbs(args[0]);
    }
    if (clsName === "Set") {
      if (ctorArgDefinitelyInvalid("Set", args[0])) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return makeSetAbs(args[0]);
    }
    // Bug 15：WeakMap/WeakSet 与 Map/Set 同口径 iterable 校验；合法 → 空 brand
    if (clsName === "WeakMap") return makeWeakCollectionAbs("WeakMap", args[0]);
    if (clsName === "WeakSet") return makeWeakCollectionAbs("WeakSet", args[0]);
    // Bug 25：new WeakRef(target) —— target CanBeHeldWeakly 校验（与
    // FCR.register 同口径）；合法 → 空 brand（deref 面保持现状）
    if (clsName === "WeakRef") return makeWeakRefAbs(args[0]);
    // Bug 25：new FinalizationRegistry(cb) —— cleanupCallback IsCallable
    // 前置校验（缺省同抛）；合法 → 空 brand（实例方法面 Bug 43 已落）
    if (clsName === "FinalizationRegistry") return makeFinalizationRegistryAbs(args[0]);
    // Bug 41/15：new ArrayBuffer(length, options?) —— ToIndex 校验 + 槽构造
    if (clsName === "ArrayBuffer") return makeArrayBufferAbs(args[0], args[1]);
    // Bug 15：new SharedArrayBuffer 同款（growable 面）
    if (clsName === "SharedArrayBuffer") return makeSharedArrayBufferAbs(args[0], args[1]);
    // Bug 63：new DataView(buf, off?, len?) —— IsArrayBuffer + ToIndex 校验
    if (clsName === "DataView") return makeDataViewAbs(args[0], args[1], args[2]);
    // Bug 21：TypedArray 家族（TYPED_ARRAY_ELEMENT 表驱动）——length 实参
    // ToIndex 校验（负/超界 → RangeError；symbol/bigint → TypeError；抽象 →
    // may）；与 evalBuiltinNew（Abs 面）同 builder
    if (typedArrayElementOf(clsName) !== undefined) {
      return makeTypedArrayAbs(clsName, args);
    }
    // Bug 85：new URL(input, base?) —— ToString + 解析校验（合法带 href 槽）
    // Bug 322：构造面补 `searchParams` 槽（见 withUrlSearchParamsSlot）
    if (clsName === "URL") return withUrlSearchParamsSlot(makeUrlAbs(args[0], args[1]));
    // Bug 22：装箱统一 makeBoxedAbs（[[PrimitiveValue]] 槽 + String 下标槽；
    // Number/String symbol 实参确定 TypeError、any → may——builder 内记）
    if (clsName === "Number" || clsName === "Boolean" || clsName === "String") {
      return makeBoxedAbs(clsName, args[0]);
    }
    // new Symbol() 原生 TypeError（Symbol 只能当函数调用）
    if (clsName === "Symbol") {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    // Bug 45：BigInt 无 [[Construct]]（V8 有 .prototype 但 new BigInt() 确定
    // TypeError "BigInt is not a constructor"）
    if (clsName === "BigInt") {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    // new Promise(executor)：调用 executor 收集 resolve 实参 → eff(promise)
    if (clsName === "Promise") {
      return evalPromiseCtor(args);
    }
    // Bug 29（强转三连）：new Function(body)——实参**逐个**
    // ToString（Symbol → 确定 TypeError，node 实测；抽象 →
    // may）。动态代码语义不建模（同 eval：值域经 fn shape
    // 调用得 unknown），但校验是纯静态的，与原生同口径；
    // 调用形 Function(x) 经 callHostGlobalLiteralOnly 已覆盖，
    // 此处补构造器形。与 evalBuiltinNew（Abs 面）同 builder 口径。
    if (clsName === "Function") {
      return makeDynamicFunctionAbs(args);
    }
    // Bug 24：new Date(value) —— 单参 ToPrimitive/ToNumber 校验（symbol/bigint
    // 确定抛，node 实测 new Date(1n) TypeError）；多参逐实参 ToNumber。
    // 与 evalBuiltinNew 的 Abs 面同口径（evalDateCtor 返回同款 brand）。
    if (clsName === "Date") {
      return evalDateCtor(args);
    }
    // new TextDecoder(label?) —— encoding label 校验（非法字符确定
    // RangeError / 知名 label 正常构造 / 未知 ASCII 形与抽象 → may）
    if (clsName === "TextDecoder") {
      return makeTextDecoderAbs(args[0], args[1]);
    }
    // BUG-160：TextEncoder 实例面（encoding / encode / encodeInto）
    if (clsName === "TextEncoder") {
      return makeTextEncoderAbs();
    }
    // new URLSearchParams(init?) —— 序列实参校验（非二元组元素确定
    // TypeError / 字面量正常构造 / 开放数组与抽象 → may）
    if (clsName === "URLSearchParams") {
      return makeUrlSearchParamsAbs(args[0]);
    }
    // Bug 16：未识别宿主函数（用户 function 声明/表达式——转译产物是真
    // JS 函数，体已 $ 助手化、Abs this 经 $rawThis(this) prologue 承接）
    // 按原生 [[Construct]] 执行：新建空 brand this → 调函数体 → 返回值为
    // Abs 对象（brand/obj）则用之，否则 this（宿主函数皆基类构造器，
    // undefined/原始返回值原生忽略）。宿主内建构造器（Object/Function/
    // Boolean…未进上方派发表）不走体执行——Abs 实参喂真 JS 构造器会产
    // 宿主原值（静默错值），维持既有空 brand 口径。
    if (hostBuiltinCtorName(cls) === undefined && !isHostGlobalFn(cls)) {
      // Bug 113：函数声明（宿主函数）[[Construct]]——铸实例 brand 前注册
      // 链键（$class 的 registerEvalClass 同款）：chainProtoSlotOf 沿
      // protoBrandAbs(clsName) 链解析（f.prototype 写落同名 memo 槽——
      // 宿主函数 prototype 读正是 protoBrandAbs），实例缺槽读不再 exact
      // undefined。同名注册面（用户类）不覆写。不用 ensureFnParentName/
      // asAbsVal：宿主函数每次铸新 fn Abs 会 miss fnProtoOf 的 WeakMap，
      // 而本分支原型载体是 protoBrandAbs 名面。
      if (!getEvalClass(clsName)) registerEvalClass({ name: clsName });
      const thisVal = abs(
        { k: "brand", name: clsName, shape: objOf({}) },
        undefined,
        undefined,
        "path",
      );
      // Bug 205：构造期捕获实例的真实 [[Prototype]]（宿主函数的 prototype
      // 载体是 protoBrandAbs 名面——与 `F.prototype` 读同一对象）。捕获后
      // 原型被替换（`F.prototype = {}`）时，instanceof 沿**记录的链**做
      // 身份比较：换原型前造的实例记旧原型、换后造的新实例记新原型
      // （原生 "false|true" 的区分依据）。
      setInstanceProto(thisVal, protoBrandAbs(clsName));
      // new.target 帧：构造器体内 new.target = 被构造的函数值
      pushCtorFrame(asAbsVal(cls));
      const entered = evalEnterCall(clsName, cls, args);
      if (!entered.ok) {
        popCtorFrame();
        return evalTruncatedAbs();
      }
      try {
        const after = callAtFunctionBoundary(() =>
          (cls as (...a: Abs[]) => Abs).apply(thisVal, args),
        );
        // Bug 250：原生 [[Construct]]——返回值**是 Object 就用它**（数组 /
        // 函数 / Promise 都是 Object）。引擎此前只认 brand|obj ⇒ 构造器
        // 返回数组时静默换回 this（`Array.isArray(new F())` 假 false、
        // `new F() instanceof F` 假 true）。
        if (isObjectLikeAbs(after)) {
          return after;
        }
        return thisVal;
      } finally {
        evalExitCall();
        popCtorFrame();
      }
    }
    // BUG-159：宿主全局函数兜底**必须先过原生构造面探测**——恒不可构造的
    // 宿主构造器（Storage / Crypto / Iterator / Navigator …）与不可构造的
    // 宿主函数（parseInt 等，已在 hostFnCtorFacet 拦下）都不得铸空 brand。
    if (isHostGlobalFn(cls)) probeHostGlobalCtor(cls, args);
    const shape = objOf({});
    return abs({ k: "brand", name: clsName, shape }, undefined, undefined, "path");
  }
  // Bug 46：裸宿主命名空间对象（Math/JSON/Reflect——typeof "object" 且无
  // shape）作为 $new 接收者：原生 IsConstructor 恒 false → 确定 TypeError
  // （与 Symbol/BigInt 非构造器同口径；此前直达 specOf 裸解引用 cls.shape.k
  // 引擎内部崩溃，被 run.ts catch-all 兜底成 unknown + 假 may-throw）
  if (cls && typeof cls === "object" && !isAbsLike(cls)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const spec = specOf(cls);
  if (!spec) {
    // Bug 32：原生 [[Construct]] 先做 IsConstructor(C)——obj/arr/tuple 形
    // callee 恒非构造器（`new ({})()` 定抛 TypeError: not a constructor）。
    // 引擎内该三形 Abs 从不携带构造面（类 spec 走上方 constructClass 分支、
    // fn 形走下方 ctor 旗标分支、attachFnImpl 只产 fn 形状）→ 确定 TypeError，
    // 不再静默落 $call（Bug 10 同缺口）。brand（Proxy construct trap 可
    // 构造）/unknown（fail-closed 令牌）维持原口径不记。
    const fs = isAbsLike(cls)
      ? (cls as Abs).shape
      : undefined;
    if (fs?.k === "obj" || fs?.k === "arr" || fs?.k === "tuple") {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    // Bug 9：fn 形 callee 的可构造性校验（箭头/方法/async/generator 不可 new）。
    // 已知非构造 → hard NudoThrow（tier 1）；已知可构造（函数/类表达式值）→
    // 与宿主函数分支同口径的空 brand 实例；未知（mock/桥接/env）→ may-throw
    // （tier 2），值域保持 $call 回退不变。
    if (fs?.k === "fn") {
      if (fs.ctor === false) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      if (fs.ctor === true) {
        // Bug 16：可构造 fn Abs（$fnVal 函数表达式值等）按 [[Construct]]
        // 执行体——apply 钩子承接 Abs thisVal（非 bindThis 的 thisArg 传入），
        // 返回 Abs 对象优先、undefined/原始值忽略（基类语义）
        const impl = getFnImpl(cls as Abs);
        // P3b：匿名函数表达式构造器——实例 brand 用伪父名（ensureFnParentName
        // 注册链键），`new Base().x` 沿 memo prototype 折精确、instanceof /
        // constructor 同链可解；有名 fn（Named NFE）保持声明名。
        const instName = fs.name ?? ensureFnParentName(cls as Abs);
        // Bug 253：bind 产物（Function.prototype.bind）**可构造**——原生
        // `new (f.bind(thisArg, ...bound))()` 走**目标的 [[Construct]]**：以
        // newTarget.prototype 建实例、绑定实参前置、this = 新实例（**忽略**
        // 绑定的 thisArg）。引擎此前 bind 产物只有 apply 钩子 ⇒ 复用
        // impl.apply ⇒ 目标构造器在 this === boundThis（常为 null）上执行
        // ⇒ `new B()` 假抛 TypeError。
        // 构造 facet 走 declare.ts 的模块级 WeakMap 侧表（不改公共类型
        // AbsFnImpl——它在 algebra/index.ts / core/src/index.ts 导出）。
        const bindFacet = bindCtorFacetOf(cls as Abs);
        if (bindFacet) {
          const instName = bindFacet.instName();
          const thisVal = abs(
            { k: "brand", name: instName, shape: objOf({}) },
            undefined,
            undefined,
            "path",
          );
          const proto = bindFacet.proto();
          if (proto) setInstanceProto(thisVal, proto);
          pushCtorFrame(cls as Abs);
          const entered = evalEnterCall(instName, cls as Abs, args);
          if (!entered.ok) {
            popCtorFrame();
            return evalTruncatedAbs();
          }
          try {
            const after = bindFacet.construct(thisVal, args);
            // Bug 250：返回值是 Object（brand/obj/arr/tuple/fn/eff）就用它
            if (isObjectLikeAbs(after)) return after;
            return thisVal;
          } finally {
            evalExitCall();
            popCtorFrame();
          }
        }
        if (impl?.apply) {
          const thisVal = abs(
            { k: "brand", name: instName, shape: objOf({}) },
            undefined,
            undefined,
            "path",
          );
          // Bug 205：构造期捕获实例的真实 [[Prototype]]——fn Abs 构造器
          // （$fnVal 函数表达式 / 宿主函数 **facade**：prototype 被替换过）
          // 的 prototype 槽优先，否则按名 protoBrandAbs（与 evalProtoChain
          // 同一载体）。
          setInstanceProto(thisVal, fnAbsCtorProtoOf(cls as Abs, instName));
          pushCtorFrame(cls as Abs);
          const entered = evalEnterCall(instName, cls, args);
          if (!entered.ok) {
            popCtorFrame();
            return evalTruncatedAbs();
          }
          try {
            // Bug 46：bindThis impl（方法型 FunctionExpression 值可 new）——
            // 新实例走首参注入（与 $call 派发同口径）；普通 fn 经 thisVal
            // 进宿主 this。
            const afterR = impl.apply(
              impl.bindThis ? [thisVal, ...args] : args,
              thisVal,
            );
            const after = isAbsApplyResult(afterR) ? afterR.abs : afterR;
            // Bug 250：返回值是 Object（brand/obj/arr/tuple/fn/eff）就用它
            if (isObjectLikeAbs(after)) {
              return after;
            }
            // Bug 242 注记：此处**不**按「apply 返回 unknown」把实例折 unknown——
            // 匿名函数表达式构造器（$fnVal）空体时 apply 也返回 unknown（引擎
            // fail-closed 令牌），按该信号收口会误伤 P3b（伪名链键 + 实例
            // brand）。未建模的宿主类构造器（命名空间成员：Intl.Collator 等）
            // 由**命名空间成员 fn 投影带 name** 收口——`$new` 取到真名
            // （`Intl.<Sub>`）即不落内部伪名（`__nudoFnParentN` 是合法 JS
            // 标识符却从未声明，会泄漏进 nudo check 签名 / dts 产物（TS2304）/
            // schema 产物（z.instanceof(伪名) ⇒ 加载即 ReferenceError））。
            return thisVal;
          } finally {
            evalExitCall();
            popCtorFrame();
          }
        }
        // issue #106：env 声明构造器（ctor:true + 声明 returnType、无 impl）——
        // 空 brand 会丢声明实例面（EventEmitter/AbortController/stream 的方法槽），
        // 回落 $call（与下方 env 构造器注释同口径）取声明实例类型。
        if (!impl || !impl.apply) {
          const rt = (fs as { returnType?: Abs }).returnType;
          if (rt && (rt.shape.k === "brand" || rt.shape.k === "obj")) {
            return $call(cls, args);
          }
        }
        return abs(
          { k: "brand", name: instName, shape: objOf({}) },
          undefined,
          undefined,
          "path",
        );
      }
      recordMayThrow({
        kind: "TypeError",
        cause: "new on function value of unknown constructibility (may be arrow/generator/async)",
      });
    }
    // env 构造器（URL 等）：fn impl / absFunction
    return $call(cls, args);
  }
  const className = spec?.name ?? (cls.shape.k === "brand" ? cls.shape.name : "Anonymous");
  const thisVal = abs(
    { k: "brand", name: className, shape: objOf({}) },
    undefined,
    undefined,
    "path",
  );
  // BUG-172：新实例随值携带**自己的**类规格（构造链 / 成员查表按此解析，
  // 同名类在不同模块并存时不再串味）。
  if (spec) attachClassSpec(thisVal, spec);
  // Bug 79：new.target 帧——构造器体/实例字段初始化器内 new.target = 被构造
  // 的类值；嵌套普通调用（$call/$invoke 面已清空）读 undefined（原生语义）。
  pushCtorFrame(cls);
  try {
    // BUG-172/173：构造器返回替代对象（brand 重铸 / Error·内建父嫁接）时
    // 类面侧表过户统一走 rebrandClassAbs 原语（随值规格 + superCalled 标记
    // 集；原手工面 carryClassSpec(thisVal, inst) 收敛于此——逐点比对见
    // rebrand.ts 头注释）。值身份换了，规格不能丢。
    const inst = rebrandClassAbs(thisVal, constructClass(className, thisVal, args, spec));
    // Bug 205：构造期捕获类实例的真实 [[Prototype]]（= 类原型对象）——
    // 原型被替换 / setPrototypeOf 后 instanceof 沿**记录的链**做身份比较。
    if (inst.shape.k === "brand") setInstanceProto(inst, protoBrandAbs(className));
    // R2b：每次 new 产出新实例——brand 形打新鲜实例标（=== 折 false；
    // 构造器 return 既有对象时重打只改该 Abs 引用的 id，别名恒等不受影响）
    return inst.shape.k === "brand" ? markFreshInstance(inst) : inst;
  } finally {
    popCtorFrame();
  }
}
