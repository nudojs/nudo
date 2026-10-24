/**
 * 内部模块：字面量调用点扫描的**实参抽取层**（core algebra / scan）。
 *
 * 职责：从调用点的**实参 AST 节点**抽出 Abs（实参值）+「是否携带可执法信息」
 * 标记（`hasInfo`）。本模块是族 11 拆出的三个内部模块之一，
 * **只在 core 包内被 `scan-literal-calls.ts` 相对 import**——
 * **不新增任何 core 公开导出**（`src/index.ts` / `algebra/index.ts` /
 * `algebra/exec/index.ts` / `internal.ts` 四张冻结面表一行都不动）。
 *
 * ── S0 共享契约（下游 S1 / S2 消费；改动前先读本段）────────────────────────
 *
 * **契约① 共享 ctx 对象**：`LiteralScanCtx`（**本文件导出**，S0 冻结）。
 * 三个内部模块共享**同一个显式 ctx**，字段固定为：
 *   - `out`      : `CheckIssue[]` —— 诊断输出缓冲（所有 issue push 到这里）
 *   - `knownFns` : `string[]`     —— 已知入口函数名（checkSource 传入）
 *   - `opts`     : `ScanLiteralCallsOptions | undefined` —— 扫描选项
 *   - `source`   : `string`       —— 当前文件源码
 *   - `file`     : Babel `File`   —— 当前文件 AST（`parse(source)` 的结果）
 *   - `varAbs`   : `Map<string, Abs>` —— 顶层绑定表
 *   - `resolve`  : `CallResolve`  —— 跨文件调用解析表（`collectCallResolvers`）
 * ctx 只被**读**（`out` 是输出缓冲）⇒ 执法路径是纯函数式的。
 *
 * **契约② 零新增 core 导出**：本目录（`algebra/scan/`）下的模块**只被
 * `scan-literal-calls.ts` 相对 import**，不得从 `algebra/index.ts` /
 * `src/index.ts` / `internal.ts` 再导出。
 *
 * **契约③ `parseCallArgs` 快路径分派表（定型；Bug 430 的修法在此）**：
 *   `NumericLiteral` / **`BigIntLiteral`（1020 的 bigint 实参那一半；S6 新增
 *   分支）** / `Unary(-)`（number 与 bigint 两种实参） / `ObjectExpression` /
 *   `ArrayExpression` / `StringLiteral` / `NullLiteral` / **`BooleanLiteral`
 *   （430 新增分支）** / `Identifier` / `MemberExpression` / `SpreadElement` /
 *   `CallExpression` / 兜底（`absUnknown()`）。
 *   —— **`BooleanLiteral` 分支就是 Bug 430 的修法**：此前布尔字面量落兜底
 *   ⇒ `hasInfo=false` ⇒ 顶层靠执行态回退才报错、**函数体内整条调用点被跳过**
 *   ⇒ 同一违规「顶层报错、函数体内静默」。
 *   —— **`BigIntLiteral` 分支就是 Bug 1020「bigint 实参那一半」的修法**
 *   （S6）：此前 bigint 字面量落兜底 ⇒ 同样的「函数体内静默」。
 *
 * **契约④ `derefConstraint` 通路**：`literal-shapes.ts` 经
 * `../constraint.ts` 相对 import 拿到 `derefConstraint`（Bug 439 用）——
 * 通路已打通（`literal-shapes.ts` 里有一行 re-export 证明该依赖边成立）。
 *
 * **契约⑤ 零实参早退落点**：两处 `absArgs.length === 0` 早退在**薄壳**
 * `scan-literal-calls.ts` 的 `checkOneCall` / `checkExternalCall` 里
 * （本模块的 `defaultArgAbss` 提供默认值实参；早退判定留在薄壳）。
 */

import type { Node } from "@babel/types";
import { freeIdentifiers } from "../exec/body-fn.ts";
import { evalExprAbs } from "../exec/run.ts";
import { parseSource as parse } from "../parse-source.ts";
import { absLit, anyAbs, bigintLit, confJoin, numLit } from "../abs.ts";
import type { Abs, Confidence } from "../abs.ts";
import type { CheckIssue } from "../check-report.ts";
import type { CallResolve } from "../scan-call-graph.ts";
import { jsDocOptionalParams, tsOptionalParams } from "../param-surface.ts";

/**
 * `scanLiteralCalls` 的选项（**结构上**与薄壳里 `scanLiteralCalls` 的
 * `opts` 形参逐字等价——薄壳保留内联字面量类型，本类型只是它的结构镜像）。
 */
export interface ScanLiteralCallsOptions {
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  fromFile?: string;
  file?: ReturnType<typeof parse>;
  /** 顶层绑定表（与结构赋值共享一次执行态求值结果） */
  varAbs?: Map<string, Abs>;
  /**
   * 求值引擎执行态调用记录（值流回退）：静态实参无信息时按 fnName@line 取
   * 执行态实参。变量键查找已折 any（hasInfo），不会误触发本回退。
   */
  bCalls?: Array<{
    fnName: string;
    args: Abs[];
    callLoc?: { line: number; column: number };
  }>;
  /** 侧车 ambient 绑定开关（checkSource 的 package.json 配置下传） */
  autoBind?: boolean;
  /** 项目根：树外侧车不 ambient 绑定 */
  projectDir?: string;
}

/** 三个内部模块共享的**显式 ctx**（契约①；S0 冻结）。 */
export interface LiteralScanCtx {
  /** 诊断输出缓冲 */
  out: CheckIssue[];
  /** 已知入口函数名 */
  knownFns: string[];
  /** 扫描选项 */
  opts: ScanLiteralCallsOptions | undefined;
  /** 当前文件源码 */
  source: string;
  /** 当前文件 AST */
  file: ReturnType<typeof parse>;
  /** 顶层绑定表 */
  varAbs: Map<string, Abs>;
  /** 跨文件调用解析表 */
  resolve: CallResolve;
}

// ---------------------------------------------------------------------------
// 静态实参求值辅助（absUnknown / evalArgAbs）
// ---------------------------------------------------------------------------

export function absUnknown(): Abs {
  return { shape: { k: "unknown" }, conf: "partial" };
}

/**
 * Bug 400：rest 形参的值 = 该位之后**全部实参**聚成的数组（不是第 i 个实参）。
 *
 * 形如 `sum(...nums)` 的 rest 形参吃的是「余下所有实参」⇒ 契约面
 * （`array(number().gt(0))`）要与**聚合值**比，而不是与首个实参比。聚合值用
 * **精确元组**（tuple）：元素逐个可判 ⇒ 元素契约逐元素查；conf 取元素里最差
 * 的那个（全 exact ⇒ exact）。
 */
export function restArgAbs(tail: Abs[]): Abs {
  const conf = tail.reduce<Confidence>((c, a) => confJoin(c, a.conf), "exact");
  return { shape: { k: "tuple", elements: tail }, conf };
}

/**
 * 数组实参的元素个数（Bug 922：`array(number()).min(3)` 的长度界）。
 *
 * tuple 形态带**逐元素**槽 ⇒ 长度可判；arr 形态只有 join 过的元素类型 ⇒
 * 长度不可判（undefined ⇒ 长度界不猜）。
 */
export function arrayLengthOf(a: Abs): number | undefined {
  if (a.shape.k !== "tuple") return undefined;
  return a.shape.elements.length;
}

/** 实参是否携带可执法信息（含确定 undefined；纯 unknown 不算） */
export function isInformativeArg(a: Abs | undefined | null): boolean {
  // eval 执行态 args 可能有空洞（稀疏调用/可选实参）——fail-closed 当无信息
  if (!a || typeof a !== "object") return false;
  if (a.term?.op === "lit") return true;
  return a.shape?.k !== "unknown" && a.shape !== undefined;
}

/** 布尔字面量 Abs（prim boolean + lit term；与字符串字面量分支同款——不带 pred） */
function boolLitAbs(value: boolean): Abs {
  return {
    shape: { k: "prim", type: "boolean" },
    term: { op: "lit", value },
    conf: "exact",
  };
}

/**
 * 全局常量字面量（`NaN` / `Infinity`）：未被顶层绑定遮蔽（`varAbs` 未命中）时
 * 值确定。Bug 1157：此前落兜底 `absUnknown()` ⇒ `hasInfo=false` ⇒ **函数体内**
 * 整条调用点被跳过（假绿：`NaN ⊭ number().gt(0)` 是确定事实）。
 */
const GLOBAL_CONST_ABSS: Readonly<Record<string, Abs>> = {
  NaN: numLit(Number.NaN),
  Infinity: numLit(Number.POSITIVE_INFINITY),
};

/**
 * `new X()` 产物**确定是对象/数组**的全局构造器（Bug 1157）。
 *
 * 只收这些名字：任意构造器的 `new` 可能**返回原语**
 * （`new (function(){ return 1 })()` === 1）⇒ 不能按「new ⇒ object」一刀切
 * （引擎对这种形态也折成 brand 对象 ⇒ 按它执法会是假红）。名字被顶层绑定
 * 遮蔽（`varAbs` 命中）⇒ 不是全局构造器 ⇒ 不猜。
 */
const GLOBAL_CTOR_NAMES: ReadonlySet<string> = new Set([
  "Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet",
  "Array", "Object", "Error", "TypeError", "RangeError",
  "SyntaxError", "ReferenceError", "EvalError", "URIError",
]);

/** 静态求值实参节点 → Abs（标识符走绑定表；对象/数组字面量内的标识符也走绑定表） */
export function evalArgAbs(
  node: Record<string, unknown>,
  lookupVar?: (name: string) => Abs | undefined,
): Abs | undefined {
  if (node.type === "Identifier" && typeof node.name === "string" && lookupVar) {
    return lookupVar(node.name);
  }
  try {
    // B 表达式编译执行（fail-closed）；自由标识符
    // 按绑定表注入（`{...base}` / `[x]` 等复合实参的标识符解析）
    const free = freeIdentifiers(node as unknown as Node, []);
    const bindings: Record<string, Abs> = {};
    if (lookupVar) {
      for (const name of free) {
        const v = lookupVar(name);
        if (v) bindings[name] = v;
      }
    }
    return evalExprAbs(node as unknown as import("@babel/types").Expression, bindings);
  } catch {
    return undefined;
  }
}

/**
 * 实参是不是**显式 `undefined`**（`f(undefined)`）——JS 语义：带默认值的形参
 * 收到显式 `undefined` 时**走默认值**（`f(undefined)` ≡ `f()`）。
 * Bug 1110：此前 `undefined` 被当成「值就是 undefined」去过契约 ⇒ 报假红。
 */
export function isExplicitUndefinedArg(node: unknown): boolean {
  const n = node as { type?: string; name?: string } | undefined;
  return n?.type === "Identifier" && n.name === "undefined";
}

/**
 * 实参抽取的**快路径分派表**（契约③）。
 *
 * 分派顺序固定：`NumericLiteral` / `BigIntLiteral` / `Unary(-)`（数字 / bigint /
 * 全局常量 `NaN`·`Infinity`）/ `ObjectExpression` / `ArrayExpression` /
 * `StringLiteral` / `NullLiteral` / `BooleanLiteral` / `Identifier`（含全局
 * `NaN`·`Infinity`）/ `MemberExpression` / `SpreadElement` / `CallExpression`
 * （含 `Symbol(...)`）/ `void` / 形态确定的字面量（函数·类表达式 / 正则 /
 * 模板 / 全局构造器 `new`）/ 兜底。**兜底 = `absUnknown()`** ⇒ `hasInfo`
 * 保持 false ⇒ 该调用点整条跳过执法（静态路径），只剩执行态实参回退
 * （顶层语句才有）⇒ 「位置决定裁决」。
 *
 * Bug 430：`BooleanLiteral` 分支是 S0 新增的（此前布尔字面量落兜底）。
 * Bug 1020：`BigIntLiteral` 分支是 S6 新增的（此前 bigint 字面量落兜底）。
 * Bug 1157：全局常量 / `void` / 形态确定字面量分支（此前落兜底 ⇒ 函数体内
 * 整条调用点跳过）。
 */
export function parseCallArgs(
  ctx: LiteralScanCtx,
  args: Array<Record<string, unknown>>,
): {
  absArgs: Abs[];
  hasInfo: boolean;
  /**
   * **语法实参个数**（元数检查用）。`undefined` = 个数**不可判**（非字面量
   * 展开 `f(...args)`）⇒ 调用点**跳过**元数检查（fail-closed：不猜）。
   * Bug 1105：此前非字面量展开只产**一个** `absUnknown()` 槽位 ⇒
   * `impl(...args)` 被计成 1 个实参 ⇒ `nudo:arg-count` 假红。
   */
  argCount: number | undefined;
  /**
   * 首个**非字面量展开**在 `absArgs` 里的下标（无则 `undefined`）。
   * 契约面（rest / length 边界）在该点**停止**：展开后的槽位个数不可知 ⇒
   * 不把它算进已知长度（Bug 1105：幻影槽位破坏 rest 聚合）。
   */
  spreadAt: number | undefined;
} {
  const absArgs: Abs[] = [];
  let hasInfo = false;
  /** 非字面量展开 ⇒ 实参个数不可判 */
  let argCountUnknown = false;
  /** 首个非字面量展开的 absArgs 下标 */
  let spreadAt: number | undefined;
  const varAbs = ctx.varAbs;
  const note = (abs: Abs | undefined): void => {
    if (abs && isInformativeArg(abs)) hasInfo = true;
  };
  for (const a of args ?? []) {
    if (a.type === "NumericLiteral" && typeof a.value === "number") {
      absArgs.push(numLit(a.value));
      hasInfo = true;
    } else if (a.type === "BigIntLiteral" && typeof a.value === "bigint") {
      // `1n` 字面量（Bug 1020 的「bigint 实参那一半」；族 11 片 S6）：
      // 此前**没有快路径** ⇒ 落兜底 `absUnknown()` ⇒ `hasInfo=false` ⇒
      // **函数体内整条调用点被跳过** ⇒ `f(1n)` 没有可执法信息（与 430 的
      // boolean 形态同款：「顶层靠执行态回退才报错、函数体内静默」）。
      // 与 `BooleanLiteral` 分支同款：prim + lit term + `conf: "exact"`。
      //
      // ⚠ **Babel 实测**（`parse-source.ts` 的 `@babel/parser`，typescript +
      // jsx 插件）：`BigIntLiteral` 节点的 `value` 是**真 bigint**
      // （`typeof a.value === "bigint"`），**不是字符串**；原始文本在
      // `a.extra.raw`（如 `"0x10n"` / `"1_000n"`）⇒ 取值直接用 `a.value`
      // （已归一化的十进制 bigint），不要去解析 `extra.raw`。
      absArgs.push(bigintLit(a.value));
      hasInfo = true;
    } else if (
      a.type === "UnaryExpression" &&
      (a as { operator?: string }).operator === "-" &&
      (a as { argument?: Record<string, unknown> }).argument?.type === "NumericLiteral"
    ) {
      const num = (a as { argument: { value: number } }).argument;
      absArgs.push(numLit(-num.value));
      hasInfo = true;
    } else if (
      a.type === "UnaryExpression" &&
      (a as { operator?: string }).operator === "-" &&
      (a as { argument?: Record<string, unknown> }).argument?.type === "BigIntLiteral" &&
      typeof (a as { argument: { value?: unknown } }).argument.value === "bigint"
    ) {
      // `-1n`：Babel 实测**负 bigint 不是 `BigIntLiteral` 节点**，而是
      // `UnaryExpression(-)` 包 `BigIntLiteral` ⇒ 与上面的 `Unary(-)` 分支同款。
      const big = (a as { argument: { value: bigint } }).argument;
      absArgs.push(bigintLit(-big.value));
      hasInfo = true;
    } else if (
      a.type === "UnaryExpression" &&
      (a as { operator?: string }).operator === "-" &&
      (a as { argument?: Record<string, unknown> }).argument?.type === "Identifier" &&
      !varAbs.has((a as { argument: { name: string } }).argument.name) &&
      ((a as { argument: { name: string } }).argument.name === "Infinity" ||
        (a as { argument: { name: string } }).argument.name === "NaN")
    ) {
      // `-Infinity` / `-NaN`（Bug 1157）：全局常量取负，值确定。
      const name = (a as { argument: { name: string } }).argument.name;
      absArgs.push(numLit(name === "Infinity" ? Number.NEGATIVE_INFINITY : Number.NaN));
      hasInfo = true;
    } else if (a.type === "ObjectExpression") {
      const abs = evalArgAbs(a, (n) => varAbs.get(n));
      absArgs.push(abs ?? absUnknown());
      note(abs);
    } else if (a.type === "ArrayExpression") {
      const abs = evalArgAbs(a, (n) => varAbs.get(n));
      absArgs.push(abs ?? absUnknown());
      note(abs);
    } else if (a.type === "StringLiteral" && typeof a.value === "string") {
      absArgs.push({
        shape: { k: "prim", type: "string" },
        term: { op: "lit", value: a.value },
        conf: "exact",
      });
      hasInfo = true;
    } else if (a.type === "NullLiteral") {
      // `null` 字面量（Bug 965）：此前只抽 Numeric/String ⇒ `f(null)` **根本没有
      // 实参 Abs** ⇒ 调用点前置条件整条不查（`lit(null)` / `lit(undefined)`
      // 契约对 null 实参永远不报违例 = 假绿）。null 与 undefined 是**两个域**，
      // 实参 Abs 必须能区分（`absLit` 用 `lit` term 承载这个区别）。
      absArgs.push(absLit(null));
      hasInfo = true;
    } else if (a.type === "BooleanLiteral" && typeof a.value === "boolean") {
      // `true` / `false` 字面量（Bug 430）：此前**没有快路径** ⇒ 落兜底
      // `absUnknown()` ⇒ `hasInfo=false` ⇒ 顶层靠执行态回退才报错、
      // **函数体内整条调用点被静默跳过** ⇒ 同一违规「顶层报错、函数体内静默」。
      // 与 `NullLiteral` 分支同款：布尔是 prim 域，`typeof` / eq / 数值界各通道
      // 都能判（`absLit` 会把 boolean 折成 `boolLit`）。
      absArgs.push(boolLitAbs(a.value));
      hasInfo = true;
    } else if (a.type === "Identifier" && typeof a.name === "string") {
      if (a.name === "undefined") {
        // `undefined` 是**全局绑定**（不是局部变量）⇒ 实参确实可判 ⇒ 同样要抽
        // （否则 `f(undefined)` 的实参是 unknown ⇒ 调用点检查整条被跳过）。
        absArgs.push(absLit(undefined));
        hasInfo = true;
        continue;
      }
      const abs = varAbs.get(a.name);
      // Bug 1157：全局常量（NaN / Infinity）——未被顶层绑定遮蔽时值确定。
      const globalConst = abs ? undefined : GLOBAL_CONST_ABSS[a.name];
      if (globalConst) {
        absArgs.push(globalConst);
        hasInfo = true;
        continue;
      }
      absArgs.push(abs ?? absUnknown());
      note(abs);
    } else if (a.type === "MemberExpression") {
      // 变量键查找（map[k]）→ any（any ≤ 任意目标；≠ unknown 不发明义务）
      const computed = (a as { computed?: boolean }).computed === true;
      const prop = (a as { property?: Record<string, unknown> }).property;
      const litKey =
        prop?.type === "StringLiteral" || prop?.type === "NumericLiteral";
      if (computed && !litKey) {
        absArgs.push(anyAbs);
        hasInfo = true;
        continue;
      }
      const abs = evalArgAbs(a, (n) => varAbs.get(n));
      absArgs.push(abs ?? absUnknown());
      note(abs);
    } else if (a.type === "SpreadElement") {
      // 字面量数组 spread（`f(...[1, -2])`）：静态展开元素（字面量快路径）。
      // 非字面量（`f(...args)`）不猜——eval 通道实参回退。
      const inner = (a as { argument?: Record<string, unknown> }).argument;
      if (inner?.type === "ArrayExpression") {
        for (const el of (inner.elements ?? []) as Array<Record<string, unknown> | null>) {
          if (!el) {
            // **空洞**（`f(...[1,,3])`）：原生展开产出 `1, undefined, 3` **三个**
            // 实参。此前 `continue` 跳过 ⇒ 计成 2 个 ⇒ 元数检查假红（Bug 1105）。
            absArgs.push(absLit(undefined));
            hasInfo = true;
            continue;
          }
          if (el.type === "NumericLiteral" && typeof el.value === "number") {
            absArgs.push(numLit(el.value));
            hasInfo = true;
          } else if (el.type === "StringLiteral" && typeof el.value === "string") {
            absArgs.push({
              shape: { k: "prim", type: "string" },
              term: { op: "lit", value: el.value },
              conf: "exact",
            });
            hasInfo = true;
          } else {
            const abs = evalArgAbs(el, (n) => varAbs.get(n));
            absArgs.push(abs ?? absUnknown());
            note(abs);
          }
        }
      } else {
        // 非字面量展开：实参**个数不可判** ⇒ 元数检查跳过（Bug 1105）。
        // 槽位仍占一位（保持实参位与形参位的下标对应），契约面在该点停止。
        absArgs.push(absUnknown());
        argCountUnknown = true;
        if (spreadAt === undefined) spreadAt = absArgs.length - 1;
      }
    } else if (
      a.type === "CallExpression" &&
      (a as { callee?: { type?: string; name?: string } }).callee?.type === "Identifier" &&
      (a as { callee: { name: string } }).callee.name === "Symbol" &&
      !varAbs.has("Symbol")
    ) {
      // `Symbol(...)` 恒返回 symbol（全局 Symbol 未被顶层绑定遮蔽）⇒ 形态确定
      // （Bug 1157）：`number()` / `string()` 契约**确定违例**。此前落下面的
      // CallExpression 兜底 unknown ⇒ 函数体内调用点整条跳过。
      absArgs.push({ shape: { k: "prim", type: "symbol" }, conf: "partial" });
      hasInfo = true;
    } else if (a.type === "CallExpression") {
      // 内联调用（a.pop()/a.push(…)/xs.find(…)）：transpile 表达式位可能折
      // $lit(undefined) 假精确，静态不猜——交给 eval 执行态实参回退。
      absArgs.push(absUnknown());
    } else if (
      a.type === "UnaryExpression" &&
      (a as { operator?: string }).operator === "void"
    ) {
      // `void <expr>` 恒求值为 undefined（Bug 1157）——不执行 operand，值确定。
      absArgs.push(absLit(undefined));
      hasInfo = true;
    } else if (
      a.type === "ArrowFunctionExpression" ||
      a.type === "FunctionExpression" ||
      a.type === "ClassExpression" ||
      a.type === "RegExpLiteral" ||
      a.type === "TemplateLiteral" ||
      (a.type === "NewExpression" &&
        (a as { callee?: { type?: string; name?: string } }).callee?.type === "Identifier" &&
        GLOBAL_CTOR_NAMES.has((a as { callee: { name: string } }).callee.name) &&
        !varAbs.has((a as { callee: { name: string } }).callee.name))
    ) {
      // 形态**语法上确定**的字面量实参（Bug 1157）：函数 / 箭头 / 类表达式
      // （恒为 function）、正则字面量（恒为对象）、模板字面量（恒为 string）、
      // 已知全局构造器的 `new`（恒为对象）。此前全部落兜底 `absUnknown()`
      // ⇒ hasInfo=false ⇒ **函数体内**整条调用点被跳过（假绿：`f(() => 1)` /
      // `f(new Date(0))` 对 `number()` 契约零义务）。值与形态交给 evaluator
      // 求（与 ObjectExpression / ArrayExpression 同款）；求不出来 ⇒ 仍是
      // unknown ⇒ 不猜（fail-closed）。
      const abs = evalArgAbs(a, (n) => varAbs.get(n));
      absArgs.push(abs ?? absUnknown());
      note(abs);
    } else {
      absArgs.push(absUnknown());
    }
  }
  return { absArgs, hasInfo, argCount: argCountUnknown ? undefined : absArgs.length, spreadAt };
}

// ---------------------------------------------------------------------------
// Bug 444：零实参调用的默认值实参
// ---------------------------------------------------------------------------

type AstNode = Record<string, unknown>;

/** 函数节点的形参数组（FunctionDeclaration / FunctionExpression / Arrow / ObjectMethod / ClassMethod） */
function paramsOfFnNode(node: unknown): unknown[] | undefined {
  const n = node as { type?: string; params?: unknown[] } | undefined;
  if (!n) return undefined;
  if (
    n.type === "FunctionDeclaration" ||
    n.type === "FunctionExpression" ||
    n.type === "ArrowFunctionExpression" ||
    n.type === "ObjectMethod" ||
    n.type === "ClassMethod" ||
    n.type === "ClassPrivateMethod"
  ) {
    return Array.isArray(n.params) ? n.params : undefined;
  }
  return undefined;
}

/**
 * 按名字找被调函数的**声明节点**（顶层声明扫描）。
 *
 * 覆盖：`export function f` / `function f` / `export const f = (…) => …` /
 * `export default function f` / 类方法 `C.m`。找不到 ⇒ undefined（fail-closed：
 * 取不到默认值 ⇒ 不补实参 ⇒ 行为与修复前一致）。
 *
 * 返回 `{ fn, stmt }`：`fn` = 函数节点（形参 / JSDoc 载体），`stmt` = 顶层语句
 * 节点（`export function f` 的 JSDoc 挂在 **export 包装**上而不是函数节点上
 * ⇒ 两侧都要看，Bug 1108）。
 */
export function findFnDecl(
  fileAst: ReturnType<typeof parse> | undefined,
  fnName: string,
): { fn: AstNode; stmt: AstNode } | undefined {
  const body = fileAst?.program?.body ?? [];
  for (const stmt of body) {
    const s = stmt as unknown as AstNode;
    let decl: AstNode = s;
    if (s.type === "ExportNamedDeclaration" || s.type === "ExportDefaultDeclaration") {
      decl = (s.declaration as unknown as AstNode) ?? s;
    }
    // ① 函数声明
    if (decl.type === "FunctionDeclaration") {
      const id = decl.id as { name?: string } | undefined;
      if (id?.name === fnName) {
        const p = paramsOfFnNode(decl);
        if (p) return { fn: decl, stmt: s };
      }
    }
    // ② 变量声明（箭头 / 函数表达式）
    if (decl.type === "VariableDeclaration") {
      const decls = (decl.declarations as AstNode[] | undefined) ?? [];
      for (const d of decls) {
        const did = d.id as { type?: string; name?: string } | undefined;
        if (did?.type === "Identifier" && did.name === fnName) {
          const p = paramsOfFnNode(d.init);
          if (p) return { fn: d.init as AstNode, stmt: s };
        }
      }
    }
    // ③ 类方法（`C.m`）
    if (decl.type === "ClassDeclaration") {
      const cid = decl.id as { name?: string } | undefined;
      const dot = fnName.indexOf(".");
      if (!cid?.name || dot < 0) continue;
      if (fnName.slice(0, dot) !== cid.name) continue;
      const meth = fnName.slice(dot + 1);
      const members = ((decl.body as { body?: unknown[] } | undefined)?.body ??
        []) as AstNode[];
      for (const m of members) {
        const key = m.key as { type?: string; name?: string } | undefined;
        if (key?.type === "Identifier" && key.name === meth) {
          const p = paramsOfFnNode(m);
          if (p) return { fn: m, stmt: s };
        }
      }
    }
  }
  return undefined;
}

/** 按名字找被调函数的形参节点（顶层声明扫描）——`findFnDecl` 的薄封装 */
function findFnParams(
  fileAst: ReturnType<typeof parse> | undefined,
  fnName: string,
): unknown[] | undefined {
  const found = findFnDecl(fileAst, fnName);
  if (!found) return undefined;
  return paramsOfFnNode(found.fn);
}

/**
 * 被调方的**可省略形参名**集合（Bug 1108）。
 *
 * 两种来源：
 * - JSDoc `@param {T} [x]`（方括号 = 可选）——JSDoc 挂在 **export 包装**上
 *   时看 `stmt`，挂在函数节点上时看 `fn` ⇒ 两侧都扫；
 * - TS `x?: T`（从**源码文本**判定：类型擦除阶段已把 AST 的 `optional`
 *   标志删掉）。
 */
export function optionalParamNames(
  fnName: string,
  source: string,
  fileAst?: ReturnType<typeof parse>,
): Set<string> {
  const decl = findFnDecl(fileAst, fnName);
  if (!decl) return new Set();
  const out = jsDocOptionalParams([decl.stmt, decl.fn]);
  for (const n of tsOptionalParams(paramsOfFnNode(decl.fn), source)) out.add(n);
  return out;
}

/** 标量字面量节点 → Abs（数值 / 一元负号 / 字符串 / 布尔 / null）；非标量 → undefined */
function scalarLiteralAbs(node: AstNode): Abs | undefined {
  if (node.type === "NumericLiteral" && typeof node.value === "number") {
    return numLit(node.value);
  }
  if (
    node.type === "UnaryExpression" &&
    (node as { operator?: string }).operator === "-" &&
    (node as { argument?: AstNode }).argument?.type === "NumericLiteral"
  ) {
    const num = (node as { argument: { value: number } }).argument;
    return numLit(-num.value);
  }
  if (node.type === "StringLiteral" && typeof node.value === "string") {
    return {
      shape: { k: "prim", type: "string" },
      term: { op: "lit", value: node.value },
      conf: "exact",
    };
  }
  if (node.type === "BooleanLiteral" && typeof node.value === "boolean") {
    return boolLitAbs(node.value);
  }
  if (node.type === "NullLiteral") return absLit(null);
  return undefined;
}

/**
 * Bug 444：零实参调用的**默认值实参**（按形参位对齐）。
 *
 * 形参有默认值（`f(x = -5)`）而调用点**不传实参**时，运行时该位取默认值 ⇒
 * 默认值本身违反形参契约 ⇒ **实现必违约**。此前零实参调用整条跳过执法
 * （`absArgs.length === 0` 早退）⇒ 引擎自己算出了 `-5` 却不对账（假绿）。
 *
 * 返回值下标 = **形参位**（与 `formalParamsFromNodes` 的 index 同序：
 * TS 接收者标注 `this: T` 不占位——Bug 397；rest 形参恒在末位 ⇒ 截断，
 * 不进数组）。**取不到任何默认值 ⇒ 返回空表**（调用方保持修复前行为）。
 * 未取到默认值的位补 `absUnknown()` 占位（无信息 ⇒ 不发明义务）。
 *
 * Bug 1110 / 1111：`defaulted` 标出**哪些位真的有默认值** ——
 * - 1110：调用点**显式传 `undefined`** ⇒ 运行时走默认值 ⇒ 该位应按默认值执法
 *   （此前按 `undefined` 执法 ⇒ 报「实参 undefined」假红）。
 * - 1111：调用点**漏传尾部位置** ⇒ 运行时走默认值 ⇒ 缺失的**所有尾部位置**
 *   都要补默认值（此前只在**零实参**时补 ⇒ `e4(1)` 静默 = 假绿）。
 */
export function defaultArgAbss(
  fnName: string,
  source: string,
  fileAst?: ReturnType<typeof parse>,
  lookupVar?: (name: string) => Abs | undefined,
): { values: Abs[]; defaulted: Set<number> } {
  const file = fileAst ?? parse(source);
  const params = findFnParams(file, fnName);
  if (!params || params.length === 0) return { values: [], defaulted: new Set() };
  const out: Abs[] = [];
  const defaulted = new Set<number>();
  let anyDefault = false;
  let index = 0;
  for (const p of params) {
    const node = p as AstNode | undefined;
    if (!node) continue;
    // TS 接收者标注 `this: T` 不是运行时形参（Bug 397）⇒ 不占形参位
    if (node.type === "Identifier" && node.name === "this") continue;
    // rest 形参恒在末位 ⇒ 截断（rest 位不吃默认值）
    if (node.type === "RestElement") break;
    const i = index++;
    if (node.type !== "AssignmentPattern") continue;
    // **只认简单默认值**（`f(x = -5)`，left 是 Identifier）。解构模式的默认值
    // （`f({ port = 3000 } = {})`）的 right 是**整个模式的对象**（`{}`），
    // 里面**不含**内层默认值 3000 ⇒ 拿它去过契约 ⇒ 误报「缺字段 port」。
    // ⇒ 解构默认值**不填**（fail-closed：保持修复前行为，不发明违例）。
    const left = node.left as AstNode | undefined;
    if (left?.type !== "Identifier") continue;
    const right = node.right as AstNode | undefined;
    if (!right) continue;
    const abs = scalarLiteralAbs(right) ?? evalArgAbs(right, lookupVar);
    if (!abs) continue;
    out[i] = abs;
    defaulted.add(i);
    anyDefault = true;
  }
  if (!anyDefault) return { values: [], defaulted: new Set() };
  for (let i = 0; i < index; i++) {
    if (!out[i]) out[i] = absUnknown();
  }
  return { values: out, defaulted };
}
