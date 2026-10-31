/**
 * B class 规格表（无 call 依赖，避免循环）。
 * Abs-eval registerClassDecl 与 transpile $class 共用。
 */

import type { Abs } from "../abs.ts";
import { abs } from "../abs.ts";
import { markClassValue, classNameOfValue } from "../class-mark.ts";
import { setPropFlags } from "../builtins/invariants.ts";
import { ERROR_CTOR_NAMES } from "../error-names.ts";

// 类值身份标记在 class-mark.ts（algebra 叶子）；此处 re-export 维持既有 import 面
export { markClassValue, classNameOfValue };

export type EvalClassAccessor = {
  get?: (thisVal: Abs) => Abs;
  set?: (thisVal: Abs, v: Abs) => Abs;
};

export type EvalClassSpec = {
  name: string;
  superName?: string;
  /**
   * BUG-172：父类的**规格身份**（`extends` 活引用在定义期解析所得）。
   * 裸名 superName 在多模块同名父类下会解析到别的模块那一份；构造递归
   * / 原型与静态链优先用本字段，缺失才按 superName 回表（内建父无此槽）。
   */
  superSpec?: EvalClassSpec;
  /**
   * Bug 11：`class C extends null`（合法——原型链无 super，但构造受限）。
   * 隐式 ctor 等价 super(...args)，原生 new C() 抛 TypeError
   * （Super constructor null … is not a constructor）；显式 super() 同抛（$super）。
   */
  superNull?: boolean;
  /**
   * N2：extends 目标是**宿主**内建构造器（host fn 或 builtinCtorAbs brand
   * 身份）——类值静态读/调用（B.keys / E.captureStackTrace）沿链到未注册
   * 父名时凭此标记走宿主静态通道。mock/桥接父类（fn Abs 同名）不带标记
   * → 无通道 → sound unknown（不折 undefined / 不误派发宿主真值）。
   */
  superBuiltinHost?: boolean;
  ctor?: (thisVal: Abs, ...args: Abs[]) => Abs;
  methods?: Record<string, (thisVal: Abs, ...args: Abs[]) => Abs>;
  /** 实例方法形参展示名（AST 形参名；未调用方法槽 `shape.params` 用） */
  methodParams?: Record<string, string[]>;
  /**
   * Bug 325：实例方法的**函数种类**戳（async × generator 四象限）——
   * 原生类方法的标签面（Object.prototype.toString.call(A.prototype.m)）
   * 随 async / generator 变（"[object AsyncFunction]" 等）。类方法**同时**
   * 可能是 generator ⇒ 与 impl.kind 的派发角色维度分开承载。
   */
  methodKinds?: Record<string, "function" | "async" | "generator" | "async-generator">;
  /** R5：静态方法 impl 首参 __this = 类值（接收者——沿链调用时是调用类） */
  staticMethods?: Record<string, (thisVal: Abs, ...args: Abs[]) => Abs>;
  /** 静态方法形参展示名 */
  staticMethodParams?: Record<string, string[]>;
  /** Bug 325：静态方法的函数种类戳（实例方法同口径） */
  staticMethodKinds?: Record<string, "function" | "async" | "generator" | "async-generator">;
  /**
   * P2b：构造器元数（首个默认值/rest 形参前的形参数，nativeParamArity
   * 口径）——类值 .length 自有属性。隐式构造器（基类零参 / 派生
   * `(...args){super(...args)}`）恒 0。transpile 期记录；未记录的手写
   * spec（mock 等）undefined → $get 折诚实 unknown（不假 0）。
   */
  ctorLength?: number;
  /**
   * 静态字段：R5 起值可为 thunk（以类值为 this 求值——原生
   * ClassFieldDefinitionEvaluation 的 receiver 是类值；箭头/`this.x`
   * 读写随之恢复）。旧行（宿主 Abs）保持兼容。
   */
  statics?: Record<string, Abs | ((cls: Abs) => Abs)>;
  /**
   * Bug 59：实例字段——每次 $new 以新实例为 this 按源序求值（原生
   * InitializeInstanceElements）。name 为字面量键；key 为计算键的
   * 每次构造求值 thunk（原生计算键逐实例求值）；抽象键不可静态命名
   * → 跳过（不假精确挂名）。
   */
  instanceFields?: Array<{
    name?: string;
    key?: (thisVal: Abs) => Abs;
    init: (thisVal: Abs) => Abs;
    /**
     * Bug 84：PrivateName 声明的私有字段（transpile 期标记）——落地槽打
     * Slot.internal，对所有属性 introspection 不可见（内部槽语义）；
     * 计算键公共字段（如 ["#x"]）不带此标记（同键空间共存）。
     */
    private?: boolean;
  }>;
  /**
   * Bug 60：计算键成员——synth 名 → 键 Abs（定义期求值，求值本身即
   * 记录 throws）。$class 折叠字面量 string/number 键为真名重挂；
   * 抽象键（any/symbol/…）不可静态列举 → 成员不挂名（不静默错名）。
   */
  computedKeys?: Record<string, unknown>;
  /** 实例 get/set：get 无参返回 Abs；set 收到 (thisVal, v) 返回更新后的 thisVal */
  accessors?: Record<string, EvalClassAccessor>;
  /** 静态 get/set：挂在类构造器上，不在实例原型链 */
  staticAccessors?: Record<string, EvalClassAccessor>;
};

/** 内建错误层级（Error 为根，registry 无 superName 时回退）。
 *  放本叶子模块：evalClassChain（exec/runtime/members.ts）与
 *  protoOfRecv（builtins/ctor.ts）共用，后者不可反向引 members（环）。
 *  键集与 algebra/error-names.ts 的 ERROR_CTOR_NAMES 同源（该叶子不 import
 *  任何模块——本文件不可反引 builtins/error/error-family.ts，那条链经
 *  exec/may-throw 回到本文件，会成环）。 */
export const BUILTIN_ERROR_SUPER: Record<string, string> = Object.fromEntries(
  [...ERROR_CTOR_NAMES].map((name): [string, string] => [name, name === "Error" ? "" : "Error"]),
);

// ---- BUG-172：类规格**随值携带** -----------------------------------------
/**
 * 注册表以**裸类名**为主键：两个模块各自定义 `class Config` 时后者覆盖
 * 前者 ⇒ 从 A 模块拿到的实例，读成员时按 B 模块的成员表解析（真成员判
 * 不存在、不存在的成员判有值，双向错且零诊断）。
 *
 * 修法（本文件负责的一半）：`$class` 产出的**规格对象本身**就是每次注册
 * 唯一的值——把它随 brand 值携带（WeakMap：Abs 身份 → 规格）。成员查表
 * 处（exec/runtime/members.ts、builtins/ctor.ts）优先用**值自己的规格**，
 * 不再按名回表；名牌回表（last-wins）保留为回退面：内建 brand、以及只
 * 拿得到名牌的观测面（format / denote / 部分 builtins）口径不变。
 *
 * 为什么不是给 brand 名加命名空间：brand 名是用户可见的类型名
 * （algebra/format.ts 的 brand 臂直接渲染 `s.name`），加前缀会漏进签名 /
 * dts / schema 产物。
 * 为什么不改注册表主键：名牌查表面散布在 60+ 处（多数在 builtins/ 与
 * objects.ts，不在本片可改范围），改主键会牵动整个观测面。随值携带是
 * **局部精确化**：有接收者值的地方精确，只有名牌的地方维持既有语义。
 *
 * 副本：`$copy` / fork 快照会重造 Abs 包装（exec/runtime/containers/obj.ts
 * 的 brand 分支），迁移点统一调 carryClassSpec——与 migrateFreshInstance /
 * copyMatchIterTables 的既有做法同口径。键是 Abs 对象身份（WeakMap），
 * 不会滞留规格对象 ⇒ 无记忆泄漏。
 */
const classSpecByValue = new WeakMap<object, EvalClassSpec>();

/** 类规格挂到类值 / 实例 brand 上（`$class` / `$new` / `$super` 建值处） */
export function attachClassSpec(v: Abs, spec: EvalClassSpec): Abs {
  classSpecByValue.set(v as object, spec);
  return v;
}

/** 值上随带的类规格（非用户类值 / 内建 brand → undefined） */
export function classSpecOfAbs(v: Abs | undefined): EvalClassSpec | undefined {
  if (!v || typeof v !== "object") return undefined;
  return classSpecByValue.get(v as object);
}

/** 规格过户（brand 形状重造处统一调用——副本 / 换形后身份不丢） */
export function carryClassSpec(from: Abs, to: Abs): Abs {
  const spec = classSpecByValue.get(from as object);
  if (spec !== undefined) classSpecByValue.set(to as object, spec);
  return to;
}

const classRegistry = new Map<string, EvalClassSpec>();
/** BUG-026：注册 epoch——同名类碰撞只在同一次求值
 * run 内才是真歧义（块级作用域同名类）；跨 run 的
 * 重注册是常态（多文件顺序分析 / 文件编辑后重评估），
 * 走 last-wins 覆盖语义（会话缓存的 brand 查找
 * 依赖注册表跨 run 存活，不得逐 run 清空）。 */
let classEpoch = 0;
const classEpochs = new Map<string, number>();

/**
 * BUG-026：同名类碰撞记录（裸名键消歧失败）。
 * 裸名键是运行时查找面（brand 名即查找键，
 * 继承链 / $new 均按名解析）——碰撞无法在
 * 查找侧消歧，只能在注册侧观测。
 */
export type EvalClassCollision = {
  name: string;
  /** 碰撞双方的可辨识特征（ctor 名 + 方法/静态键集） */
  previous: string;
  next: string;
};

const classCollisions: EvalClassCollision[] = [];

/** 开新求值 epoch（runTranspiledInner 入口） */
export function beginClassEpoch(): void {
  classEpoch++;
}

/** 排出并清空碰撞记录（每次求值出口由 run.ts 排空） */
export function drainClassCollisions(): EvalClassCollision[] {
  return classCollisions.splice(0, classCollisions.length);
}

/** spec 可辨识特征：同形 → 同作用域重注册（覆盖语义正确） */
function specShape(spec: EvalClassSpec): string {
  const ctorName = spec.ctor?.name ?? "anon";
  const methods = Object.keys(spec.methods ?? {}).sort().join(",");
  const statics = Object.keys(spec.staticMethods ?? {}).sort().join(",");
  const accessors = Object.keys(spec.accessors ?? {}).sort().join(",");
  const fields = Object.keys(spec.statics ?? {}).sort().join(",");
  const instFields = (spec.instanceFields ?? [])
    .map((f) => f.name ?? "<computed>")
    .sort()
    .join(",");
  return `${ctorName}[${methods}](${statics}){${accessors}}{${fields}}{${instFields}}`;
}

export function registerEvalClass(spec: EvalClassSpec): void {
  const prev = classRegistry.get(spec.name);
  const prevEpoch = classEpochs.get(spec.name);
  if (
    prev &&
    prev !== spec &&
    // 同 epoch（同一次 run 内）注册两次才可能是真碰撞：
    // 块级作用域同名类。跨 epoch = 顺序重注册（常态）。
    prevEpoch === classEpoch &&
    specShape(prev) !== specShape(spec)
  ) {
    // BUG-026：旧实现 Map.set 裸名键——同 run 两处
    // 同名类静默 clobber，$new / 成员查找解析到错误
    // spec 且无诊断。不同形碰撞记入排水缓冲，由求值
    // 出口排进回落观测面（unsupported:class-collision）。
    classCollisions.push({
      name: spec.name,
      previous: specShape(prev),
      next: specShape(spec),
    });
  }
  classRegistry.set(spec.name, spec);
  classEpochs.set(spec.name, classEpoch);
}

export function getEvalClass(name: string): EvalClassSpec | undefined {
  return classRegistry.get(name);
}

/**
 * Bug 365：kind 名是否属于 **Error 家族**（内建错误名 + **用户自定义
 * Error 子类**）。
 *
 * `@nudo:throws Error` / `package.json#nudo.check.ignoreThrows = ["Error"]`
 * 的承诺是「**与 instanceof 语义一致 / 覆盖全部子类**」⇒ 用户类
 * `class MyError extends Error {}` 必须被 `Error` 覆盖。
 * 静态内建名集合（`ERROR_FAMILY`）判不出用户子类 ⇒ 假红。
 *
 * 运行时信息已具备：注册表里该类的 `superName` 链
 * （`getEvalClass("MyError").superName === "Error"`）⇒ 沿链上溯即可，
 * **无需新增公共导出**（本函数不被三个公共入口 re-export）。
 */
export function isErrorFamilyKind(kind: string): boolean {
  // 内建错误名（Error / TypeError / RangeError / …）
  if (Object.hasOwn(BUILTIN_ERROR_SUPER, kind)) return true;
  // 用户类：沿 superName 链上溯，看是否落到内建 Error 家族
  let cur: string | undefined = kind;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (Object.hasOwn(BUILTIN_ERROR_SUPER, cur)) return true;
    const spec = classRegistry.get(cur);
    if (!spec) return false;
    cur = spec.superName;
  }
  return false;
}

/** Bug 58：类值 Abs 注册表（名 → $class 产出的类值本身）。
 *  protoOfRecv 的父构造器投影按 superName 回取**同一** Abs 引用——
 *  `Object.getPrototypeOf(B) === A` 折 exact true 的前提（品牌 === 按
 *  引用恒等，不按名折叠）。与 spec 注册表同生命周期（last-wins /
 *  clearBClasses 同清）。 */
const classValues = new Map<string, Abs>();

export function registerClassValue(name: string, value: Abs): void {
  classValues.set(name, value);
}

export function lookupClassValue(name: string): Abs | undefined {
  return classValues.get(name);
}

// ---- P3b：fn 值父类身份（函数/类表达式值作 extends 目标） ------------------
// 匿名函数表达式父类（`const Base = function(){}; class B extends Base {}`）
// 无 shape.name 可作 superName 链键——N2 前直接断链。机制：按 fn Abs 驻留
// 「伪父名」（WeakMap，同 fn 跨 $class 复用），名下注册空 spec（链可走）
// + 类值映射（伪名 → fn Abs 本身——类值槽走 / protoOfRecv 父构造器投影
// 取同一引用）。伪名唯一（不与用户类名/内建名碰撞，无 BUG-026 碰撞面）。

const fnParentNames = new WeakMap<object, string>();
let fnParentSeq = 0;

/** fn Abs → 伪父名（不存在则合成并注册空 spec + 类值映射）。 */
export function ensureFnParentName(fnAbs: Abs): string {
  let n = fnParentNames.get(fnAbs);
  if (n === undefined) {
    n = `__nudoFnParent${++fnParentSeq}`;
    fnParentNames.set(fnAbs, n);
    registerEvalClass({ name: n });
    registerClassValue(n, fnAbs);
  }
  return n;
}

/** fn Abs 的 prototype 对象（按 fn Abs 驻留；原地可变跨读存活——原生每
 *  fn 唯一共享 prototype，`f.prototype === f.prototype` 恒真、
 *  `Base.prototype.x = 1` 写后读可见）。constructor 槽指回 fn 自身
 *  （MakeConstructor 语义）。 */
const fnProtos = new WeakMap<object, Abs>();

export function fnProtoOf(fnAbs: Abs): Abs {
  let p = fnProtos.get(fnAbs);
  if (p === undefined) {
    p = abs(
      { k: "obj", slots: { constructor: { value: fnAbs } } },
      undefined,
      undefined,
      "path",
    );
    // 原生：函数 prototype 上的 `constructor` 是**不可枚举**数据属性 ⇒
    // for-in / Object.keys 看不到（`for (const k in (function(){}).prototype)`
    // 原生是 []，缺标记则引擎发布 ["constructor"]）。
    setPropFlags(p, "constructor", { enumerable: false, writable: true, configurable: true });
    fnProtos.set(fnAbs, p);
  }
  return p;
}

/**
 * Bug 84：用户类实例 brand 的内层闭 obj（公有/私有自有槽的承载者）。
 * 属性 introspection 面（Object.keys/values/entries / gOPN / assign /
 * spread / JSON.stringify / hasOwn）据此展开公有自有槽——私有槽以
 * Slot.internal 打标（transpile 期 PrivateName 标记）在各面剔除。
 * 非实例面 → undefined（保持既有保守口径）：
 * - 类值（classNameOfValue 命中——ctor facet，槽是 statics+name）；
 * - 未注册 brand（内建 Error/Map/Set/… 的自有槽枚举面另有专门口径）；
 * - 内层非闭 obj（开放键集不可精确列举）。
 */
export function classInstanceInnerOf(a: Abs): Abs | undefined {
  const s = a.shape;
  if (s.k !== "brand") return undefined;
  if (classNameOfValue(a as object) === s.name) return undefined;
  // BUG-172：随值携带的规格即身份——同名类被别的模块覆盖后（注册表里
  // 只剩 last-wins 那一份）实例面仍须认自己是用户类实例。
  if (classSpecOfAbs(a) === undefined && !classRegistry.has(s.name)) return undefined;
  const inner = s.shape;
  const is = inner.shape;
  if (is.k !== "obj" || is.open || is.index) return undefined;
  return inner;
}

/**
 * Bug 84：类继承链是否带 JSON 用户面（toJSON 方法）——有则
 * stringify 不可折（原生经原型查找调用 value.toJSON），保持
 * 保守 partial。链止于未注册名（extends Error 等内建基类——
 * Error 家族无 toJSON、stringify 恒 total "{}"）。
 *
 * 类访问器（spec.accessors）**不**构成 JSON 用户面：原生访问器
 * 安装在原型上，非实例自有属性；JSON.stringify 只枚举自有可
 * 枚举键（字段），不经 [[Get]] 调用原型访问器（node 实测
 * `class A { get x(){} pub=2 }` → `{"pub":2}`）。动态
 * defineProperty 到实例的访问器在内层留占位槽，absToJsonNative
 * 经 readProperty/accessorTable 派发 getter（Bug 57 口径），
 * 折叠仍精确；抽象键写使内层 open → NOT_LITERAL。
 */
export function classChainHasJsonUserFace(name: string): boolean {
  let cur: string | undefined = name;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const spec = classRegistry.get(cur);
    if (spec?.methods?.["toJSON"]) return true;
    cur = spec?.superName;
  }
  return false;
}

export function clearBClasses(): void {
  classRegistry.clear();
  classValues.clear();
  classEpochs.clear();
  classCollisions.length = 0;
}
