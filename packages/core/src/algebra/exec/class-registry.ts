/**
 * B class 规格表（无 call 依赖，避免循环）。
 * Abs-eval registerClassDecl 与 transpile $class 共用。
 */

import type { Abs } from "../abs.ts";
import { markClassValue, classNameOfValue } from "../class-mark.ts";

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
   * Bug 11：`class C extends null`（合法——原型链无 super，但构造受限）。
   * 隐式 ctor 等价 super(...args)，原生 new C() 抛 TypeError
   * （Super constructor null … is not a constructor）；显式 super() 同抛（$super）。
   */
  superNull?: boolean;
  ctor?: (thisVal: Abs, ...args: Abs[]) => Abs;
  methods?: Record<string, (thisVal: Abs, ...args: Abs[]) => Abs>;
  /** 实例方法形参展示名（AST 形参名；未调用方法槽 `shape.params` 用） */
  methodParams?: Record<string, string[]>;
  staticMethods?: Record<string, (...args: Abs[]) => Abs>;
  /** 静态方法形参展示名 */
  staticMethodParams?: Record<string, string[]>;
  statics?: Record<string, Abs>;
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
 *  protoOfRecv（builtins/ctor.ts）共用，后者不可反向引 members（环）。 */
export const BUILTIN_ERROR_SUPER: Record<string, string> = {
  Error: "",
  RangeError: "Error",
  TypeError: "Error",
  ReferenceError: "Error",
  SyntaxError: "Error",
  URIError: "Error",
  EvalError: "Error",
  AggregateError: "Error",
};

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
  if (!classRegistry.has(s.name)) return undefined;
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
