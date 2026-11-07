/**
 * 函数节点静态面（transpile helper 叶）：形参表面（显示名 / 可省略标记 /
 * 原生 arity / 宿主绑定名 / 函数种类戳）、函数体 facet 单次遍历（this /
 * 形参 this / arguments / effectFree / closed）与 finalizer 静态事实。
 *
 * 模块级状态收敛于本文件：fnFacetsCache（facet 按函数节点对象 memo 的
 * WeakMap）。形参表面单一实现来自 param-surface.ts。
 */
import type { Node } from "@babel/types";
import { formalParamsFromNodes, formalParamDisplayNames } from "../../../format/param-surface.ts";

export function paramDisplayNames(params: unknown[] | undefined): string[] {
  return formalParamDisplayNames(formalParamsFromNodes(params as unknown as Parameters<typeof formalParamsFromNodes>[0]));
}

/**
 * Bug 399：逐位「可省略」标记（与 `paramDisplayNames` **同下标同长度**）。
 *
 * 用途：默认形参（`f(a, b = 1)`）在形参表面只是**光秃秃的名字**（`b`）
 * ⇒ 必选元数按名字后缀判时会被计成必选 ⇒ `nudo:assign-mismatch` 假红
 * （JS 语义下 `(x = 1) => x` 的 `length` 是 0 ⇒ 可零参调用）。
 *
 * ⚠ **不能用原生 `fn.length` 代替**：`length` 是「首个默认值/rest **前**的
 * 形参数」⇒ `f(a, b = 1, c)` 的 length = 1，但 `c` 仍**必选**
 * （TS 语义：可选参数之后的参数仍必选）⇒ 必选元数 ≠ length。
 *
 * 与 `paramDisplayNames` 同源（同一个 `formalParamsFromNodes`）⇒ 下标天然对齐。
 */
export function paramOptionalFlags(params: unknown[] | undefined): boolean[] {
  return formalParamsFromNodes(params as unknown as Parameters<typeof formalParamsFromNodes>[0]).map(
    (f) => f.optional === true,
  );
}

/**
 * Bug 69：原生 fn.length 边界——首个默认值（AssignmentPattern）或 rest
 * 形参**前**的形参数。解构形参无默认值时计入（原生不截断）；transpile 侧
 * 记入 $fnVal 的 length 通道（$len 的 fn 分支折 exact），宿主函数的解糖
 * 占位（`function f(a, _p1)`）不再污染 arity。
 */
export function nativeParamArity(params: unknown[] | undefined): number {
  let n = 0;
  for (const raw of params ?? []) {
    const t = (raw as { type?: string }).type;
    if (t === "AssignmentPattern" || t === "RestElement") break;
    n++;
  }
  return n;
}

/**
 * Bug 325：**函数种类**戳（async × generator 四象限）——原生
 * `Object.prototype.toString.call(f)` 据此区分：
 * 普通 → "[object Function]"、async → "[object AsyncFunction]"、
 * generator → "[object GeneratorFunction]"、
 * async generator → "[object AsyncGeneratorFunction]"。
 *
 * 发射成 `$fnVal` opts 的 `kind` 片段（`, fnKind: "async"` 等）。箭头函数
 * 无 kind 域（原生标签恒 "[object Function]"）⇒ 返回空串。
 *
 * 单一事实源：函数声明 / 函数表达式（expr/function.ts）、对象方法简写
 * （expr/object.ts）、类方法（class-emit.ts）三条产生路径共用——此前只有
 * 函数表达式路径打戳 ⇒ 方法简写 / 类方法 / 函数声明三种形态全折
 * "[object Function]"（wrong-exact）。
 */
export function fnKindSrc(fn: { async?: boolean; generator?: boolean } | null | undefined): string {
  const kind = fnKindOf(fn);
  return kind === undefined ? "" : `, fnKind: ${JSON.stringify(kind)}`;
}

/**
 * Bug 325：函数种类戳的**值**（async × generator 四象限）——类方法 spec
 * （methodKinds / staticMethodKinds）需要纯值（不是源码片段）。
 */
export function fnKindOf(
  fn: { async?: boolean; generator?: boolean } | null | undefined,
): "function" | "async" | "generator" | "async-generator" | undefined {
  if (!fn) return undefined;
  if (fn.generator === true) {
    return fn.async === true ? "async-generator" : "generator";
  }
  if (fn.async === true) return "async";
  return "function";
}

/**
 * ObjectMethod / 方法型 FunctionExpression 的宿主绑定名：
 * Identifier / 默认参左名 / RestElement 直通；其余占位 `_a`。
 * 与 emitParamBinding 的 sig 同精神，但保持方法简写路径轻量。
 */
export function methodBindNames(params: unknown[] | undefined): string[] {
  return (params ?? []).map((raw) => {
    const p = raw as { type?: string; name?: string; left?: { type?: string; name?: string }; argument?: { type?: string; name?: string } };
    if (p?.type === "Identifier" && p.name) return p.name;
    if (p?.type === "AssignmentPattern" && p.left?.type === "Identifier" && p.left.name) return p.left.name;
    if (p?.type === "RestElement" && p.argument?.type === "Identifier" && p.argument.name) return `...${p.argument.name}`;
    return "_a";
  });
}

/**
 * 函数体是否含 this：求值引擎默认把函数声明/表达式转成无宿主 this 的调用，
 * 只有 body 引用 this 的函数才需要宿主 this 注入（$rawThis）。
 * 嵌套函数声明/表达式有自己的 this 边界，不下降；箭头函数词法 this 下降。
 */
/**
 * Bug 52：finalizer 静态事实——是否含 yield/yield*（.return 注入后生成器
 * 可再交付 → done 并 boolean）与 return（可覆盖注入值 → 值并 unknown）。
 * 嵌套函数体（声明/表达式/箭头/方法/静态块）不属本生成器，不下降
 * （同 fnBodyHasThis 的排除口径）。
 */
export function finalizerBits(node: Node): { yields: boolean; returns: boolean } {
  let yields = false;
  let returns = false;
  const seen = new Set<Node>();
  const walk = (n: Node): void => {
    if (n.type === "YieldExpression") yields = true;
    else if (n.type === "ReturnStatement") returns = true;
    else if (
      n.type === "FunctionDeclaration" ||
      n.type === "FunctionExpression" ||
      n.type === "ArrowFunctionExpression" ||
      n.type === "ObjectMethod" ||
      n.type === "ClassMethod" ||
      n.type === "ClassPrivateMethod" ||
      n.type === "StaticBlock"
    ) {
      return;
    }
    if (seen.has(n)) return;
    seen.add(n);
    for (const [k, v] of Object.entries(n)) {
      if (k === "loc" || k === "start" || k === "end" || k === "leadingComments" || k === "trailingComments") continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object" && "type" in (item as object)) walk(item as Node);
        }
      } else if (v && typeof v === "object" && "type" in (v as object)) {
        walk(v as Node);
      }
    }
  };
    walk(node);
  return { yields, returns };
}

export function fnBodyHasThis(fn: { body?: Node | null }): boolean {
  return getFnFacets(fn).hasThis;
}

/**
 * 函数是否引用 `arguments`（自身绑定持有者）——函数体**或嵌套箭头**
 *（词法继承 arguments）任意 Identifier 引用即算；嵌套真实函数/方法有
 * 自己的绑定，停止下降。参数默认值（`function f(a = arguments.length)`）
 * 在函数作用域求值，一并扫描。仅此时建立 argsBinding；无绑定（模块顶层）
 * → 自由 arguments 读折 $throwFreeArguments()（原生 ReferenceError）。
 */
export function fnBodyHasOwnArguments(fn: { body?: Node | null; params?: Node[] }): boolean {
  return getFnFacets(fn).hasOwnArguments;
}

/**
 * M4：函数体「无副作用面」保守静态判定（transpile 侧，facet 进 $fnVal）。
 * 脏标记（保守过近似，宁可漏判纯）：
 * - 任意赋值 / 自增自减 / delete / 标签模板（tag 是调用）；
 * - 任意 CallExpression（含 Math.max 等纯调用——调用面不可内省）；
 * - NewExpression 限于白名单 ctor（Error/集合/正则等无外写构造器；
 *   Promise 排除——executor 同步执行可写外层；用户类不可知）；
 * - for-in/for-of 的左部是赋值目标（非变量声明）。
 * 嵌套函数体不下降：不调用就不执行；对它的调用已由 Call 脏标记覆盖。
 * 用途：sort 等原生调用次数取决于算法内部的内建——只有无副作用面的
 * 回调才允许引擎真执行（副作用回调多执行不可回滚，外层绑定会错定值）。
 */
const SAFE_CTOR_NAMES = new Set([
  "Object", "Array", "Error", "TypeError", "RangeError", "ReferenceError",
  "SyntaxError", "EvalError", "URIError", "AggregateError", "Map", "Set",
  "WeakMap", "WeakSet", "Date", "RegExp", "Number", "String", "Boolean",
  "BigInt", "Symbol",
]);

/**
 * BUG-244：**纯值转换全局调用**白名单（`Symbol("s")` / `Number(x)` /
 * `String(x)` …）——这些调用不写任何外层状态，与 `SAFE_CTOR_NAMES` 对
 * `NewExpression` 的放行同口径（按名判定；`bound` 集里的同名局部声明仍脏）。
 *
 * 为什么必须放行：`effectFree` 是「允许引擎真执行回调」的唯一闸门
 * （sort 比较器 / promise 回调 / HOF 回调）。此前**任意** `CallExpression`
 * 一律标脏 ⇒ `(x, y) => Symbol("s")` 这种「含一个纯调用」的回调被判
 * 非 effectFree ⇒ 整段回调校验被跳过 ⇒ 比较器返回 symbol 必抛的
 * TypeError 漏判（`nudo check` 假绿）。
 *
 * 判定只按**调用形态**，不按被调方语义：白名单外的调用（用户函数 /
 * 成员方法 / 动态取值）仍然标脏——副作用回调「多执行不可回滚」的既有
 * 契约不变（`let n = 0; sort((a,b) => { n++; … })` 依旧不执行）。
 */
const SAFE_CALL_NAMES = new Set([
  "Symbol", "Number", "String", "Boolean", "BigInt",
  "parseInt", "parseFloat", "isNaN", "isFinite",
]);

export function fnBodyIsEffectFree(fn: { body?: Node | null; params?: Node[] }): boolean {
  return getFnFacets(fn).effectFree;
}

/**
 * R3：函数体「封闭」保守静态判定（transpile 侧 facet，与 effectFree 同族；
 * 二者合取才允许 promise then/catch 同步执行回调）。
 * closed = 执行面（形参默认值 + 体，嵌套函数体不下降——执行必有 Call，
 * effectFree 已脏）上所有标识符引用只绑定：自身形参 / 体内声明 /
 * 纯全局白名单。脏标记（宁可漏判封闭）：
 * - ThisExpression / Super / MetaProperty（new.target：this/元面不可封闭）；
 * - `arguments`（非箭头自有 arguments 面保守脏）；
 * - 非白名单自由标识符（外层可变态读取——同步执行会读到 drain 前旧值）。
 * 声明面（var/let/const/函数/类/catch 形参）在下降前收进 bound 集；
 * 非计算属性键 / 成员属性名 / label 不是引用，不检查。
 */
const CLOSED_GLOBAL_NAMES = new Set<string>([
  "undefined", "NaN", "Infinity",
  "Math", "JSON",
  "Promise",
  ...SAFE_CTOR_NAMES,
]);

/** 一次遍历得到的五个 facet（按函数节点对象 memo——WeakMap 节点身份） */
export interface FnFacets {
  hasThis: boolean;
  hasParamsThis: boolean;
  hasOwnArguments: boolean;
  effectFree: boolean;
  closed: boolean;
}

const fnFacetsCache = new WeakMap<object, FnFacets>();

/** facet 位掩码：一次下降同时算五面；某位清零 = 该面已收敛（命中/边界/脏） */
const FACET_THIS = 1;
const FACET_PARAMS_THIS = 2;
const FACET_ARGS = 4;
const FACET_EFFECT_FREE = 8;
const FACET_CLOSED = 16;

/** 特殊形态自定义孩子顺序时，通用下降要跳过已处理的孩子键 */
const MEMBER_CHILD_KEYS: ReadonlySet<string> = new Set(["object", "property"]);
const OBJECT_PROPERTY_CHILD_KEYS: ReadonlySet<string> = new Set(["key", "value"]);

/**
 * 五个 facet 的**单次遍历**（把原先 4-5 次独立 AST 扫描合并）。
 *
 * 每个 facet 的停止边界 / 脏标记用独立位表达——同一节点下降时只对仍活跃
 * 的面做判定，因此各面结果与独立实现逐条一致：
 * - this / 形参 this：嵌套 FunctionDeclaration/FunctionExpression 有自己的
 *   this 边界（停止），箭头词法继承（下降）；
 * - arguments：嵌套函数 / 对象方法 / 类方法有自己的绑定（停止），箭头
 *   下降，参数默认值一并扫描；
 * - effectFree / closed：形参默认值 + 体；嵌套函数体不执行（不下降），
 *   closed 另停类体；closed 的绑定集按原 DFS 顺序建立（声明前引用仍按
 *   原口径判自由）。
 * 结果按函数节点对象 memo：同一节点上的多个 wrapper 调用共享一次遍历。
 */
export function getFnFacets(fn: { body?: Node | null; params?: Node[] }): FnFacets {
  const cached = fnFacetsCache.get(fn);
  if (cached) return cached;

  const body = fn.body ?? null;
  const params = fn.params ?? [];
  let hasThis = false;
  let hasParamsThis = false;
  let hasOwnArguments = false;
  let effectDirty = false;
  let closedDirty = false;
  const bound = new Set<string>();
  // 节点去重（AST 是树；保留环 / 共享节点防御）
  const seen = new Set<Node>();

  /** 通用孩子下降：跳过元数据键与调用方已特殊处理的孩子键 */
  const walkChildren = (n: Node, mask: number, skip?: ReadonlySet<string>): void => {
    if (mask === 0) return;
    for (const [k, v] of Object.entries(n)) {
      if (skip?.has(k)) continue;
      if (k === "loc" || k === "start" || k === "end" || k === "leadingComments" || k === "trailingComments") continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object" && "type" in (item as object)) walk(item as Node, mask);
        }
      } else if (v && typeof v === "object" && "type" in (v as object)) {
        walk(v as Node, mask);
      }
    }
  };

  const checkRef = (n: Node): void => {
    const name = (n as unknown as { name: string }).name;
    if (!bound.has(name) && !CLOSED_GLOBAL_NAMES.has(name)) closedDirty = true;
  };

  const walk = (n: Node | null | undefined, mask: number): void => {
    if (mask === 0 || !n || typeof n !== "object") return;
    if (effectDirty) mask &= ~FACET_EFFECT_FREE;
    if (closedDirty) mask &= ~FACET_CLOSED;
    if (mask === 0 || seen.has(n)) return;
    seen.add(n);

    // ---- 词法 this（体 / 形参两个独立入口，边界一致）----
    if (mask & (FACET_THIS | FACET_PARAMS_THIS)) {
      if (n.type === "ThisExpression") {
        if (mask & FACET_THIS) {
          hasThis = true;
          mask &= ~FACET_THIS;
        }
        if (mask & FACET_PARAMS_THIS) {
          hasParamsThis = true;
          mask &= ~FACET_PARAMS_THIS;
        }
      } else if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression") {
        mask &= ~(FACET_THIS | FACET_PARAMS_THIS);
      }
    }

    // ---- arguments（自身绑定；箭头词法继承外层，下降）----
    if (mask & FACET_ARGS) {
      if (n.type === "Identifier" && (n as unknown as { name?: string }).name === "arguments") {
        hasOwnArguments = true;
        mask &= ~FACET_ARGS;
      } else if (
        n.type === "FunctionDeclaration" ||
        n.type === "FunctionExpression" ||
        n.type === "ObjectMethod" ||
        n.type === "ClassMethod"
      ) {
        mask &= ~FACET_ARGS;
      }
    }

    // ---- 无副作用面 ----
    if (mask & FACET_EFFECT_FREE) {
      switch (n.type) {
        case "AssignmentExpression":
        case "UpdateExpression":
        case "TaggedTemplateExpression":
        case "CallExpression":
        case "OptionalCallExpression":
        case "NewExpression":
          if (n.type === "NewExpression") {
            const callee = (n as unknown as { callee: Node }).callee;
            if (callee.type === "Identifier" && SAFE_CTOR_NAMES.has((callee as unknown as { name: string }).name)) {
              break; // 白名单 ctor：无外写
            }
          }
          if (n.type === "CallExpression" || n.type === "OptionalCallExpression") {
            // BUG-244：纯值转换全局调用（Symbol("s") / Number(x) / …）无外写
            // ——与上方 ctor 白名单同口径；体/形参里同名局部声明仍按脏算。
            const callee = (n as unknown as { callee?: Node }).callee;
            if (
              callee?.type === "Identifier" &&
              SAFE_CALL_NAMES.has((callee as unknown as { name: string }).name) &&
              !bound.has((callee as unknown as { name: string }).name)
            ) {
              break;
            }
          }
          effectDirty = true;
          mask &= ~FACET_EFFECT_FREE;
          break;
        case "UnaryExpression":
          if ((n as unknown as { operator: string }).operator === "delete") {
            effectDirty = true;
            mask &= ~FACET_EFFECT_FREE;
          }
          break;
        case "ForInStatement":
        case "ForOfStatement": {
          const left = (n as unknown as { left: Node }).left;
          if (left.type !== "VariableDeclaration") {
            effectDirty = true;
            mask &= ~FACET_EFFECT_FREE;
          }
          break;
        }
        case "FunctionDeclaration":
        case "FunctionExpression":
        case "ArrowFunctionExpression":
        case "ObjectMethod":
        case "ClassMethod":
          mask &= ~FACET_EFFECT_FREE; // 嵌套函数体不执行（被调用已由 Call 脏标记覆盖）
          break;
        default:
          break;
      }
    }

    // ---- 封闭面（绑定集 + 引用面；特殊形态自定义孩子顺序以保持原 DFS）----
    if (mask & FACET_CLOSED) {
      switch (n.type) {
        case "Identifier":
          checkRef(n);
          mask &= ~FACET_CLOSED; // 原 walk 在 Identifier 处返回（不再下降）
          break;
        case "ThisExpression":
        case "Super":
        case "MetaProperty":
          closedDirty = true;
          mask &= ~FACET_CLOSED;
          break;
        // 嵌套函数体不执行（effectFree 已保证）；名也不绑定外层读
        case "FunctionDeclaration":
        case "FunctionExpression":
        case "ArrowFunctionExpression":
        case "ObjectMethod":
        case "ClassMethod":
        case "ClassExpression":
        case "ClassDeclaration":
          mask &= ~FACET_CLOSED;
          break;
        case "VariableDeclarator": {
          const q = n as unknown as { id: Node; init: Node | null };
          patternWalk(q.id, mask);
          walk(q.init, mask);
          return;
        }
        case "CatchClause": {
          const q = n as unknown as { param: Node | null; body: Node };
          patternWalk(q.param, mask);
          walk(q.body, mask);
          return;
        }
        case "LabeledStatement":
          // label 非引用（closed 面）；其余面照常走
          walk((n as unknown as { label: Node }).label, mask & ~FACET_CLOSED);
          walk((n as unknown as { body: Node }).body, mask);
          return;
        case "BreakStatement":
        case "ContinueStatement":
          walk((n as unknown as { label?: Node | null }).label, mask & ~FACET_CLOSED);
          return;
        case "MemberExpression":
        case "OptionalMemberExpression": {
          const q = n as unknown as { object: Node; property: Node; computed: boolean };
          walk(q.object, mask);
          walk(q.property, q.computed ? mask : mask & ~FACET_CLOSED);
          walkChildren(n, mask & ~FACET_CLOSED, MEMBER_CHILD_KEYS);
          return;
        }
        case "ObjectProperty": {
          const q = n as unknown as { key: Node; value: Node; computed: boolean };
          walk(q.key, q.computed ? mask : mask & ~FACET_CLOSED);
          walk(q.value, mask);
          walkChildren(n, mask & ~FACET_CLOSED, OBJECT_PROPERTY_CHILD_KEYS);
          return;
        }
        default:
          break;
      }
    }

    walkChildren(n, mask);
  };

  /**
   * 绑定模式（形参 / 声明 id / catch 形参）递归收名；默认值 / 计算键是
   * 引用面。非 closed 面照常下降（不能因绑定语义跳过它们的扫描）。
   */
  const patternWalk = (p: Node | null | undefined, mask: number): void => {
    if (mask === 0 || !p || typeof p !== "object") return;
    if (effectDirty) mask &= ~FACET_EFFECT_FREE;
    if (closedDirty) mask &= ~FACET_CLOSED;
    if (mask === 0) return;
    switch (p.type) {
      case "Identifier":
        if (mask & FACET_CLOSED) bound.add((p as unknown as { name: string }).name);
        // 其余面按通用口径走该标识符（绑定名 `arguments` 同样计入）
        walk(p, mask & ~FACET_CLOSED);
        return;
      case "AssignmentPattern": {
        const q = p as unknown as { left: Node; right: Node };
        patternWalk(q.left, mask);
        walk(q.right, mask);
        return;
      }
      case "RestElement":
        patternWalk((p as unknown as { argument: Node }).argument, mask);
        return;
      case "ObjectPattern":
        for (const prop of (p as unknown as { properties: Node[] }).properties) {
          if (prop.type === "RestElement") {
            patternWalk(prop, mask);
          } else if (prop.type === "ObjectProperty") {
            const q = prop as unknown as { key: Node; value: Node; computed: boolean };
            // 计算键是引用面（`{[x]: v}` 读 x）；非计算键不是引用
            walk(q.key, q.computed ? mask : mask & ~FACET_CLOSED);
            patternWalk(q.value, mask);
          } else {
            // 原 bindPattern 忽略该形态；其余面仍按通用口径下降
            walk(prop, mask & ~FACET_CLOSED);
          }
        }
        return;
      case "ArrayPattern":
        for (const el of (p as unknown as { elements: (Node | null)[] }).elements) {
          patternWalk(el, mask);
        }
        return;
      default:
        // 原 bindPattern 不处理的形态（不绑定）；其余面照常下降
        walk(p, mask & ~FACET_CLOSED);
        return;
    }
  };

  // 形参面：hasParamsThis 恒扫；其余面仅在体存在时有意义（既有实现缺体 → false）
  const paramsMask =
    FACET_PARAMS_THIS | (body ? FACET_ARGS | FACET_EFFECT_FREE | FACET_CLOSED : 0);
  for (const p of params) patternWalk(p, paramsMask);
  if (body) walk(body, FACET_THIS | FACET_ARGS | FACET_EFFECT_FREE | FACET_CLOSED);

  const facets: FnFacets = {
    hasThis,
    hasParamsThis,
    hasOwnArguments,
    effectFree: body !== null && !effectDirty,
    closed: body !== null && !closedDirty,
  };
  fnFacetsCache.set(fn, facets);
  return facets;
}

export function fnBodyIsClosed(fn: { body?: Node | null; params?: Node[] }): boolean {
  return getFnFacets(fn).closed;
}
