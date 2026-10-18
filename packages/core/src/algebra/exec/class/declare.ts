/**
 * 类声明/注册/构造：$class/$new/$staticInit + registry 辅助。
 *
 * Invariants:
 * - classImpl（WeakMap）是 spec 的唯一私有挂载点：Abs 对象身份 → 定义
 *   spec；同名类跨 run last-wins 重注册换新 spec（驻留侧表随旧 spec 回收）。
 * - 实例字段就地突变（applyInstanceFields 落 inner obj 槽）：原生引用共享
 *   语义——方法内 this.x = v 对调用点持有的同一实例 Abs 可见。
 * - new 的 ctor 帧走 pushCtorFrame/popCtorFrame；new.target 通道由
 *   withNewTargetReset 包裹（嵌套 new 不串帧）。
 */
import type { Abs } from "../../abs.ts";
import { abs, unknown, litValue, strLit } from "../../abs.ts";
import { objOf, getSlot, setSlot } from "../../objects.ts";
import { markFreshInstance } from "../../instance-id.ts";
import { builtinSuperCtorOf, hostBuiltinCtorOf, evalClassChain } from "../runtime/members.ts";
import { builtinCtorAbs, protoOfRecv } from "../../builtins.ts";
import { typedArrayElementOf } from "../../builtins/shared.ts";
import { $get, $set, asAbsVal, callAtFunctionBoundary } from "../runtime.ts";
import { pushCtorFrame, popCtorFrame } from "../runtime/state.ts";
import { $call } from "../call.ts";
import { evalEnterCall, evalExitCall, evalTruncatedAbs, isHostGlobalFn } from "../calls.ts";
import { getFnImpl, absFunction, hostFnCtorFacet, isAbsApplyResult } from "../../abs-fn.ts";
import { errorBrandAbs, isErrorCtorName, evalBuiltinNew, makeArrayCtorAbs, evalPromiseCtor, builtinCtorNameOf, hostBuiltinCtorName, makeProxyAbs, makeArrayBufferAbs, makeSharedArrayBufferAbs, makeDataViewAbs, makeTypedArrayAbs, makeUrlAbs, makeTextDecoderAbs, makeUrlSearchParamsAbs, makeBoxedAbs, evalRegExpCtor, evalDateCtor, makeDynamicFunctionAbs, makeWeakRefAbs, makeFinalizationRegistryAbs } from "../../builtins.ts";
import { makeMapAbs, makeSetAbs, ctorArgDefinitelyInvalid, makeWeakCollectionAbs } from "../../collections.ts";
import { isDefinitelyUndefinedAbs } from "./this-member.ts";
// 直连 member.ts（不经 containers barrel）：本模块体加载期即回调本 setter，
// vite SSR 下 barrel 的 re-export 不是实例化期可用绑定（原单文件拓扑中
// setter 是本模块提升函数声明）。barrel 间接层会在此处拿到 undefined。
import {
  blockHostSideEffect,
} from "../calls.ts";
import { errorTypeAbs, recordMayThrow } from "../may-throw.ts";
import { isNullishLitAbs } from "../../surface.ts";
import { NudoThrow } from "../runtime.ts";
import {
  registerEvalClass,
  registerClassValue,
  lookupClassValue,
  markClassValue,
  getEvalClass,
  ensureFnParentName,
  type EvalClassSpec,
} from "../class-registry.ts";


const classImpl = new WeakMap<object, EvalClassSpec>();

/** Bug 114：宿主 Symbol 命名空间的 well-known 反查表（键值 → "@@name"
 *  投影，懒建）。well-known symbol 是 Symbol 函数的自有**字符串名**属性
 *  （值为 symbol——getOwnPropertySymbols(Symbol) 反而是空表）；静态函数
 *  键（Symbol.for / Symbol.keyFor）同映射 "@@for"/"@@keyFor"（读侧
 *  [Symbol.X] 的 transpile 投影同串，两侧键字符串化恒等）。hasInstance/
 *  toStringTag（Bug 50/72 旧两名单）被本表包含。drops 只留真抽象键。 */
let wellKnownSymbolKeys: Map<unknown, string> | undefined;
function wellKnownSymbolKeyOf(v: unknown): string | undefined {
  if (!wellKnownSymbolKeys) {
    wellKnownSymbolKeys = new Map();
    for (const n of Object.getOwnPropertyNames(Symbol)) {
      const f = (Symbol as unknown as Record<string, unknown>)[n];
      if (typeof f === "symbol" || typeof f === "function") wellKnownSymbolKeys.set(f, `@@${n}`);
    }
  }
  return wellKnownSymbolKeys.get(v);
}

/** 定义类 → 可 new 的 Abs（brand 标记；静态字段挂在 slots） */
export function $class(
  name: string,
  spec: Omit<EvalClassSpec, "name"> & { extends?: string | Abs | unknown; hasExtends?: boolean },
): Abs {
  // extends 是活引用：类值取 brand 名、宿主 ctor 取 .name、字符串向后兼容。
  // 原生 ClassDefinitionEvaluation：superclass 须为 null 或 constructor，否则
  // **定义期** TypeError（Bug 11 前非 Identifier 表达式被静默丢弃、无校验）。
  // hasExtends 标记区分「extends undefined（babel Identifier → 活引用 raw
  // undefined）」与「无 extends 子句」——前者定义期即 TypeError。
  const ext = spec.extends;
  // bindImport 的 JS 可调用 wrapper（fn Abs → 箭头）：回 Abs 面（同 $new）——
  // wrapper 是箭头，hostFnCtorFacet 会误判不可构造
  const extAbsFn = (ext as { __nudoAbsFn?: Abs } | undefined)?.__nudoAbsFn;
  const extVal = extAbsFn ?? ext;
  let superName: string | undefined;
  let superNull = false;
  if (spec.hasExtends) {
    if (extVal === null) {
      // extends null 合法：无 super 原型链；new 时隐式/显式 super() 原生抛
      superNull = true;
    } else if (extVal === undefined) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    } else if (typeof extVal === "function") {
      // 宿主函数（extends Map / 求值引擎函数声明）：generator/async/箭头不可 new
      if (hostFnCtorFacet(extVal) === false) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      superName = (extVal as { name?: string }).name || undefined;
    } else if (typeof extVal === "string") {
      superName = extVal; // 向后兼容：名字字符串
    } else if (extVal && typeof extVal === "object" && "shape" in (extVal as object)) {
      const s = (extVal as Abs).shape;
      if (s.k === "brand") {
        superName = s.name;
      } else if (s.k === "fn") {
        // Bug 9 facet：非构造函数（箭头/方法/async/generator）→ 定义期 TypeError；
        // 未知可构造性（mock/桥接）→ may-throw。可构造 fn 取名作 super 链键。
        if (s.ctor === false) throw new NudoThrow(errorTypeAbs("TypeError"));
        if (s.ctor === undefined) {
          recordMayThrow({
            kind: "TypeError",
            cause: `class extends ${s.k} function value (may not be a constructor)`,
          });
        }
        // P3b：fn 值父类——匿名/别名函数表达式（`const Base = function(){}`）
        // 无 shape.name，此前 superName 断链（静态/原型/构造全丢）。合成伪
        // 父名（按 fn Abs 驻留）注册空 spec + 类值映射——链/槽/原型投影全
        // 可解；伪名不与用户类名/内建名碰撞。
        superName = ensureFnParentName(extVal as Abs);
      } else if (isNullishLitAbs(extVal as Abs)) {
        const lv = litValue(extVal as Abs);
        if (lv.ok && lv.value === null) superNull = true;
        else throw new NudoThrow(errorTypeAbs("TypeError")); // extends undefined → TypeError
      } else if (s.k === "prim" || s.k === "arr" || s.k === "tuple" || s.k === "eff") {
        // prim（含字面量）/数组/迭代产物绝非构造器 → 定义期确定 TypeError
        throw new NudoThrow(errorTypeAbs("TypeError"));
      } else if (s.k === "any" || s.k === "obj" || s.k === "sum") {
        // 抽象 superclass：可能不是构造器 → may-throw（sum 臂可能含可构造 fn）
        recordMayThrow({
          kind: "TypeError",
          cause: `class extends ${s.k} value (may not be a constructor)`,
        });
      }
      // unknown：引擎 fail-closed 令牌，不记（与 $call/$in 口径一致）
    } else {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  } else if (extVal !== undefined) {
    // 无 hasExtends 的旧调用面：原归一化（brand / 宿主函数 / 字符串）
    if (typeof extVal === "string") superName = extVal;
    else if (extVal && typeof extVal === "object" && "shape" in (extVal as object)) {
      const s = (extVal as Abs).shape;
      superName = s.k === "brand" ? s.name : undefined;
    } else if (typeof extVal === "function") {
      superName = (extVal as { name?: string }).name;
    }
  }
  const full: EvalClassSpec = {
    name,
    superName,
    ...(superNull ? { superNull: true } : {}),
    // N2：宿主内建父标记（真实 host fn 身份（hostBuiltinCtorOf 名→宿主
    // 恒等）或 builtinCtorAbs brand；mock 同名 fn Abs 不带）——内建父
    // 静态派发（builtinSuperCtorOf）的放行条件
    ...(superName && !superNull &&
        ((typeof extVal === "function" && hostBuiltinCtorOf(superName) === extVal) ||
          builtinCtorNameOf(extVal as object) === superName)
      ? { superBuiltinHost: true }
      : {}),
    ctor: spec.ctor,
    // P2b：构造器元数通道（未记录 → 不挂键，$get 折 unknown）
    ...(spec.ctorLength !== undefined ? { ctorLength: spec.ctorLength } : {}),
    methods: spec.methods,
    methodParams: spec.methodParams,
    staticMethods: spec.staticMethods,
    staticMethodParams: spec.staticMethodParams,
    statics: spec.statics,
    instanceFields: spec.instanceFields,
    accessors: spec.accessors,
    staticAccessors: spec.staticAccessors,
  };
  // Bug 60：计算键折叠——键表达式已在 spec 对象字面量构造时求值（定义期，
  // throws 效果已记录）。字面量 string/number 键 → 挂真名；抽象键
  // （any/symbol/…）无法静态列举 → 摘除 synth 名成员（不静默挂错名）。
  // Bug 50/72：宿主 well-known Symbol.hasInstance/toStringTag 的计算键投影
  // "@@hasInstance"/"@@toStringTag" 字符串槽名（镜像对象字面量
  // [Symbol.X] → "@@X" 的 transpile 投影）——$instanceof 读到即调用、
  // typeTagOf 标签折叠同臂。
  // Bug 114：投影泛化到全 well-known 表——transpile 读侧对任意 [Symbol.X]
  // 计算成员投 "@@X"，定义侧此前只认上述两名，species/iterator/match 等
  // 全被 drops 删除（读侧 "@@species" miss 折 exact undefined）。改查宿主
  // Symbol 命名空间反查表（wellKnownSymbolKeyOf）。
  if (spec.computedKeys) {
    const renames = new Map<string, string>();
    const drops = new Set<string>();
    for (const [synth, keyVal] of Object.entries(spec.computedKeys)) {
      const k = asAbsVal(keyVal);
      const lv = litValue(k);
      if (lv.ok && (typeof lv.value === "string" || typeof lv.value === "number")) {
        renames.set(synth, String(lv.value));
      } else {
        // Bug 114：well-known symbol 键（描述 "Symbol.X" → "@@X"）与宿主
        // Symbol 静态函数键（[Symbol.for] 等——读侧同投影 "@@for"，两侧
        // 键字符串化恒等）→ 挂投影名；drops 只留真正无法静态列举的抽象键。
        const wk = lv.ok ? wellKnownSymbolKeyOf(lv.value) : undefined;
        if (wk !== undefined) renames.set(synth, wk);
        else drops.add(synth);
      }
    }
    const rekey = (rec: Record<string, unknown> | undefined): void => {
      if (!rec) return;
      for (const [synth, real] of renames) {
        if (synth in rec && !(real in rec)) {
          rec[real] = rec[synth];
          delete rec[synth];
        }
      }
      for (const d of drops) delete rec[d];
    };
    rekey(full.methods);
    rekey(full.methodParams);
    rekey(full.staticMethods);
    rekey(full.staticMethodParams);
    rekey(full.statics);
    rekey(full.accessors);
    rekey(full.staticAccessors);
  }
  registerEvalClass(full);
  const slots: Record<string, { value: Abs }> = {};
  // R5：类值先行创建（共享空槽 brand）——静态字段 thunk 以类值为 this
  // 求值（原生 ClassFieldDefinitionEvaluation 的 receiver 是类值；源序
  // 逐槽就地 setSlot，经共享 slots 对类值立即可见）。类值身份标记同步
  // 前置：初始化器内 this.m() / this.#x 经注册表面即可派发。
  const val = abs(
    // ctor: true —— 类值 brand facet（构造器值本身）。实例 brand 无此
    // facet：严格相等可直接判定「实例 ≠ 类值」（new C() === C → false，
    // 原生两类值永不恒等）。leq/指纹按名义比较，facet 不参与。
    { k: "brand", name, shape: objOf(slots), ctor: true },
    undefined,
    undefined,
    "exact",
  );
  classImpl.set(val as object, full);
  markClassValue(val as object, name);
  // Bug 58：类值入名 → Abs 注册表——protoOfRecv 的父构造器投影按
  // superName 回取同一引用（Object.getPrototypeOf(B) === A 折 exact）
  registerClassValue(name, val);
  // 类值自有 name 属性（原生 Function.name；类表达式/声明均可读）。
  // N4：必须在静态字段 thunk 求值**前**落地——原生构造器创建即带 name，
  // 初始化器内 `C.name` 可读（"C"）；用户 `static name = "custom"` 字段
  // 在 statics 循环里按源序覆盖该槽（原生同名静态字段覆写 Function.name）。
  // 此前尾置：初始化器内 C.name 折 undefined，且用户 static name 被
  // 尾置 strLit(name) 冲回类名（双缺陷，同一处顺序修正）。
  setSlot(slots, "name", { value: strLit(name) });
  const evalStatic = (v: Abs | ((cls: Abs) => Abs)): Abs =>
    typeof v === "function" ? asAbsVal((v as (cls: Abs) => Abs)(val)) : asAbsVal(v);
  if (full.statics) {
    for (const [k, v] of Object.entries(full.statics)) setSlot(slots, k, { value: evalStatic(v) });
  }
  // Bug 50：static [Symbol.hasInstance]（方法/字段）以 "@@hasInstance" 槽
  // 挂到类值。R5：静态方法 impl 首参 __this = 类值——适配器把 receiver
  // 转发为首参（原生 instanceof 调用位 this = 类值）。
  // Bug 46 统一口径：适配器声明 bindThis——receiver 经 $call 第三参注入
  // 首参后由适配器剥掉再转发（继承（D extends C）由 $instanceof 的
  // registry 链查找兜住，不在此复制槽）。
  {
    const hiMethod = full.staticMethods?.["@@hasInstance"] as
      | ((thisVal: Abs, ...args: Abs[]) => Abs)
      | undefined;
    const hiFieldRaw = full.statics?.["@@hasInstance"];
    const hiParams = full.staticMethodParams?.["@@hasInstance"] ?? [];
    if (hiMethod) {
      setSlot(slots, "@@hasInstance", {
        value: absFunction(hiParams, {
          bindThis: true,
          apply: (args) => hiMethod((args ?? [])[0] ?? val, ...((args ?? []).slice(1))),
        }, { name: `${name}[Symbol.hasInstance]`, ctor: false }),
      });
    } else if (hiFieldRaw !== undefined) {
      // 上方 statics 循环已求值 thunk（同名槽）——取既有结果，不重复求值
      const fieldAbs = getSlot(slots, "@@hasInstance")?.value ?? evalStatic(hiFieldRaw);
      setSlot(slots, "@@hasInstance", {
        value: absFunction(hiParams, {
          bindThis: true,
          // 内层 fn 的 receiver 原样转发（bindThis 内层 → 派发再注入首参；
          // 普通 fn → 宿主 this）——`static [Symbol.hasInstance] = 方法`
          // 的 this 语义保持 instanceof 调用位（this = 类值）
          apply: (args) =>
            $call(fieldAbs, (args ?? []).slice(1), (args ?? [])[0]),
        }, { name: `${name}[Symbol.hasInstance]`, ctor: false }),
      });
    }
  }
  return val;
}

export function specOf(cls: Abs): EvalClassSpec | undefined {
  if (classImpl.has(cls as object)) return classImpl.get(cls as object);
  if (cls.shape.k === "brand") return getEvalClass(cls.shape.name);
  return undefined;
}

/** 沿继承链找方法 */
export function findMethod(
  startName: string,
  method: string,
): ((thisVal: Abs, ...args: Abs[]) => Abs) | undefined {
  let cur: string | undefined = startName;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const spec = getEvalClass(cur);
    if (spec?.methods?.[method]) return spec.methods[method];
    cur = spec?.superName;
  }
  return undefined;
}

/** 沿继承链找静态方法（Bug 18）：原生静态方法挂构造器 [[Prototype]] 链
 *  （ClassDefinitionEvaluation 设 B.__proto__ = A）——空派生类
 *  `class B extends A {}` 的 B.m() 不得断链（与 findMethod 实例链同口径）。 */
export function findStaticMethod(
  startName: string,
  method: string,
): ((thisVal: Abs, ...args: Abs[]) => Abs) | undefined {
  let cur: string | undefined = startName;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const spec = getEvalClass(cur);
    if (spec?.staticMethods?.[method]) return spec.staticMethods[method];
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
export function chainHasStaticMember(startName: string, key: string): boolean {
  for (const n of evalClassChain(startName)) {
    const spec = getEvalClass(n);
    if (spec?.staticMethods?.[key] || spec?.staticAccessors?.[key]) return true;
    if (spec?.statics && key in spec.statics) return true;
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
  return evalClassChain(brandName).some((n) =>
    getEvalClass(n)?.instanceFields?.some((f) => f.name === key),
  );
}

/**
 * Bug 59：实例字段落地——以 thisVal 为 this 按源序求值（原生
 * InitializeInstanceElements：基类 ctor 体前 / super() 返回后）。
 * $set 对 brand 实例就地写槽，每构造一个新实例各自持有字段。
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
    cur = $set(cur, key, asAbsVal(f.init(cur)), { internal: f.private === true });
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
export function constructClass(className: string, thisVal: Abs, args: Abs[]): Abs {
  const spec = getEvalClass(className);
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
        return abs(
          { k: "brand", name: instName, shape: built.shape.shape },
          built.term,
          built.pred,
          built.conf,
        );
      }
    }
    return thisVal;
  }
  if (spec.ctor) {
    let tv = thisVal;
    if (!spec.superName && !spec.superNull) tv = applyInstanceFields(spec, tv);
    const after = spec.ctor(tv, ...args);
    if (after && after.shape.k === "brand") return after;
    // Bug 17：ES [[Construct]] 返回值语义——undefined（宿主 undefined / lit
    // undefined）→ this；其余原始值（prim 域或字面量；null 折 unknown+
    // lit(null)）：基类忽略 → this，派生类 TypeError（Derived constructors
    // may only return object or undefined）。
    if (after === undefined || after === null) return tv;
    if (after && typeof after === "object" && "shape" in (after as object)) {
      if (isDefinitelyUndefinedAbs(after)) return tv;
      if (
        after.shape.k === "prim" ||
        (after.term?.op === "lit" && after.term.value === null)
      ) {
        if (spec.superName || spec.superNull) {
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
        return tv;
      }
    }
    return after ?? tv;
  }
  if (spec.superNull) {
    // Bug 11：extends null 链上的隐式构造器等价 super(...args)，原生抛
    // TypeError（Super constructor null … is not a constructor）
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (spec.superName) {
    const afterSuper = constructClass(spec.superName, thisVal, args);
    return applyInstanceFields(spec, afterSuper);
  }
  return applyInstanceFields(spec, thisVal);
}

/** new C(...) → 空 brand 实例 + ctor 写字段；非类构造走 impl/$call */
export function $new(cls: Abs | ((...a: unknown[]) => unknown), args: Abs[]): Abs {
  // bindImport 的 JS 可调用 wrapper（fn Abs → 箭头）：回 Abs 面派发——
  // wrapper 本身是箭头，hostFnCtorFacet 会误判不可构造（Bug 9 假抛）
  const wrappedAbs = (cls as { __nudoAbsFn?: Abs } | undefined)?.__nudoAbsFn;
  if (wrappedAbs) return $new(wrappedAbs, args);
  // Abs 侧内建构造器（builtinCtorAbs / env fn）：按名派发。
  // dual-facet 全局（Array/Date/Promise/Number…）经 env 遮蔽后 cls 是 Abs，
  // 必须走 evalBuiltinNew 按名构造，否则 $call 回退对无 apply 的 obj 折 unknown。
  if (cls && typeof cls === "object" && "shape" in (cls as object)) {
    const cs = (cls as Abs).shape;
    const ctorName =
      cs.k === "brand"
        ? cs.name
        : builtinCtorNameOf(cls) ?? (cs.k === "fn" ? (cs.name ?? undefined) : undefined);
    if (ctorName) {
      const built = evalBuiltinNew(ctorName, args);
      if (built !== undefined) return built;
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
    if (clsName === "URL") return makeUrlAbs(args[0], args[1]);
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
      return makeTextDecoderAbs(args[0]);
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
        if (
          after &&
          typeof after === "object" &&
          "shape" in (after as object) &&
          (after.shape.k === "brand" || after.shape.k === "obj")
        ) {
          return after;
        }
        return thisVal;
      } finally {
        evalExitCall();
        popCtorFrame();
      }
    }
    const shape = objOf({});
    return abs({ k: "brand", name: clsName, shape }, undefined, undefined, "path");
  }
  // Bug 46：裸宿主命名空间对象（Math/JSON/Reflect——typeof "object" 且无
  // shape）作为 $new 接收者：原生 IsConstructor 恒 false → 确定 TypeError
  // （与 Symbol/BigInt 非构造器同口径；此前直达 specOf 裸解引用 cls.shape.k
  // 引擎内部崩溃，被 run.ts catch-all 兜底成 unknown + 假 may-throw）
  if (cls && typeof cls === "object" && !("shape" in (cls as object))) {
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
    const fs = cls && typeof cls === "object" && "shape" in (cls as object)
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
        // P3b：匿名函数表达式构造器——实例 brand 用伪父名（ensureFnParentName
        // 注册链键），`new Base().x` 沿 memo prototype 折精确、instanceof /
        // constructor 同链可解；有名 fn（Named NFE）保持声明名。
        const instName = fs.name ?? ensureFnParentName(cls as Abs);
        // Bug 16：可构造 fn Abs（$fnVal 函数表达式值等）按 [[Construct]]
        // 执行体——apply 钩子承接 Abs thisVal（非 bindThis 的 thisArg 传入），
        // 返回 Abs 对象优先、undefined/原始值忽略（基类语义）
        const impl = getFnImpl(cls as Abs);
        if (impl?.apply) {
          const thisVal = abs(
            { k: "brand", name: instName, shape: objOf({}) },
            undefined,
            undefined,
            "path",
          );
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
            if (
              after &&
              typeof after === "object" &&
              "shape" in (after as object) &&
              (after.shape.k === "brand" || after.shape.k === "obj")
            ) {
              return after;
            }
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
  // Bug 79：new.target 帧——构造器体/实例字段初始化器内 new.target = 被构造
  // 的类值；嵌套普通调用（$call/$invoke 面已清空）读 undefined（原生语义）。
  pushCtorFrame(cls);
  try {
    const inst = constructClass(className, thisVal, args);
    // R2b：每次 new 产出新实例——brand 形打新鲜实例标（=== 折 false；
    // 构造器 return 既有对象时重打只改该 Abs 引用的 id，别名恒等不受影响）
    return inst.shape.k === "brand" ? markFreshInstance(inst) : inst;
  } finally {
    popCtorFrame();
  }
}

/**
 * Bug 77：静态块在类定义期执行（原生 ClassDefinitionEvaluation 的
 * InitializeStaticElements）。transpile 在 `let C = $class(...)` 绑定完成
 * **之后**发射本调用——块体内类名按词法可见（原生 static 块内类绑定已
 * 初始化）；this 绑定类值；块内 throw 在定义点表面（NudoThrow 上浮）。
 */
export function $staticInit(cls: Abs, thunks: Array<(thisVal: Abs) => unknown>): void {
  for (const t of thunks) t(cls);
}
