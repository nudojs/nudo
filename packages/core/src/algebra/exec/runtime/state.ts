/**
 * 求值引擎运行时共享状态（#9 拆分后的门面 + 保留簇）：就地写、字面量
 * Abs、真值、OOB 合成 undefined、strict 写抛、new.target 槽、Proxy get
 * 不变量、循环信号。叶子性：不依赖 runtime 其它文件（tuple/obj 字面量
 * 就地构造，避免 state↔containers 环）。
 *
 * 已拆出（本文件 re-export 维持既有 import 面，消费方零改动）：
 * - phi.ts：当前路径前提 Φ + assume 引理前提（#152）+ invariant 规格（#176）
 * - exit-stacks.ts：loop/throw 退出栈 + try 标记栈 + NudoReturn 早退
 * - host-bridge.ts：宿主函数桥（asAbsVal/$fnVal/$absVal/种类戳/调用边界）
 * - ../hooks.ts：加载期 setter 注入 cell（hostGlobalFnCall）——注册面
 *   （exec/calls.ts）与消费面（host-bridge.ts）直连 hooks.ts，本文件
 *   不再中转 re-export
 *
 * Invariants:
 * - Bug 213：宿主 / 命名空间对象（Math / JSON / Reflect）的自有属性投影按
 *   **getOwnPropertyNames**（全部自有字符串键）而非 Object.entries（只取可
 *   枚举键）——原生这些对象的自有属性几乎全不可枚举，按可枚举投影会把整个
 *   自有面丢掉（gOPN / ownKeys / hasOwn / gOPD 全折 0）；逐键记 enumerable /
 *   writable / configurable 标志，不可枚举键仍不进枚举面。
 * - Bug 210：enforceProxyGetInvariant 是 Proxy [[Get]] 规范不变量的单一实现
 *   （靶上自有属性不可配置且不可写时，get 陷阱须返回其实际值）；
 *   proxyTargetInnerObj 归一化「靶 → 内层 obj Abs」（不变性侧表与槽表都挂
 *   在内层 obj 上——brand 包装的靶走内层）。
 *   [[OwnPropertyKeys]] 不变量（重复名 / 漏键 / 多余键）在
 *   builtins/object/descriptor.ts（enforceProxyOwnKeysInvariant）。
 */
import type { Abs } from "../../abs.ts";
import { abs, litValue, strLit, unknown, isAbsLike } from "../../abs.ts";
import "../../term.ts";
import { pTrue } from "../../pred.ts";
import { registerSymbolMeta } from "../../symbol-id.ts";
import { NudoThrow, isNudoThrow } from "../nudo-throw.ts";
import { errorTypeAbs } from "../may-throw.ts";
import { shouldWidenArrayLiteral, widenedArrayConf } from "../../containers.ts";
import { joinAbs, objOf } from "../../objects.ts";
import { extStateOf, getPropFlags, setPropFlags } from "../../builtins/invariants.ts";
import { createScopedSlot, registerCollectorScopeParticipant } from "../../collector-scope.ts";

export { NudoThrow, isNudoThrow };

// --- 拆分文件的门面 re-export（导出名与拆分前逐一对应） ---
export {
  currentAssumePremises,
  currentExecPhi,
  currentInvariantSpecs,
  phi,
  withAssumePremises,
  withExecPhi,
  withInvariantSpecs,
} from "./phi.ts";
export {
  $absVal,
  $fnKindStamp,
  $fnVal,
  asAbsVal,
  callAtFunctionBoundary,
  hostFnKindOf,
  noBody,
} from "./host-bridge.ts";
export type { FnKind } from "./host-bridge.ts";
export {
  $catchReturn,
  $loopReturn,
  $pushLoopExit,
  $tryCurrentMark,
  $tryDetachSoftCatch,
  $tryDigestSoftCatch,
  $tryDiscardSoft,
  $tryMark,
  $tryOrphanSoft,
  $tryPopMark,
  $tryReleaseSoftCatch,
  $tryReleaseSoftOut,
  $tryTakeSince,
  NudoReturn,
  isNudoReturn,
  loopExitsAls,
  peekThrowExitsSince,
  pushLoopExit,
  pushThrowExit,
  runWithLoopExits,
  softFrameActiveAls,
  takeLoopExits,
  takeThrowExits,
  throwExitsAls,
  throwExitsMark,
  tryMarksAls,
} from "./exit-stacks.ts";
// hooks.ts 的 setHostGlobalFnCall 中转 re-export 已删（注册面 exec/calls.ts
// 直连 hooks.ts，消费面 host-bridge.ts 走 getter——零消费方经本文件 import）
// 门面 re-export 不进本地作用域——保留簇体内直用的名字需真 import
import { isNudoReturn } from "./exit-stacks.ts";

export function writeInPlace(target: Abs, next: Abs): Abs {
  target.shape = next.shape;
  target.conf = next.conf;
  target.term = undefined;
  target.pred = undefined;
  return target;
}

/** 调用方已直接改 shape 时的 term/pred 清理 */
export function clearStaleTermPred(v: Abs): void {
  v.term = undefined;
  v.pred = undefined;
}

/**
 * 具体循环硬上限截断时的 conf 降级：exact/path → partial。
 * 截断后的中间态不得继续声明精确（有界分析的诚实标记）；
 * widened/partial/opaque 本就不声明精确，原样保留。
 */
export function confPartial(a: Abs): Abs {
  return a.conf === "exact" || a.conf === "path" ? { ...a, conf: "partial" } : a;
}

/**
 * 循环 pack 状态（$obj({ name: binding })）的截断降级：降**槽位值**的 conf
 * ——unpack 取的是槽位值（$get(o, name)），只降外层包装对绑定不可见。
 * pack 由 transpile 发射（$obj + $copy(binding)），形态恒为扁平一层 obj。
 */
export function confPartialPacked(a: Abs): Abs {
  if (a.shape.k !== "obj") return confPartial(a);
  const slots: Record<string, { value: Abs }> = {};
  for (const [k, slot] of Object.entries(a.shape.slots)) {
    slots[k] = { value: confPartial(slot.value) };
  }
  return objOf(slots);
}

/**
 * 宿主 this → Abs：函数体 prologue 用它承接 call/apply/bind 传入的 thisArg。
 * Abs 原样返回；宿主 undefined（普通调用/call 缺 thisArg）→ $lit(undefined)。
 * 求值引擎产物是 new Function 拼接（sloppy），裸调用的宿主 this 泄漏为
 * globalThis——归一到 $lit(undefined)（strict 模块语义下的 this）。
 */
export function $rawThis(v: unknown): Abs {
  if (v === undefined || v === globalThis) return $lit(undefined);
  if (isAbsLike(v)) return v as Abs;
  return $lit(v);
}

/**
 * strict 模块语义下写不可变目标（frozen/sealed 新键/nonext 新键/
 * writable:false/getter-only/non-configurable 删）→ hard TypeError。
 * 抛 NudoThrow 由 catch 转译吸收为 TypeError 绑定；无 catch 时函数中断
 * （never + throws），callTranspiledExportFull 上报 L2 entry-may-throw。
 */
export function throwStrictWrite(): never {
  throw new NudoThrow(errorTypeAbs("TypeError"));
}

/** const 绑定再赋值（Assignment to constant variable）→ hard TypeError */
export function $throwConstAssign(): never {
  throw new NudoThrow(errorTypeAbs("TypeError"));
}

/**
 * 自由 `arguments` 读（模块顶层 / 无任何外层函数绑定）：非宿主全局，
 * 原生 unresolvable reference → hard ReferenceError（ESM 无 arguments
 * 全局；`typeof arguments` 豁免由 transpile 折 "undefined" 不走此处）。
 */
export function $throwFreeArguments(): never {
  throw new NudoThrow(errorTypeAbs("ReferenceError"));
}

// --- new.target（Bug 79）---
// 原生语义：new.target 由「调用方式」决定——普通调用恒 undefined；
// [[Construct]] 调用（$new）体内为被 new 的构造器自身。用求值侧栈近似：
// $new 压入被构造的类值，$call/$invoke（普通调用面）在调用期间清空并
// 恢复——构造器体/实例字段初始化器直接读栈（不经调用面）得类值，
// 嵌套普通函数读得 undefined，与原生一致。
//
// #8 作用域统一：此前是模块级裸可变数组（LSP 服务的 await 窗口内交错
// 分析会共享同一栈——构造帧跨分析串台）。改为 collector-scope 槽
// （同步 save/restore + 注册 participant：runWithCollectorScope 进入时
// 继承当前栈快照，嵌套作用域互不可见对方的清空）。与 control.ts 的
// yieldStackSlot / genPathSensitiveSlot 同款模式（推
// registerCollectorScopeParticipant + 槽数组 push/pop）。
const newTargetSlot = createScopedSlot<Abs[]>(() => []);
registerCollectorScopeParticipant((body) => newTargetSlot.runScoped(body));

/** $new 专用：进入构造（构造器体 + 实例字段初始化器期间 new.target = 类值） */
export function pushCtorFrame(cls: Abs): void {
  newTargetSlot.get().push(cls);
}

export function popCtorFrame(): void {
  newTargetSlot.get().pop();
}

/** `new.target` 读：栈顶类值；普通调用面已清空 → undefined 字面量 */
export function $newTarget(): Abs {
  const stack = newTargetSlot.get();
  return stack[stack.length - 1] ?? $lit(undefined);
}

/**
 * 普通调用面（$call / $invoke / 宿主函数 invoke）包裹：调用期间清空
 * new.target 栈（嵌套函数原生读 undefined），返回后恢复外层构造帧。
 */
export function withNewTargetReset<T>(body: () => T): T {
  const stack = newTargetSlot.get();
  if (stack.length === 0) return body();
  const saved = stack.splice(0, stack.length);
  try {
    return body();
  } finally {
    stack.push(...saved);
  }
}

/** 生成代码可用的真值判定（undefined = 无法判定）；与 litTruth 同口径 */
export function $litTruth(a: Abs): boolean | undefined {
  return litTruth(a);
}

/** 字面量 → Abs（transpile 侧数字/字符串/布尔/null/undefined） */
export function $lit(v: unknown): Abs {
  if (isAbsLike(v)) {
    return v as Abs;
  }
  return litAbsFromJs(v);
}

export function litAbsFromJs(v: unknown, depth = 0): Abs {
  if (v === null || v === undefined) {
    return abs({ k: "unknown" }, { op: "lit", value: v as unknown as import("../../term.ts").LiteralValue }, pTrue, "exact");
  }
  const t = typeof v;
  if (t === "number" || t === "string" || t === "boolean" || t === "bigint") {
    return abs(
      { k: "prim", type: t as "number" | "string" | "boolean" | "bigint" },
      { op: "lit", value: v as unknown as import("../../term.ts").LiteralValue },
      pTrue,
      "exact",
    );
  }
  if (t === "symbol") {
    // Bug 54：宿主 symbol lit（Symbol.iterator 等 well-known 常量读）——
    // 同一宿主值跨读稳定，exact lit 健全（=== / typeof / String(sym) /
    // .description 均可折）；meta 侧表注册 description。
    const sym = abs(
      { k: "prim", type: "symbol" },
      { op: "lit", value: v as unknown as import("../../term.ts").LiteralValue },
      pTrue,
      "exact",
    );
    return registerSymbolMeta(sym, (v as symbol).description === undefined
      ? abs({ k: "unknown" }, { op: "lit", value: undefined }, pTrue, "exact")
      : strLit((v as symbol).description!));
  }
  // JS 数组/纯对象字面量 → tuple/obj（与 runtime $arr/$obj 同构，就地构造以保 state 为叶子）；
  // 循环引用/过深/非 plain 对象（Date/Map/Set/RegExp…）诚实 unknown。
  if (depth < 8) {
    if (Array.isArray(v)) {
      // 稀疏数组（case 实参 [1,,3]）：`i in v` 探洞，洞下标记入 tuple.holes
      //（与字面量路径 $arrWithHoles 同口径——读值 undefined、`in`/自有属性
      // 判定 false）；超 cap widen 成 arr 时丢洞精度（arr 形状无 holes 槽，
      // 同 $arrWithHoles 退化）
      const holes: number[] = [];
      const els: Abs[] = [];
      for (let i = 0; i < v.length; i++) {
        if (i in v) els.push(litAbsFromJs(v[i], depth + 1));
        else {
          holes.push(i);
          els.push(litAbsFromJs(undefined));
        }
      }
      if (shouldWidenArrayLiteral(els.length)) {
        return abs(
          { k: "arr", element: els.reduce((x, y) => joinAbs(x, y)) },
          undefined,
          undefined,
          widenedArrayConf(),
        );
      }
      return abs(
        { k: "tuple", elements: els, ...(holes.length ? { holes } : {}) },
        undefined,
        undefined,
        "exact",
      );
    }
    if (t === "object") {
      const proto = Object.getPrototypeOf(v);
      if (proto === Object.prototype || proto === null) {
        const slots: Record<string, { value: Abs }> = {};
        /**
         * Bug 213：宿主 / 命名空间对象（Math / JSON / Reflect）的自有属性几乎
         * 全部**不可枚举**（原生 Object.keys(Math) 为空串数组，但
         * Object.getOwnPropertyNames(Math) 非空）——此前按 Object.entries
         * （只取**可枚举**自有键）投影 ⇒ 整个自有面被丢弃 ⇒ 引擎侧
         * gOPN / ownKeys / hasOwn / gOPD 对这些对象全折 0（原生折非 0）。
         *
         * 改为按 Object.getOwnPropertyNames 投影**全部自有字符串键**，并逐键
         * 记下原生描述符标志（enumerable / writable / configurable）——
         * 不可枚举键不进枚举面（Object.keys 仍为空，与原生一致），
         * 描述符面（gOPD）与原生逐字段一致。
         */
        const names = Object.getOwnPropertyNames(v);
        for (const k of names) {
          const d = Object.getOwnPropertyDescriptor(v, k);
          // 数据属性取 d.value；访问器属性取读值（getter 求值——与旧
          // Object.entries 路径同口径：宿主 getter 在成员读时本就会求值）。
          const raw = d && "value" in d ? d.value : (v as Record<string, unknown>)[k];
          Object.defineProperty(slots, k, {
            value: { value: litAbsFromJs(raw, depth + 1) },
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        const obj = objOf(slots);
        for (const k of names) {
          const d = Object.getOwnPropertyDescriptor(v, k);
          if (!d) continue;
          setPropFlags(obj, k, {
            writable: d.writable !== false,
            enumerable: d.enumerable !== false,
            configurable: d.configurable !== false,
          });
        }
        /**
         * Bug 213（续）：宿主对象自有 **symbol** 键（如 Math 的
         * Symbol.toStringTag）也进 [[OwnPropertyKeys]] 面——原生
         * Reflect.ownKeys(Math) 比 getOwnPropertyNames 多一个 symbol 键。
         * 引擎槽域是字符串键面，按既有约定投影为 "@@X" 槽（symbolKey 标记，
         * 与 transpile 期 [Symbol.X] 投影同口径）；无名用户符号无投影
         * （不凭空捏槽）。
         */
        for (const sym of Object.getOwnPropertySymbols(v)) {
          const slotKey = hostSymbolSlotKeyOf(sym);
          if (slotKey === undefined) continue;
          const d = Object.getOwnPropertyDescriptor(v, sym);
          Object.defineProperty(slots, slotKey, {
            value: {
              value: litAbsFromJs((v as unknown as Record<symbol, unknown>)[sym], depth + 1),
              symbolKey: true,
            },
            enumerable: true,
            writable: true,
            configurable: true,
          });
          setPropFlags(obj, slotKey, {
            writable: d?.writable !== false,
            enumerable: d?.enumerable !== false,
            configurable: d?.configurable !== false,
          });
        }
        return obj;
      }
    }
  }
  return unknown;
}

/**
 * Bug 213：宿主 Symbol 命名空间的 well-known 名 → "@@X" 槽键（**宿主身份**
 * 反查——不用 description：用户符号 Symbol("Symbol.iterator") 的
 * description 恰是 "Symbol.iterator"，按 description 会误投影到 well-known 槽）。
 *
 * 本模块是叶子（不能 import exec/runtime/symbol-key.ts——它依赖本文件的
 * litAbsFromJs，会成 state↔symbol-key 环），故此处按宿主身份现查
 * （宿主 well-known 符号集极小，仅在宿主对象带自有 symbol 键时触发）。
 */
function hostSymbolSlotKeyOf(sym: symbol): string | undefined {
  const ns = Symbol as unknown as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(Symbol)) {
    if (ns[name] === sym) return `@@${name}`;
  }
  return undefined;
}

/**
 * Bug 210：Proxy 靶的**内层 obj Abs**（obj 靶 → 自身；brand 包装的靶 → 内层
 * obj；其余形态 → undefined）——不变性侧表（extState / propFlags）与槽表都挂
 * 在内层 obj 上（外层 brand Abs 只是包装）。
 */
export function proxyTargetInnerObj(target: Abs): Abs | undefined {
  return target.shape.k === "obj"
    ? target
    : target.shape.k === "brand" && target.shape.shape.shape.k === "obj"
      ? target.shape.shape
      : undefined;
}

/**
 * Bug 210：Proxy 靶上自有数据属性值（obj 槽 / brand 内层 obj 槽）。
 * 非自有属性 → undefined（不变量不适用）。
 */
function proxyTargetOwnValue(target: Abs, key: string): Abs | undefined {
  const inner = proxyTargetInnerObj(target);
  if (!inner) return undefined;
  const slots = (inner.shape as { slots: Record<string, { value: Abs }> }).slots;
  if (!Object.prototype.hasOwnProperty.call(slots, key)) return undefined;
  return slots[key]!.value;
}

/**
 * Bug 210：Proxy [[Get]] 规范不变量（ES2024 10.5.4 step 6）——靶上该自有
 * 属性**不可配置且不可写**（数据属性）时，get 陷阱必须返回该属性的实际值
 * （SameValue），否则抛 TypeError（原生 "'get' on proxy: property 'a' is a
 * read-only and non-configurable data property on the proxy target but the
 * proxy did not return its actual value"）。
 *
 * 判定口径：
 * - 冻结靶（extState "frozen"）：全部自有数据属性不可写 + 不可配置；
 * - 密封靶（"sealed"）：不可配置但**仍可写** → 不触发不变量；
 * - defineProperty 收紧的 flags：writable:false + configurable:false。
 *
 * 值不可判（抽象值 / 非字面量）→ 不抛（sound 保守——原生只在确定不一致
 * 时抛；引擎不得凭空造不一致）。
 *
 * 符号投影键（"[Symbol.X]" → "@@X"）：靶的**自有 symbol 属性**面在引擎里
 * 不可判（槽键 "@@X" 与原生 symbol 键不同域）→ 跳过（调用方以
 * opts.symbolKey 标记）。
 *
 * 消费方：exec/runtime/containers/member.ts 的 Proxy get 陷阱分支
 * （该文件归 S2a/S2b 分片——越界诉求：陷阱结果算出后调本函数一行）。
 */
export function enforceProxyGetInvariant(
  target: Abs,
  key: string,
  trapResult: Abs,
  opts?: { symbolKey?: boolean },
): void {
  if (opts?.symbolKey === true) return; // symbol 投影键 → 靶自有 symbol 面不可判
  const inner = proxyTargetInnerObj(target);
  if (!inner) return;
  const st = extStateOf(inner);
  const flags = getPropFlags(inner)?.get(key);
  const nonWritable = flags?.writable === false || st === "frozen";
  const nonConfigurable =
    flags?.configurable === false || st === "frozen" || st === "sealed";
  if (!nonWritable || !nonConfigurable) return;
  const own = proxyTargetOwnValue(inner, key);
  if (own === undefined) return; // 靶上非自有属性 → 不变量不适用
  const a = litValue(own);
  const b = litValue(trapResult);
  if (!a.ok || !b.ok) return; // 值不可判 → 不抛
  if (!Object.is(a.value, b.value)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
}

/** JS 真值：字面量按 Boolean(v)；对象形恒真；不可判 → undefined */
export function litTruth(a: Abs): boolean | undefined {
  if (a.term?.op === "lit") {
    // lit(undefined) 与「无 lit」都经 litValue 折叠成 undefined，须先看 term
    return Boolean(a.term.value);
  }
  switch (a.shape.k) {
    case "obj":
    case "arr":
    case "tuple":
    case "fn":
    case "brand":
    case "eff":
      return true;
    case "prim":
      // 0n 为 falsy（Boolean(0n)===false）；symbol 恒真
      return a.shape.type === "symbol" ? true : undefined;
    case "never":
      return false;
    default:
      return undefined;
  }
}

export function isDefinitelyTrue(a: Abs): boolean {
  return litTruth(a) === true;
}

export function isDefinitelyFalse(a: Abs): boolean {
  const t = litTruth(a);
  if (t === false) return true;
  if (a.shape.k === "never") return true;
  return false;
}

export function undef(): Abs {
  return abs({ k: "unknown" }, { op: "lit", value: undefined }, pTrue, "exact");
}

/**
 * 越界/未写槽读的合成 undefined（OOB marker）：
 * 抽象下标可能 miss（`d[i]` 的 i 超出已知元素）时并入的臂。
 * 值与 undef() 同（读越界原生得 undefined），但 conf=partial 标记
 * 「这是引擎精度产物，不是用户可观测的确定 undefined」——下游
 * 成员读写不得据此记 may-throw（DP 表 `d[i-1][j]` 类嵌套读取的
 * L2 误报来源，issue #98）。用户字面 undefined（契约/可选槽）是
 * exact conf，仍走 may-throw 口径。
 */
export function oobUndef(): Abs {
  return abs({ k: "unknown" }, { op: "lit", value: undefined }, pTrue, "partial");
}

/** OOB 合成 undefined 判定（conf=partial 的 lit undefined） */
export function isOobUndef(a: Abs | undefined): boolean {
  return (
    !!a &&
    a.conf === "partial" &&
    a.term?.op === "lit" &&
    a.term.value === undefined &&
    a.shape.k === "unknown"
  );
}

let loopSignalFromAbstractArm = false;

/** 抽象 fork 臂执行期间置位（$fork 双臂路径 / $switch 抽象 disc 臂） */
export function withAbstractForkArm<T>(fn: () => T): T {
  const prev = loopSignalFromAbstractArm;
  loopSignalFromAbstractArm = true;
  try {
    return fn();
  } finally {
    loopSignalFromAbstractArm = prev;
  }
}

export class NudoLoopSignal extends Error {
  readonly kind: "break" | "continue";
  readonly label: string | undefined;
  readonly abstract: boolean;
  constructor(kind: "break" | "continue", label?: string) {
    super("nudo:loop");
    this.name = "NudoLoopSignal";
    this.kind = kind;
    this.label = label;
    this.abstract = loopSignalFromAbstractArm;
  }
}

export function $loopBreak(label?: string): never {
  throw new NudoLoopSignal("break", label || undefined);
}

export function $loopContinue(label?: string): never {
  throw new NudoLoopSignal("continue", label || undefined);
}

/** 无标签信号匹配任何循环；带标签信号仅匹配同名循环 */
export function loopSignalMatches(e: NudoLoopSignal, label: string | undefined): boolean {
  return e.label === undefined || e.label === label;
}

export function isNudoBreak(e: unknown, label?: string): e is NudoLoopSignal {
  return e instanceof NudoLoopSignal && e.kind === "break" && loopSignalMatches(e, label);
}

export function isNudoContinue(e: unknown, label?: string): e is NudoLoopSignal {
  return e instanceof NudoLoopSignal && e.kind === "continue" && loopSignalMatches(e, label);
}

/** 非循环 labeled block：判断 break 信号是否指向本标签（transpile 生成代码用） */
export function $isBreakTo(e: unknown, label: string): boolean {
  return e instanceof NudoLoopSignal && e.kind === "break" && e.label === label;
}

/** catch 转译辅助：控制流信号透传（生成代码只注入 `$` 前缀符号） */
export function $rethrowIfNudoReturn(e: unknown): void {
  if (isNudoReturn(e)) throw e;
}
