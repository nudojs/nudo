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
  ctor?: (thisVal: Abs, ...args: Abs[]) => Abs;
  methods?: Record<string, (thisVal: Abs, ...args: Abs[]) => Abs>;
  /** 实例方法形参展示名（AST 形参名；未调用方法槽 `shape.params` 用） */
  methodParams?: Record<string, string[]>;
  staticMethods?: Record<string, (...args: Abs[]) => Abs>;
  /** 静态方法形参展示名 */
  staticMethodParams?: Record<string, string[]>;
  statics?: Record<string, Abs>;
  /** 实例 get/set：get 无参返回 Abs；set 收到 (thisVal, v) 返回更新后的 thisVal */
  accessors?: Record<string, EvalClassAccessor>;
  /** 静态 get/set：挂在类构造器上，不在实例原型链 */
  staticAccessors?: Record<string, EvalClassAccessor>;
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
  return `${ctorName}[${methods}](${statics}){${accessors}}`;
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

export function clearBClasses(): void {
  classRegistry.clear();
  classEpochs.clear();
  classCollisions.length = 0;
}
