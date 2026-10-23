/**
 * transpile 共享 AST 工具：形参名、match、fold、静态键、作用域收集、mutator receiver 扫描。
 * 不依赖 stmt/expr 发射器（无环）。
 *
 * 不变量（@nudo:as / @nudo:replace 指令面）：
 * - **作用范围按 AST 节点身份**（源文本字符区间 [start, end)）判定，
 *   不是「同一行号窗口」：多行语句 / 嵌套块 / 同行下一条语句都不再被命中
 *   （Bug 166）。as 的目标是**承载指令的那条语句**；replace 的目标是该
 *   语句子树内、**不跨作用域边界**的子表达式节点（边界在收集面划定）。
 * - **replace 命中的子表达式仍要求值**（副作用与 throws 域保留），只是
 *   结果被注入值取代（Bug 165）；旧口径整段替换 → 副作用与抛错域消失。
 */
import type { Statement, Node, Expression } from "@babel/types";
import { formalParamsFromNodes, formalParamDisplayNames } from "../../param-surface.ts";
import type { TranspileOptions } from "./types.ts";
import { isStatefulMethodName } from "./ops.ts";
import { HOST_INTRINSIC_SET } from "./intrinsics.ts";
import { emitTranspileExpression } from "./transpile-dispatch.ts";
import { NudoUnsupportedError } from "../unsupported.ts";

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
 * Bug 166：@nudo:as 的作用范围 = **承载指令的那条语句**（节点身份：源文本
 * 字符区间 [stmtStart, stmtEnd)），不是「整条语句的行区间」窗口。
 *
 * 旧口径 `line >= a.stmtStart && line <= a.stmtEnd`（只看行号）会让多行语句
 * （if 块 / 多行 const）内部的嵌套语句、以及同行的下一条语句都被误覆盖——
 * 违反文档「only affects the immediately following statement」。
 *
 * Bug 635：**export 包装**形态的载体身份。`// @nudo:as string()` 写在
 * `export const raw = 1;` 前面时，指令的载体节点是 **ExportNamedDeclaration**
 * （Babel 把前置注释挂在 export 语句上），而转译面拿到的声明节点是**内层**
 * `VariableDeclaration` ⇒ 两个字符区间不重合 ⇒ 覆盖**匹配不到** ⇒
 * 工具打印「Bindings applied」却类型不变（假成功）。
 *
 * 修法：补一条「export 前缀」匹配——**尾端相同**（export 语句与其内层声明
 * 同一处结尾）+ **前缀恰是 export 引导词**（`export ` / `export default `）
 * ⇒ 命中。前缀用源文本核对（`opts.source`），避免「同尾不同语句」误命中。
 */
export function matchAsOverride(stmt: Node, opts: TranspileOptions): string | null {
  if (!opts.asOverrides?.length) return null;
  if (typeof stmt.start !== "number" || typeof stmt.end !== "number") return null;
  for (const a of opts.asOverrides) {
    if (a.stmtStart === stmt.start && a.stmtEnd === stmt.end) return a.varName;
    if (
      a.stmtEnd === stmt.end &&
      a.stmtStart < stmt.start &&
      isExportWrapperGap(opts.source, a.stmtStart, stmt.start)
    ) {
      return a.varName;
    }
  }
  return null;
}

/**
 * 区间 `[from, to)` 是否**只是 export 引导词**（`export ` / `export default `）。
 *
 * 只认 export 引导词 ⇒ export 语句与其内层声明是「同一处结尾」时才算包装；
 * 其它同尾区间（不同语句凑巧同尾）不误命中。源文本缺失 ⇒ 不认（fail-closed：
 * 退回 Bug 166 的精确匹配口径）。
 */
function isExportWrapperGap(source: string | undefined, from: number, to: number): boolean {
  if (typeof source !== "string") return false;
  if (from < 0 || to > source.length || to <= from) return false;
  return /^export\s+(?:default\s+)?$/.test(source.slice(from, to));
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
  const body = fn.body;
  if (!body) return false;
  const seen = new Set<Node>();
  const walk = (n: Node): boolean => {
    if (n.type === "ThisExpression") return true;
    if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression") return false;
    if (seen.has(n)) return false;
    seen.add(n);
    for (const [k, v] of Object.entries(n)) {
      if (k === "loc" || k === "start" || k === "end" || k === "leadingComments" || k === "trailingComments") continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object" && "type" in (item as object)) {
            if (walk(item as Node)) return true;
          }
        }
      } else if (v && typeof v === "object" && "type" in (v as object)) {
        if (walk(v as Node)) return true;
      }
    }
    return false;
  };
  return walk(body);
}

/**
 * 函数是否引用 `arguments`（自身绑定持有者）——函数体**或嵌套箭头**
 *（词法继承 arguments）任意 Identifier 引用即算；嵌套真实函数/方法有
 * 自己的绑定，停止下降。参数默认值（`function f(a = arguments.length)`）
 * 在函数作用域求值，一并扫描。仅此时建立 argsBinding；无绑定（模块顶层）
 * → 自由 arguments 读折 $throwFreeArguments()（原生 ReferenceError）。
 */
export function fnBodyHasOwnArguments(fn: { body?: Node | null; params?: Node[] }): boolean {
  const body = fn.body;
  if (!body) return false;
  const seen = new Set<Node>();
  const walk = (n: Node): boolean => {
    if (n.type === "Identifier" && (n as { name?: string }).name === "arguments") return true;
    if (
      n.type === "FunctionDeclaration" ||
      n.type === "FunctionExpression" ||
      n.type === "ObjectMethod" ||
      n.type === "ClassMethod"
    ) {
      // 箭头不在此列：词法继承外层 arguments，继续下降（箭头自身的
      // params 默认值同属外层绑定作用域）
      return false;
    }
    if (seen.has(n)) return false;
    seen.add(n);
    for (const [k, v] of Object.entries(n)) {
      if (k === "loc" || k === "start" || k === "end" || k === "leadingComments" || k === "trailingComments") continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object" && "type" in (item as object)) {
            if (walk(item as Node)) return true;
          }
        }
      } else if (v && typeof v === "object" && "type" in (v as object)) {
        if (walk(v as Node)) return true;
      }
    }
    return false;
  };
  // 参数默认值先于 body 扫描（同为函数作用域求值面）
  for (const p of fn.params ?? []) {
    if (walk(p)) return true;
  }
  return walk(body);
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

export function fnBodyIsEffectFree(fn: { body?: Node | null; params?: Node[] }): boolean {
  const body = fn.body;
  if (!body) return false;
  let dirty = false;
  const seen = new Set<Node>();
  const walk = (n: Node): void => {
    if (dirty || !n || typeof n !== "object") return;
    switch (n.type) {
      case "AssignmentExpression":
      case "UpdateExpression":
      case "TaggedTemplateExpression":
      case "CallExpression":
      case "OptionalCallExpression":
      case "NewExpression":
        if (n.type === "NewExpression") {
          const callee = (n as unknown as { callee: Node }).callee;
          if (callee.type === "Identifier" && SAFE_CTOR_NAMES.has((callee as { name: string }).name)) {
            break; // 白名单 ctor：无外写
          }
        }
        dirty = true;
        return;
      case "UnaryExpression":
        if ((n as unknown as { operator: string }).operator === "delete") {
          dirty = true;
          return;
        }
        break;
      case "ForInStatement":
      case "ForOfStatement": {
        const left = (n as unknown as { left: Node }).left;
        if (left.type !== "VariableDeclaration") {
          dirty = true;
          return;
        }
        break;
      }
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "ObjectMethod":
      case "ClassMethod":
        return; // 嵌套函数体不执行（除非被调用——Call 脏标记覆盖）
      default:
        break;
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
  for (const p of fn.params ?? []) walk(p);
  walk(body);
  return !dirty;
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

export function fnBodyIsClosed(fn: { body?: Node | null; params?: Node[] }): boolean {
  const body = fn.body;
  if (!body) return false;
  const bound = new Set<string>();
  const seen = new Set<Node>();
  let dirty = false;

  // 绑定模式（形参 / 声明 id / catch 形参）递归收名；默认值表达式照走读检查
  const bindPattern = (p: Node | null | undefined): void => {
    if (!p || typeof p !== "object") return;
    switch (p.type) {
      case "Identifier":
        bound.add((p as unknown as { name: string }).name);
        return;
      case "AssignmentPattern": {
        const q = p as unknown as { left: Node; right: Node };
        bindPattern(q.left);
        walk(q.right);
        return;
      }
      case "RestElement":
        bindPattern((p as unknown as { argument: Node }).argument);
        return;
      case "ObjectPattern":
        for (const prop of (p as unknown as { properties: Node[] }).properties) {
          if (prop.type === "RestElement") {
            bindPattern(prop);
          } else if (prop.type === "ObjectProperty") {
            const q = prop as unknown as { key: Node; value: Node; computed: boolean };
            if (q.computed) walk(q.key); // 计算键是引用面（`{[x]: v}` 读 x）
            bindPattern(q.value);
          }
        }
        return;
      case "ArrayPattern":
        for (const el of (p as unknown as { elements: (Node | null)[] }).elements) {
          bindPattern(el);
        }
        return;
      default:
        return;
    }
  };

  const checkRef = (n: Node): void => {
    const name = (n as unknown as { name: string }).name;
    if (!bound.has(name) && !CLOSED_GLOBAL_NAMES.has(name)) dirty = true;
  };

  const walk = (n: Node | null | undefined): void => {
    if (dirty || !n || typeof n !== "object") return;
    switch (n.type) {
      case "Identifier":
        checkRef(n);
        return;
      case "ThisExpression":
      case "Super":
      case "MetaProperty":
        dirty = true;
        return;
      // 嵌套函数体不执行（effectFree 已保证）；名也不绑定外层读
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "ObjectMethod":
      case "ClassMethod":
      case "ClassExpression":
      case "ClassDeclaration":
        return;
      case "VariableDeclarator": {
        const q = n as unknown as { id: Node; init: Node | null };
        bindPattern(q.id);
        walk(q.init);
        return;
      }
      case "CatchClause": {
        const q = n as unknown as { param: Node | null; body: Node };
        bindPattern(q.param);
        walk(q.body);
        return;
      }
      case "LabeledStatement":
        walk((n as unknown as { body: Node }).body);
        return;
      case "BreakStatement":
      case "ContinueStatement":
        return; // label 非引用
      case "MemberExpression":
      case "OptionalMemberExpression": {
        const q = n as unknown as { object: Node; property: Node; computed: boolean };
        walk(q.object);
        if (q.computed) walk(q.property);
        return;
      }
      case "ObjectProperty": {
        const q = n as unknown as { key: Node; value: Node; computed: boolean };
        if (q.computed) walk(q.key);
        walk(q.value);
        return;
      }
      default:
        break;
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
  for (const p of fn.params ?? []) bindPattern(p);
  walk(body);
  return !dirty;
}

export function normWs(s: string): string {
  return s.replace(/\s+/g, "");
}

/**
 * Bug 165：正在被「求值式替换」展开的节点集合。
 * 替换命中后要把**原表达式**再发射一遍（求值），内层那次发射不得再次
 * 匹配本节点——否则自递归。用 WeakSet（节点身份）而非标志位。
 */
const replacingNodes = new WeakSet<Node>();

/**
 * @nudo:replace 命中面（Bug 165 + Bug 166）。
 *
 * - **Bug 166（作用域）**：命中条件是 **AST 节点身份**——节点的源文本字符
 *   区间与登记区间完全一致（收集面已按「该语句子树内、不跨作用域边界」
 *   圈定候选）。旧口径是「行号窗口 + 文本匹配」→ 泄漏进嵌套语句与同行
 *   下一条语句。
 * - **Bug 165（求值）**：命中的子表达式**仍要求值**（副作用与 throws 域
 *   保留），只是**结果**被注入值取代——旧口径整段替换 → 副作用与抛错域
 *   整段消失（L2 门禁假绿 + 错值）。
 */
export function matchReplacement(node: Node, opts: TranspileOptions): string | null {
  if (!opts.source || !opts.replacements?.length) return null;
  if (replacingNodes.has(node)) return null;
  if (typeof node.start !== "number" || typeof node.end !== "number") return null;
  for (const r of opts.replacements) {
    if (r.stmtStart == null || r.stmtEnd == null) continue;
    if (r.stmtStart !== node.start || r.stmtEnd !== node.end) continue;
    if (normWs(r.target) !== normWs(opts.source.slice(node.start, node.end))) continue;
    return replacedValueSrc(node, r.varName, opts);
  }
  return null;
}

/**
 * Bug 165：原表达式求值一次（副作用 + throws 域保留），结果取注入值。
 * 逗号表达式 `(原表达式, 注入值)`：左值求值后丢弃，右值是本次替换的结果。
 */
function replacedValueSrc(node: Node, varName: string, opts: TranspileOptions): string {
  replacingNodes.add(node);
  try {
    const orig = emitTranspileExpression(node as unknown as Expression, opts);
    return `((${orig}), ${varName})`;
  } catch (e) {
    // 引擎**无法 lowering** 该表达式（unsupported）→ 本就无从求值：退回旧
    // 口径（只给注入值）。否则整模块 fail-closed（unknown）——比修复前更差。
    if (e instanceof NudoUnsupportedError) return varName;
    throw e;
  } finally {
    replacingNodes.delete(node);
  }
}

export function indent(n: number): string {
  return "  ".repeat(n);
}

/** 字面量 ToString（模板插值 / 字符串拼接）；非字面量 → undefined */
export function litToStringOf(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const n = node as { type?: string; value?: unknown; name?: string };
  switch (n.type) {
    case "StringLiteral":
      return typeof n.value === "string" ? n.value : undefined;
    case "NumericLiteral":
    case "BooleanLiteral":
      return String(n.value);
    case "NullLiteral":
      return "null";
    case "Identifier":
      return n.name === "undefined" ? "undefined" : undefined;
    default:
      return undefined;
  }
}

/**
 * 编译期常量字符串折叠（require 说明符子集）：
 * - StringLiteral
 * - TemplateLiteral（无插值 / 插值全为可 ToString 字面量）
 * - `+` 字符串拼接（至少一侧为可折叠字符串，另一侧为字符串或字面量）
 * 不能折叠 → undefined（诚实动态，不假精确）。
 */
export function foldStaticStringExpr(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const n = node as {
    type?: string;
    value?: unknown;
    quasis?: Array<{ value: { cooked?: string | null; raw: string } }>;
    expressions?: unknown[];
    operator?: string;
    left?: unknown;
    right?: unknown;
    expression?: unknown;
  };
  // ESTree 括号（Babel 通常无此节点，防御）
  if (n.type === "ParenthesizedExpression") return foldStaticStringExpr(n.expression);
  switch (n.type) {
    case "StringLiteral":
      return typeof n.value === "string" ? n.value : undefined;
    case "TemplateLiteral": {
      const quasis = n.quasis ?? [];
      const exprs = n.expressions ?? [];
      let out = "";
      for (let i = 0; i < quasis.length; i++) {
        out += quasis[i]!.value.cooked ?? quasis[i]!.value.raw;
        if (i < exprs.length) {
          const part = foldStaticStringExpr(exprs[i]) ?? litToStringOf(exprs[i]);
          if (part === undefined) return undefined;
          out += part;
        }
      }
      return out;
    }
    case "BinaryExpression": {
      if (n.operator !== "+") return undefined;
      const ls = foldStaticStringExpr(n.left);
      const rs = foldStaticStringExpr(n.right);
      if (ls !== undefined && rs !== undefined) return ls + rs;
      if (ls !== undefined) {
        const r = litToStringOf(n.right);
        if (r !== undefined) return ls + r;
        return undefined;
      }
      if (rs !== undefined) {
        const l = litToStringOf(n.left);
        if (l !== undefined) return l + rs;
        return undefined;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/** require(...) 第一个参数 → 可折叠说明符（StringLiteral / 模板 / 字面量拼接） */
export function foldRequireSpecArg(arg: unknown): string | undefined {
  if (!arg || typeof arg !== "object") return undefined;
  const a = arg as { type?: string };
  if (a.type === "SpreadElement") return undefined;
  return foldStaticStringExpr(arg);
}

/** 对象键 → 字符串（Identifier/StringLiteral/NumericLiteral；其余 null）。
 *  { 10: "a" } 的键是 NumericLiteral，与 "10" 同键（原生 ToPropertyKey）。 */
export function staticKeyOf(key: { type?: string; name?: string; value?: unknown } | null | undefined): string | null {
  if (!key || typeof key !== "object") return null;
  if (key.type === "Identifier") return key.name ?? null;
  if (key.type === "StringLiteral" || key.type === "NumericLiteral") return String(key.value);
  return null;
}

/** 计算键 [Symbol.X] → 已引号化的 "@@X" 投影（对象字面量/访问器）；
 *  其余计算键 → null。镜像成员访问 m[Symbol.iterator] 的投影口径。 */
export function symbolKeyOf(key: { type?: string; computed?: boolean; object?: { type?: string; name?: string }; property?: { type?: string; name?: string } } | null | undefined): string | null {
  if (!key || typeof key !== "object") return null;
  if (
    key.type === "MemberExpression" &&
    key.computed !== true &&
    key.object?.type === "Identifier" &&
    key.object.name === "Symbol" &&
    key.property?.type === "Identifier"
  ) {
    return JSON.stringify(`@@${key.property.name}`);
  }
  return null;
}

/** 收集赋值/Update 左值标识符（while/for pack/unpack 用）。
 *  循环 init 声明的名字在整个循环结构内 shadow 外层绑定，不得收集
 *  （否则外层 pack 会引用内层循环变量——闭包作用域外，ReferenceError）。 */
export function collectAssignedIds(node: unknown, acc: Set<string>, shadowed?: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const sh = shadowed ?? new Set<string>();
  const n = node as {
    type?: string;
    left?: { type?: string; name?: string; object?: unknown };
    init?: unknown;
    argument?: { type?: string; name?: string };
    [k: string]: unknown;
  };
  if (n.type === "ForStatement" || n.type === "ForOfStatement" || n.type === "ForInStatement") {
    const declNode =
      n.type === "ForStatement" ? n.init : (n as { left?: unknown }).left;
    const loopNames = new Set<string>();
    if (
      declNode &&
      typeof declNode === "object" &&
      (declNode as { type?: string }).type === "VariableDeclaration"
    ) {
      for (const d of (declNode as { declarations?: Array<{ id?: unknown }> }).declarations ?? []) {
        collectPatternNames(d.id, loopNames);
      }
    }
    const next = new Set(sh);
    for (const name of loopNames) next.add(name);
    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
      const child = n[key];
      if (Array.isArray(child)) child.forEach((c) => collectAssignedIds(c, acc, next));
      else if (child && typeof child === "object") collectAssignedIds(child, acc, next);
    }
    return;
  }
  if (n.type === "AssignmentExpression" && n.left?.type === "Identifier" && n.left.name) {
    if (!sh.has(n.left.name)) acc.add(n.left.name);
  }
  if (
    n.type === "AssignmentExpression" &&
    n.left?.type === "MemberExpression"
  ) {
    let cur: { type?: string; object?: { type?: string; name?: string }; name?: string } | undefined =
      n.left as { type?: string; object?: { type?: string; name?: string }; name?: string };
    while (cur?.type === "MemberExpression") cur = cur.object;
    if (cur?.type === "Identifier" && cur.name && !sh.has(cur.name)) acc.add(cur.name);
  }
  if (n.type === "UpdateExpression" && n.argument?.type === "Identifier" && n.argument.name) {
    if (!sh.has(n.argument.name)) acc.add(n.argument.name);
  }
  // Bug 21：块内 `var x = init` 经提升改发赋值——函数作用域共享绑定，
  // 循环 pack/unpack 必须覆盖（裸 `var x;` 无写，不收集）
  if (n.type === "VariableDeclaration" && n.kind === "var") {
    const decls = (n.declarations ?? []) as Array<{ id?: unknown; init?: unknown }>;
    for (const d of decls) {
      if (!d.init) continue;
      const names = new Set<string>();
      collectPatternNames(d.id, names);
      for (const name of names) if (!sh.has(name)) acc.add(name);
    }
  }
  for (const key of Object.keys(n)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
    const child = n[key];
    if (Array.isArray(child)) child.forEach((c) => collectAssignedIds(c, acc, sh));
    else if (child && typeof child === "object") collectAssignedIds(child, acc, sh);
  }
}

export const FUNCTION_SCOPE_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

export const BINDING_SCOPE_TYPES = new Set([
  ...FUNCTION_SCOPE_TYPES,
  "CatchClause",
  "ForOfStatement",
  "ForInStatement",
]);

export type IdentNode = {
  type?: string;
  name?: string;
  argument?: { type?: string; name?: string };
  left?: { type?: string; name?: string };
  properties?: unknown[];
  elements?: unknown[];
};

export function collectPatternNames(id: unknown, acc: Set<string>): void {
  if (!id || typeof id !== "object") return;
  const n = id as IdentNode;
  if (n.type === "Identifier" && n.name) acc.add(n.name);
  else if (n.type === "RestElement") collectPatternNames(n.argument, acc);
  else if (n.type === "AssignmentPattern") collectPatternNames(n.left, acc);
  else if (n.type === "ObjectPattern") {
    for (const p of n.properties ?? []) {
      const prop = p as { type?: string; value?: unknown; argument?: unknown };
      if (prop?.type === "RestElement") collectPatternNames(prop.argument, acc);
      else collectPatternNames(prop?.value, acc);
    }
  } else if (n.type === "ArrayPattern") {
    for (const el of n.elements ?? []) collectPatternNames(el, acc);
  }
}

/**
 * Bug 181：源文本里的**用户标识符**信息（临时名避让用）。
 *
 * 转译器发的解构临时名（`_d{n}` / `_n{n}` / `_p{i}` / `_rest{i}` /
 * `_pd{i}`）此前不带任何避让：用户自己声明了同名标识符时，生成码出现
 * `const _d0`（用户已有 `let _d0`）⇒ **重复声明 SyntaxError** ⇒ 整个
 * 模块求值失败 ⇒ 全模块导出退化为 unknown（假 opaque-result）；另一面，
 * 函数体里的 `const _d0` 会**遮蔽**模块级同名用户绑定 ⇒ 用户读到错值。
 *
 * 口径：收集源文本里出现过的**全部标识符词形**（保守超集——含属性名、
 * 字符串与注释里的词形）。临时名只需避开用户名字，超集落在安全侧。
 */
export interface UserIdentInfo {
  /** 源文本里出现过的标识符词形（保守超集） */
  names: Set<string>;
  /** 用户占用的 `_d{n}` / `_n{n}` 序号最大值（-1 = 无占用） */
  tmpSeqMax: number;
}

const EMPTY_USER_IDENT: UserIdentInfo = { names: new Set<string>(), tmpSeqMax: -1 };

/** 源文本 → 用户标识符信息（按源文本缓存：同一模块只扫一次） */
const userIdentCache = new Map<string, UserIdentInfo>();

export function userIdentInfo(source: string | undefined): UserIdentInfo {
  if (!source) return EMPTY_USER_IDENT;
  const hit = userIdentCache.get(source);
  if (hit) return hit;
  const names = new Set<string>();
  const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) names.add(m[0]);
  let tmpSeqMax = -1;
  for (const name of names) {
    const hitSeq = /^_[dn](\d+)$/.exec(name);
    if (!hitSeq) continue;
    const idx = Number(hitSeq[1]);
    if (idx > tmpSeqMax) tmpSeqMax = idx;
  }
  const info: UserIdentInfo = { names, tmpSeqMax };
  // 缓存按源文本持有——模块多时封顶清空（重扫成本可接受）
  if (userIdentCache.size >= 64) userIdentCache.clear();
  userIdentCache.set(source, info);
  return info;
}

/**
 * Bug 181：把共享的解构临时名计数器**推过**用户占用的 `_d{n}` / `_n{n}`
 * 序号。计数器是 statement.ts 的 `_d{n}` 与 emit.ts 的 `_n{n}` 共用的
 * （`n++`），推过后两族名都不再与用户标识符相撞。
 */
export function bumpDestrTmpSeq(seq: { n: number }, info: UserIdentInfo): void {
  if (info.tmpSeqMax < 0) return;
  if (seq.n <= info.tmpSeqMax) seq.n = info.tmpSeqMax + 1;
}

/**
 * Bug 181：取一个不与用户标识符相撞的临时名（base 为期望基名）。
 * 撞名时加数字后缀（`_p0` → `_p0_1`）——形参占位名不能改形（签名面按位对齐）。
 */
export function safeTmpName(base: string, info: UserIdentInfo): string {
  if (!info.names.has(base)) return base;
  let k = 1;
  while (info.names.has(`${base}_${k}`)) k++;
  return `${base}_${k}`;
}

/**
 * Bug 1058 / Bug 1059：引擎**内部临时名**必须**避开用户标识符**。
 *
 * 引擎为转译生成的内部绑定（`arguments` 槽 `__nudoArgs` / try 标记
 * `__nudoTm_{n}` / catch 载体 `__nudoE_{n}` / try 内 return 载体 `__nudoRet`
 * / 写回载体 `__mutRet` / 函数体 catch 载体 `__nudoFnRet` …）此前一律用
 * **固定名**发射 ⇒ 用户源码里写了同名标识符时两种失效形态都成立：
 * - **同作用域重复词法声明** ⇒ 产物不是合法 JS ⇒ `new Function` 编译期
 *   SyntaxError ⇒ 求值器 fail-closed（**整模块**导出退化 unknown + 假
 *   `nudo:opaque-result` ⇒ 门禁假绿）；
 * - **内层遮蔽**用户同名外层绑定 ⇒ 初始化器自引用 ⇒ TDZ ReferenceError ⇒
 *   被用户自己的 catch 吞掉 ⇒ 原生值被算成别的值（wrong-exact）。
 *
 * 口径：`userIdentInfo(source).names` 是**源文本里出现过的全部标识符词形**
 * （保守超集）⇒ 避让在**整个转译单元**生效（不做作用域分析——用户在内层
 * 作用域声明的名字也会遮蔽外层生成的临时名）⇒ 生成名与用户标识符**词形**
 * 永不相撞。命名 `<base>_<k>`（k 从 1 起跳过已占用名）——与 Bug 181 的
 * `safeTmpName` 同款且**确定性**（同一源文本 ⇒ 同一名 ⇒ 产物逐字可重现；
 * 缓存键 / 差分语料依赖它）。**无碰撞时原名返回** ⇒ 产物逐字不变。
 *
 * 配对义务：内部名**生成与使用必须同名**（词法槽 / 载体名）⇒ 调用点要把
 * 算出的名字**存成局部变量**再同时用在声明与引用处，不得各处各算一次
 * （同源文本下两次计算结果相同，但存变量更抗后续改动）。
 */
export function internalTmpName(base: string, opts: TranspileOptions): string {
  return safeTmpName(base, userIdentInfo(opts.source));
}

/**
 * var 提升预扫描（Bug 21）：收集函数体（或模块顶层）内全部 `var` 声明名
 * （含嵌套块/循环/try/switch 臂；含 for-init/left 的 var），**不穿越**
 * 函数/方法/类体边界（那些绑定属于内层作用域）。export var（模块顶层
 * 保持声明面）与参数名由调用方从结果中扣除。
 */
const VAR_HOIST_STOP_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
  "ClassDeclaration",
  "ClassExpression",
  "StaticBlock",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
]);

export function collectVarHoistNames(stmts: readonly unknown[]): Set<string> {
  const acc = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const n = node as {
      type?: string;
      kind?: string;
      declarations?: Array<{ id?: unknown }>;
      [k: string]: unknown;
    };
    if (VAR_HOIST_STOP_TYPES.has(n.type as string)) return;
    if (n.type === "VariableDeclaration") {
      if (n.kind === "var") {
        for (const d of n.declarations ?? []) collectPatternNames(d.id, acc);
      }
      return; // init 内的函数/类体是独立作用域，不下降
    }
    for (const key of Object.keys(node as object)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range" || key === "comments") continue;
      const child = (node as Record<string, unknown>)[key];
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === "object") walk(child);
    }
  };
  for (const s of stmts) walk(s);
  return acc;
}

/** 语句列表顶层 export var 声明名（模块级保持声明面，从提升集扣除） */
export function collectExportVarNames(stmts: readonly unknown[]): Set<string> {
  const acc = new Set<string>();
  for (const s of stmts) {
    const n = s as {
      type?: string;
      declaration?: { type?: string; kind?: string; declarations?: Array<{ id?: unknown }> };
    };
    if (
      n?.type === "ExportNamedDeclaration" &&
      n.declaration?.type === "VariableDeclaration" &&
      n.declaration.kind === "var"
    ) {
      for (const d of n.declaration.declarations ?? []) collectPatternNames(d.id, acc);
    }
  }
  return acc;
}

/**
 * 收集子树内 **词法声明** 名（let/const/function/class；不含 var——函数作用域）。
 * 不进入嵌套函数（那些绑定属于内层作用域）。
 * 用于 fork 协议：臂内声明不是「自由写」，不得 `$copy(未定义名)`。
 */
export function collectLexicalDeclNames(node: unknown, acc: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const n = node as {
    type?: string;
    kind?: string;
    id?: unknown;
    declarations?: Array<{ id?: unknown }>;
    [k: string]: unknown;
  };
  if (FUNCTION_SCOPE_TYPES.has(n.type as string) && n.type !== "BlockStatement") {
    // 函数本体的词法名属于内层；只收函数名（若 FunctionDeclaration）
    if (n.type === "FunctionDeclaration") collectPatternNames(n.id, acc);
    return;
  }
  if (n.type === "VariableDeclaration" && n.kind !== "var") {
    for (const d of n.declarations ?? []) collectPatternNames(d.id, acc);
  } else if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") {
    collectPatternNames(n.id, acc);
  }
  for (const key of Object.keys(n)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
    const child = n[key];
    if (Array.isArray(child)) child.forEach((c) => collectLexicalDeclNames(c, acc));
    else if (child && typeof child === "object") collectLexicalDeclNames(child, acc);
  }
}

/**
 * 循环 pack/unpack 剔除名单：只收循环体**顶层**语句的词法声明名
 * （let/const/class/function；var 是函数作用域不收）。
 * 体顶层声明对整个循环体 shadow 外层绑定，而 pack/unpack 闭包发射在体
 * 作用域之外——引用的是外层绑定，外层无绑定则 ReferenceError（#91：
 * 正则状态重绑 `re = $reStateCall(re, …)` 使声明名进 assigned）——必须剔除。
 * 嵌套块/嵌套函数体内的声明只 shadow 内层作用域，对 unpack 的外层绑定
 * 赋值是合法 JS shadowing，不得剔除（否则跨迭代状态丢失 → 非健全精确）。
 * body 非块（单语句体）→ 空集：原生语法禁止单语句体的词法声明。
 */
export function collectLoopBodyTopLevelDeclNames(body: unknown, acc: Set<string>): void {
  const n = body as { type?: string; body?: unknown } | null | undefined;
  if (!n || n.type !== "BlockStatement" || !Array.isArray(n.body)) return;
  for (const s of n.body as unknown[]) {
    const stmt = s as { type?: string; kind?: string; id?: unknown; declarations?: Array<{ id?: unknown }> };
    if (stmt.type === "VariableDeclaration" && stmt.kind !== "var") {
      for (const d of stmt.declarations ?? []) collectPatternNames(d.id, acc);
    } else if (stmt.type === "FunctionDeclaration" || stmt.type === "ClassDeclaration") {
      collectPatternNames(stmt.id, acc);
    }
  }
}

/**
 * 计算语句列表层的可见 const 绑定名：
 * childConsts = (parentConsts − 本层 let/var 遮蔽) ∪ 本层 const。
 * 不进入嵌套块/函数体（那些作用域各自计算）。
 */
export function computeConstScope(
  stmts: readonly unknown[],
  parentConsts: ReadonlySet<string> | undefined,
): ReadonlySet<string> {
  const consts = new Set<string>();
  const mutables = new Set<string>();
  const walkList = (list: readonly unknown[]): void => {
    for (const s of list) {
      if (!s || typeof s !== "object") continue;
      const n = s as {
        type?: string;
        kind?: string;
        declarations?: Array<{ id?: unknown }>;
        id?: unknown;
        body?: unknown;
      };
      if (n.type === "VariableDeclaration") {
        const target = n.kind === "const" ? consts : mutables;
        for (const d of n.declarations ?? []) collectPatternNames(d.id, target);
        continue;
      }
      if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") {
        // function/class 绑定可再赋（let 语义），遮蔽同名 parent const
        collectPatternNames(n.id, mutables);
        continue;
      }
      // 不进入 BlockStatement / Function / ClassBody / 循环体——嵌套作用域自算
    }
  };
  walkList(stmts);
  const out = new Set<string>();
  if (parentConsts) {
    for (const name of parentConsts) {
      if (!mutables.has(name)) out.add(name);
    }
  }
  for (const name of consts) out.add(name);
  return out;
}

/** 赋值/自增目标若是 const 绑定 → 发射 TypeError 抛出 */
export function isConstAssignTarget(
  name: string,
  opts: { constNames?: ReadonlySet<string> },
): boolean {
  return !!opts.constNames?.has(name);
}

/**
 * 臂内「自由写」绑定：赋值/mutator 标识符在赋值点未被臂内声明遮蔽。
 * 嵌套函数参数 / for-of 绑定 / catch 参数不得把外层自由写从 fork
 * 协议里剔除（P0-1）。
 */
/** AST 节点身份 → free-write / mutator-receiver 扫描结果（热路径去重） */
export const freeAssignedCache = new WeakMap<object, string[]>();
export const mutatorRecvCache = new WeakMap<object, Set<string>>();

export function collectFreeAssignedNames(...nodes: Array<unknown>): string[] {
  const cachedParts: string[][] = [];
  const pending: object[] = [];
  for (const node of nodes) {
    if (node && typeof node === "object") {
      const hit = freeAssignedCache.get(node);
      if (hit) {
        cachedParts.push(hit);
        continue;
      }
      pending.push(node);
    }
  }
  if (pending.length === 0) {
    const merged = new Set<string>();
    for (const p of cachedParts) for (const n of p) merged.add(n);
    return [...merged];
  }
  const free = new Set<string>();
  const markFree = (name: string | undefined, shadowed: Set<string>): void => {
    if (name && !HOST_INTRINSIC_SET.has(name) && !shadowed.has(name)) free.add(name);
  };
  // 同批节点内的词法声明（let/const/function）遮蔽本批自由写——
  // 臂内 `let shares = []; shares.push` 不得进外层 fork 协议（$copy(TDZ)）。
  const batchDecl = new Set<string>();
  for (const node of nodes) collectLexicalDeclNames(node, batchDecl);
  const walk = (node: unknown, shadowed: Set<string>): void => {
    if (!node || typeof node !== "object") return;
    const n = node as {
      type?: string;
      operator?: string;
      left?: unknown;
      right?: unknown;
      argument?: unknown;
      id?: unknown;
      param?: unknown;
      params?: unknown[];
      body?: unknown;
      declarations?: Array<{ id?: unknown }>;
      callee?: {
        type?: string;
        object?: unknown;
        property?: { type?: string; name?: string };
        computed?: boolean;
      };
      [k: string]: unknown;
    };

    let nextShadowed = shadowed;
    const pushShadow = (names: Iterable<string>): void => {
      const add: string[] = [];
      for (const name of names) {
        if (name && !nextShadowed.has(name)) add.push(name);
      }
      if (add.length === 0) return;
      nextShadowed = new Set(nextShadowed);
      for (const name of add) nextShadowed.add(name);
    };

    if (FUNCTION_SCOPE_TYPES.has(n.type as string)) {
      const bound = new Set<string>();
      collectPatternNames(n.id, bound);
      for (const p of n.params ?? []) collectPatternNames(p, bound);
      pushShadow(bound);
    } else if (n.type === "BlockStatement") {
      const bound = new Set<string>();
      for (const stmt of (n.body as unknown[] | undefined) ?? []) {
        collectLexicalDeclNames(stmt, bound);
      }
      pushShadow(bound);
    } else if (n.type === "VariableDeclaration") {
      if (n.kind !== "var") {
        const bound = new Set<string>();
        for (const d of n.declarations ?? []) collectPatternNames(d.id, bound);
        pushShadow(bound);
      } else {
        // Bug 21：`var x = init` 是对函数作用域（提升）绑定的写——臂内
        // var 声明进 fork 协议（snapshot/join）；裸 `var x;` 无写不进
        const written = new Set<string>();
        for (const d of (n.declarations ?? []) as Array<{ id?: unknown; init?: unknown }>) {
          if (d.init) collectPatternNames(d.id, written);
        }
        for (const name of written) markFree(name, nextShadowed);
      }
    } else if (n.type === "CatchClause") {
      const bound = new Set<string>();
      collectPatternNames(n.param, bound);
      pushShadow(bound);
    } else if (n.type === "ForOfStatement" || n.type === "ForInStatement") {
      const bound = new Set<string>();
      const left = n.left as
        | { type?: string; declarations?: Array<{ id?: unknown }>; name?: string }
        | undefined;
      if (left?.type === "VariableDeclaration") {
        for (const d of left.declarations ?? []) collectPatternNames(d.id, bound);
      } else {
        collectPatternNames(left, bound);
      }
      pushShadow(bound);
    } else if (n.type === "ForStatement") {
      // `for (let i = …)` / `for (const i = …)`：init 名是循环内绑定，
      // 不得进 fork 协议（否则臂外 `$copy(i)` → ReferenceError）。
      // `var` 是函数作用域——仍作自由写（与 extractForInitName 口径一致）。
      const init = n.init as
        | { type?: string; kind?: string; declarations?: Array<{ id?: unknown }> }
        | undefined;
      if (init?.type === "VariableDeclaration" && init.kind !== "var") {
        const bound = new Set<string>();
        for (const d of init.declarations ?? []) collectPatternNames(d.id, bound);
        pushShadow(bound);
      }
    }

    if (n.type === "AssignmentExpression") {
      const left = n.left as
        | { type?: string; name?: string; object?: unknown }
        | undefined;
      if (left?.type === "Identifier") markFree(left.name, nextShadowed);
      else if (left?.type === "MemberExpression") {
        let cur: { type?: string; object?: unknown; name?: string } | undefined =
          left as { type?: string; object?: unknown; name?: string };
        while (cur?.type === "MemberExpression") {
          cur = cur.object as { type?: string; object?: unknown; name?: string } | undefined;
        }
        if (cur?.type === "Identifier") markFree(cur.name, nextShadowed);
      }
    }
    if (n.type === "UpdateExpression") {
      const arg = n.argument as { type?: string; name?: string; object?: unknown } | undefined;
      if (arg?.type === "Identifier") markFree(arg.name, nextShadowed);
      else if (arg?.type === "MemberExpression") {
        let cur: { type?: string; object?: unknown; name?: string } | undefined =
          arg as { type?: string; object?: unknown; name?: string };
        while (cur?.type === "MemberExpression") {
          cur = cur.object as { type?: string; object?: unknown; name?: string } | undefined;
        }
        if (cur?.type === "Identifier") markFree(cur.name, nextShadowed);
      }
    }
    if (
      n.type === "CallExpression" &&
      n.callee?.type === "MemberExpression" &&
      n.callee.computed !== true &&
      n.callee.property?.type === "Identifier" &&
      isStatefulMethodName((n.callee.property as { name: string }).name)
    ) {
      const obj = n.callee.object as
        | { type?: string; name?: string; object?: unknown }
        | undefined;
      if (obj?.type === "Identifier") markFree(obj.name, nextShadowed);
      else if (obj?.type === "MemberExpression" || obj?.type === "ThisExpression") {
        let cur: { type?: string; object?: unknown; name?: string } | undefined = obj as unknown as { type?: string; object?: unknown; name?: string };
        while (cur?.type === "MemberExpression") {
          cur = cur.object as { type?: string; object?: unknown; name?: string } | undefined;
        }
        if (cur?.type === "Identifier") markFree(cur.name, nextShadowed);
      }
    }

    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
      if (key === "callee" || key === "property" || key === "param" || key === "params") continue;
      const child = n[key];
      if (Array.isArray(child)) {
        if (
          n.type === "BlockStatement" ||
          n.type === "Program" ||
          n.type === "StaticBlock" ||
          n.type === "SwitchCase"
        ) {
          let blockShadow = nextShadowed;
          for (const stmt of child) {
            walk(stmt, blockShadow);
            const stmtNode = stmt as {
              type?: string;
              declarations?: Array<{ id?: unknown }>;
              id?: unknown;
            } | null;
            if (!stmtNode) continue;
            const declared = new Set<string>();
            if (stmtNode.type === "VariableDeclaration") {
              for (const d of stmtNode.declarations ?? []) collectPatternNames(d.id, declared);
            } else if (
              stmtNode.type === "FunctionDeclaration" ||
              stmtNode.type === "ClassDeclaration"
            ) {
              collectPatternNames(stmtNode.id, declared);
            }
            if (declared.size > 0) {
              if (blockShadow === nextShadowed) blockShadow = new Set(blockShadow);
              for (const name of declared) blockShadow.add(name);
            }
          }
          continue;
        }
        for (const item of child) walk(item, nextShadowed);
      } else if (child && typeof child === "object") {
        walk(child, nextShadowed);
      }
    }

    // 函数参数/体在扩展后的 shadow 下求值
    if (FUNCTION_SCOPE_TYPES.has(n.type as string) && n.body) {
      walk(n.body, nextShadowed);
    }
  };

  for (const node of pending) {
    walk(node, new Set(batchDecl));
  }
  const computed = [...free].filter((n) => !batchDecl.has(n));
  for (const node of pending) freeAssignedCache.set(node, computed);
  const merged = new Set<string>(computed);
  for (const p of cachedParts) for (const n of p) {
    if (!batchDecl.has(n)) merged.add(n);
  }
  return [...merged];
}

/**
 * 抽象臂间需要 snapshot/join 的自由写绑定。
 * 仅在赋值点被臂内声明遮蔽的名字不进协议。
 */
export function collectForkBindingNames(...nodes: Array<unknown>): string[] {
  return collectFreeAssignedNames(...nodes);
}


export function collectArrMutatorReceiversUncached(node: unknown, acc = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return acc;
  const n = node as Record<string, unknown>;
  if (
    n.type === "FunctionExpression" ||
    n.type === "ArrowFunctionExpression" ||
    n.type === "ObjectMethod" ||
    n.type === "ClassMethod" ||
    n.type === "FunctionDeclaration"
  ) {
    return acc;
  }
  if (
    n.type === "CallExpression" &&
    (n.callee as { type?: string; object?: Node; property?: Node; computed?: boolean } | undefined)
      ?.type === "MemberExpression"
  ) {
    const callee = n.callee as { object?: Node; property?: Node; computed?: boolean };
    const propName =
      !callee.computed && callee.property?.type === "Identifier"
        ? (callee.property as { name: string }).name
        : undefined;
    if (propName && isStatefulMethodName(propName)) {
      const obj = callee.object;
      if (obj?.type === "Identifier") {
        acc.add((obj as { name: string }).name);
      } else if (obj?.type === "MemberExpression") {
        let cur: { type?: string; object?: { type?: string } } | undefined =
          obj as { type?: string; object?: { type?: string } };
        while (cur?.type === "MemberExpression") {
          cur = cur.object;
        }
        if (cur?.type === "Identifier") {
          acc.add((cur as unknown as { name: string }).name);
        }
      }
    }
  }
  for (const key of Object.keys(n)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
    const child = n[key];
    if (Array.isArray(child)) child.forEach((c) => collectArrMutatorReceiversUncached(c, acc));
    else if (child && typeof child === "object") collectArrMutatorReceiversUncached(child, acc);
  }
  return acc;
}

/** 收集语句/表达式里以 Identifier 为 receiver 的数组 mutator 名 */
export function collectArrMutatorReceivers(node: unknown, acc = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return acc;
  const hit = mutatorRecvCache.get(node as object);
  if (hit) {
    for (const n of hit) acc.add(n);
    return acc;
  }
  const local = new Set<string>();
  collectArrMutatorReceiversUncached(node, local);
  mutatorRecvCache.set(node as object, local);
  for (const n of local) acc.add(n);
  return acc;
}

export function isExpression(n: { type: string }): n is Expression {
  return n.type !== "PrivateName" && !n.type.endsWith("Statement") && !n.type.endsWith("Declaration");
}

/** PrivateName 节点 → "#x" 混淆键源串（JSON 字符串字面量；公有名不含
 *  "#"，无碰撞）。成员读/写（Bug 78）与 in 运算符（Bug 80）共用——统一
 *  提取点防内联复制复发。无名（解析异常）→ null，交调用方 fail-closed。 */
export function privateNameKeySrc(prop: { id?: { name?: string }; name?: string }): string | null {
  const priv = prop.id?.name ?? prop.name;
  return priv ? JSON.stringify(`#${priv}`) : null;
}

/**
 * Bug 133：ES **NamedEvaluation**——类表达式绑定到名字时以该名为类名
 * （`const K = class {}` → `K.name === "K"`；`K = class {}` /
 * `{ K: class {} }` 同）。原生只有「类表达式**自身**在具名位置」才取名，
 * 其余位置（数组元素 / 实参 / 未绑定）类名是空串。
 *
 * 只给**类表达式**节点挂 hint：非类表达式原样返回 opts（不得把 hint 泄进
 * 任意子表达式的类表达式里）。
 */
export function withClassNameHint(
  opts: TranspileOptions,
  node: Node | null | undefined,
  name: string | undefined,
): TranspileOptions {
  if (name === undefined || node?.type !== "ClassExpression") return opts;
  return { ...opts, classNameHint: name };
}
