/**
 * 类定义期：$class（类定义 → spec + 注册链）。构造/查找期（$new /
 * constructClass / findMethod / findStaticMethod / deleteProtoMethod 等）
 * 已拆至 ./construct.ts——本文件尾部保 facade re-export 维持既有 import 面
 * （exec/class.ts barrel / class/invoke.ts / class/super.ts /
 * class/this-member.ts / class/proto-borrow.ts / runtime/members.ts 及
 * algebra/__tests__ 均仍从本文件引）。
 *
 * Invariants:
 * - 类值/实例的 spec 挂载在 class-registry.ts 的**随值携带**侧表（WeakMap：
 *   Abs 对象身份 → 定义 spec，BUG-172）：类值在 $class 建值处 attachClassSpec，
 *   brand 形状重造/快照处过户——类域重铸点统一走 rebrand.ts 的
 *   rebrandClassAbs（随值规格 + superCalled 标记集；obj.ts 快照分支在
 *   RT 域、仍直接调 carryClassSpec）。同名类跨 run last-wins
 *   重注册换新 spec（驻留侧表随旧 spec 回收）。
 * - 实例字段就地突变（applyInstanceFields 落 inner obj 槽，见 construct.ts）：
 *   原生引用共享语义——方法内 this.x = v 对调用点持有的同一实例 Abs 可见。
 * - new 的 ctor 帧走 pushCtorFrame/popCtorFrame；new.target 通道由
 *   withNewTargetReset 包裹（嵌套 new 不串帧）（两符号均在 construct.ts）。
 * - 模块级可变状态各归一期、不得分裂成两份：wellKnownSymbolKeys
 *   （Bug 114 well-known symbol 反查表，懒建）在本文件（定义期）；
 *   bindCtorFacets（Bug 253 bind 产物 [[Construct]] facet 侧表）在
 *   construct.ts（构造期）。
 */
import type { Abs } from "../../abs.ts";
import { abs, litValue, strLit, isAbsLike } from "../../abs.ts";
import { objOf, getSlot, setSlot } from "../../objects.ts";
import { hostBuiltinCtorOf } from "../runtime/members.ts";
import { builtinCtorNameOf } from "../../builtins.ts";
import { asAbsVal, NudoThrow } from "../runtime.ts";
import { $call } from "../call.ts";
import { absFunction, hostFnCtorFacet } from "../../abs-fn.ts";
import { errorTypeAbs, recordMayThrow } from "../may-throw.ts";
import { isNullishLitAbs } from "../../surface.ts";
import {
  registerEvalClass,
  registerClassValue,
  markClassValue,
  attachClassSpec,
  classSpecOfAbs,
  ensureFnParentName,
  type EvalClassSpec,
} from "../class-registry.ts";

/**
 * Bug 245：派生构造器「本帧已调 super」状态（**模块级 WeakMap 侧表**）。
 *
 * 原生语义（ES2023 15.7.1 / 15.7.6）：
 * - 派生类构造器**必须**在访问 `this` / 返回前调用一次 `super()`；
 *   一次都不调用 ⇒ ReferenceError（"Must call super constructor in derived
 *   class before accessing 'this' or returning from derived constructor"）。
 * - 第二次调用 `super()` ⇒ ReferenceError（"Super constructor may only be
 *   called once"）。
 *
 * 状态键 = 实例 Abs 身份；值 = **已调过 super 的子类名集合**——同一实例
 * 沿继承链逐层传递（`class D extends B extends A`：B 层的 super() 不得
 *   被误判成 D 层的「已调」）。`$super` 每次返回**新** brand Abs（内层 obj
 *   共享），故标记同时落在入参与出参上。
 *
 * 选型理由（AGENT-CONTEXT §4 允许「Shape 可选字段」或「模块级 WeakMap」）：
 * 选**模块级 WeakMap**——该状态是「一次构造过程」的瞬时事实，不是值的
 * 形状；写进 Shape 会把构造期状态混进类型系统（brand 的 leq / 指纹 /
 *   展示面都会带上瞬时状态）。WeakMap 随实例 Abs 回收，无泄漏。
 */
/*
 * Bug 245 的「本帧已调 super」状态侧表已下沉到 exec/super-access.ts（叶子，
 * 供 $get/$set/$idx/$idxSet/$invoke 的 this 访问门共用，避免 declare ↔
 * containers 的模块环）。本文件保留同名 re-export 维持既有 import 面。
 */
export { markSuperCalled, superCalledFor } from "../super-access.ts";

/**
 * Bug 142：静态块保留键前缀（NUL 开头——用户键不可能自然命中；与
 * transpile/class-emit.ts 的同名常量保持一致）。静态块与静态字段同表
 * （源码序），$class 逐项执行——保留键项只执行块体、不挂静态槽。
 */
const STATIC_BLOCK_KEY_PREFIX = "\u0000nudoStaticBlock:";

/**
 * Bug 90：spec 成员记录的 own-property 语义（第一道，源头治理）——
 * transpile 侧（class-emit）产出的 methods/staticMethods/… 是宿主普通
 * 对象字面量，`spec.methods[key]` 原型链取值会把 Object.prototype 继承名
 * （toString/valueOf/hasOwnProperty/isPrototypeOf/propertyIsEnumerable/
 * toLocaleString/constructor/__proto__/__defineGetter__…）当类成员：
 * c.toString() 折 "[object Undefined]"、c.hasOwnProperty(k) 假 TypeError、
 * c.constructor === C 假 false。$class 是**唯一**带记录的注册入口
 * （registerEvalClass 其余调用面均 name-only）——在此把 7 张记录复制为
 * null 原型容器，registry 全部读点（含 declare/member 之外的
 * members.ts/super.ts/obj.ts/class-registry.ts 外围索引）随之安全。
 */
function ownRec<T>(rec: Record<string, T> | undefined): Record<string, T> | undefined {
  if (rec === undefined) return undefined;
  const out = Object.create(null) as Record<string, T>;
  for (const k of Object.keys(rec)) out[k] = rec[k];
  return out;
}

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

/** 定义类 → 可 new 的 Abs（brand 标记；静态字段挂在 slots）。
 *  displayName（Bug 133）：对外可见的 **name**（原生无名类名为空串）；缺省
 *  用内部类名（类声明 / 具名类表达式同口径）。 */
export function $class(
  name: string,
  spec: Omit<EvalClassSpec, "name"> & { extends?: string | Abs | unknown; hasExtends?: boolean },
  displayName?: string,
): Abs {
  // extends 是活引用：类值取 brand 名、宿主 ctor 取 .name、字符串向后兼容。
  // 原生 ClassDefinitionEvaluation：superclass 须为 null 或 constructor，否则
  // **定义期** TypeError（Bug 11 前非 Identifier 表达式被静默丢弃、无校验）。
  // hasExtends 标记区分「extends undefined（babel Identifier → 活引用 raw
  // undefined）」与「无 extends 子句」——前者定义期即 TypeError。
  const ext = spec.extends;
  // Bug 932 顺带清理：具名导入物化不再把 fn Abs 包成 JS 箭头 wrapper
  // （bindImport 原样直出声明 Abs）⇒ `__nudoAbsFn` 回读已无生产方（死代码）。
  const extVal = ext;
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
    } else if (isAbsLike(extVal)) {
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
  }
  // 无 hasExtends 的旧调用面（brand/宿主函数/字符串归一化）已删：唯一
  // extends 发射面 transpile/class-emit.ts 始终与 hasExtends: true 成对
  // 发射；手写 spec（测试 / mock 桥）不传 extends。
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
    // Bug 90：记录容器一律换 null 原型副本（见 ownRec 注释）
    methods: ownRec(spec.methods),
    methodParams: ownRec(spec.methodParams),
    // Bug 325：类方法的函数种类戳（async × generator 四象限）——读取面
    // classMethodValueAbs 打 impl.fnKind ⇒ 标签面 AsyncFunction / …。
    ...(spec.methodKinds ? { methodKinds: ownRec(spec.methodKinds) } : {}),
    staticMethods: ownRec(spec.staticMethods),
    staticMethodParams: ownRec(spec.staticMethodParams),
    ...(spec.staticMethodKinds ? { staticMethodKinds: ownRec(spec.staticMethodKinds) } : {}),
    statics: ownRec(spec.statics),
    instanceFields: spec.instanceFields,
    accessors: ownRec(spec.accessors),
    staticAccessors: ownRec(spec.staticAccessors),
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
      // Bug 142：保序重建——synth → 真名的重挂不得打乱记录序（静态元素按
      // 表序执行：静态块与静态字段交错；重命名后置到表尾会丢类体源码序）。
      // 口径不变：真名已被占用则不重命名（保留 synth 名）；抽象键摘除。
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rec)) {
        if (drops.has(k)) continue;
        const real = renames.get(k);
        if (real !== undefined && !(real in rec) && !(real in out)) {
          out[real] = v;
          continue;
        }
        out[k] = v;
      }
      for (const k of Object.keys(rec)) delete rec[k];
      Object.assign(rec, out);
    };
    rekey(full.methods);
    rekey(full.methodParams);
    // Bug 325：方法种类戳表随计算键折叠同步换名（否则 synth 名与真名错位）
    rekey(full.methodKinds);
    rekey(full.staticMethods);
    rekey(full.staticMethodParams);
    rekey(full.staticMethodKinds);
    rekey(full.statics);
    rekey(full.accessors);
    rekey(full.staticAccessors);
    // Bug 139：实例字段的计算键（synth 名）同 statics 折叠真名——键表达式
    // 已在定义期求值（computedKeys 表），此处只把 synth 名换成真名；抽象键
    // （any/symbol/…）不可静态列举 → 丢弃该字段（不假精确挂名，与旧
    // 逐实例求值口径的"抽象键跳过"一致）。
    if (full.instanceFields) {
      const kept: NonNullable<EvalClassSpec["instanceFields"]> = [];
      for (const f of full.instanceFields) {
        if (f.name !== undefined && renames.has(f.name)) {
          kept.push({ ...f, name: renames.get(f.name)! });
        } else if (f.name !== undefined && drops.has(f.name)) {
          // 抽象计算键——不挂名
        } else {
          kept.push(f);
        }
      }
      full.instanceFields = kept;
    }
  }
  // BUG-172：父类**规格身份**随 extends 活引用取得（只认随值携带的身份，
  // 不按名牌回表——回表正是串味的来源）。内建父无身份 ⇒ 不挂。
  if (!superNull && isAbsLike(extVal)) {
    const sup = classSpecOfAbs(extVal as Abs);
    if (sup) full.superSpec = sup;
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
  // BUG-172：规格随类值携带（成员查表按值自己的规格解析，不再裸名回表）
  attachClassSpec(val, full);
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
  // Bug 133：name 槽取**对外可见**的类名（无名类为空串——原生口径）；内部
  // 类名（brand 名 / 类注册键 / super 链键）仍是 name。
  setSlot(slots, "name", { value: strLit(displayName ?? name) });
  const evalStatic = (v: Abs | ((cls: Abs) => Abs)): Abs =>
    typeof v === "function" ? asAbsVal((v as (cls: Abs) => Abs)(val)) : asAbsVal(v);
  if (full.statics) {
    // Bug 142：静态元素按**类体源码序**执行——静态字段初始化器与静态块
    // 同表（transpile 侧合并），静态块以保留键（NUL 前缀，用户键不可能
    // 自然命中）入表：执行块体（this = 类值）但不挂静态槽。保留键前缀与
    // transpile/class-emit.ts 的同名常量保持一致。
    for (const [k, v] of Object.entries(full.statics)) {
      if (k.startsWith(STATIC_BLOCK_KEY_PREFIX)) {
        evalStatic(v);
        continue;
      }
      setSlot(slots, k, { value: evalStatic(v) });
    }
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


// ---- 构造/查找期 facade（./construct.ts）---------------------------------
// 定义期（本文件 $class）与构造/查找期（construct.ts）分文件后，下列符号
// 经此 re-export 维持既有 import 面；两文件互不 import 对方（facade 单向：
// declare → construct），既有模块环（declare ↔ this-member / members 等）
// 上的全部消费点都在函数体内解引用（无加载期调用），re-export 不改变
// 实例化序。
export {
  type BindCtorFacet,
  markBindCtorFacet,
  bindCtorFacetOf,
  fnAbsCtorProtoOf,
  specOf,
  findMethod,
  deleteProtoMethod,
  findStaticMethod,
  chainHasStaticMember,
  instanceOwnFaceHasMember,
  applyInstanceFields,
  constructClass,
  $new,
} from "./construct.ts";
