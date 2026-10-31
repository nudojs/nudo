/**
 * 内部模块：字面量调用点扫描的**结构执法层**（core algebra / scan）。
 *
 * 职责：把「契约（RefineEntry / NudoConstraint）× 实参 Abs」裁决成
 * `nudo:constraint-violated` 诊断（形参位 + 字段位 + 元素位）。
 * 本模块是族 11 拆出的三个内部模块之一，**只在 core 包内被
 * `scan-literal-calls.ts` 相对 import**——**不新增任何 core 公开导出**。
 *
 * ── S0 共享契约（下游 S1 / S2 消费；改动前先读本段）────────────────────────
 *
 * **契约① 共享 ctx 对象**：`LiteralScanCtx` 定义在 **`scan/literal-args.ts`**
 * （本模块只用它的 `out` 字段——诊断输出缓冲）。字段固定为：
 *   - `out` / `knownFns` / `opts` / `source` / `file` / `varAbs` / `resolve`
 *   （语义见 `literal-args.ts` 文件头）。
 *
 * **契约② 零新增 core 导出**：本目录（`algebra/scan/`）下的模块**只被
 * `scan-literal-calls.ts` 相对 import**（例外：共享叶子
 * `scan/path-projection.ts` 同时被 `algebra/check-case-scan.ts` import——
 * 只共享路径投影本身，不引入扫描编排依赖），不得从 `algebra/index.ts` /
 * `src/index.ts` / `internal.ts` 再导出。
 *
 * **契约③ `parseCallArgs` 快路径分派表（定型；Bug 430 的修法在此）**：
 *   实现在 `scan/literal-args.ts`（本模块不消费实参抽取，只消费 `absArgs`）。
 *
 * **契约④ `derefConstraint` 相对 import 通路（供 S2 的 Bug 439 用）**：
 *   本文件底部有 `export { derefConstraint } from "../constraint.ts";`
 *   —— 该 re-export 同时**证明** `algebra/scan/literal-shapes.ts` →
 *   `algebra/constraint.ts` 的同包相对依赖边成立（类型已核对），
 *   S2 可直接 `import { derefConstraint } from "../constraint.ts";`
 *   （同一条依赖边）或从本模块 re-export 处取。
 *
 * **契约⑤ 零实参早退落点**：两处 `absArgs.length === 0` 早退在**薄壳**
 * `scan-literal-calls.ts` 的 `checkOneCall` / `checkExternalCall`；
 * 本模块只负责「拿到 `absArgs` 之后怎么判」。
 *
 * ── S2 落地注记（族 11 片 S2：433 / 436 / 439 / 914 / 1021）────────────────
 * 本文件承载五处修复（逐处有 `Bug NNN` 注释）：
 *   - 433：`checkShapeReqs` 的 **union 成员分支**（`checkUnionMembers`）——
 *     union 成员的结构义务在契约实例化时丢失 ⇒ 消费侧补成员分支（析取语义）
 *   - 436：缺字段诊断**收敛到 `checkReqs` 一处**（两条通道不再各报一份）
 *   - 439：`derefDeep`（lazy 包装解引用）——闸门前先 deref 再判结构义务
 *   - 914：`checkFieldConstraint` 的 prim 门 / 数值界门（nullish 显式判违例）
 *   - 1021：`checkShapeAgainstAbs` 的排除条件（无 term 的 unknown/any/never 才跳过）
 *
 * ── S6 落地注记（族 11 片 S6：429 假红那一半 / 431+1020 非标量那一半 /
 *                 or 聚合臂 unknown 语义收紧）────────────────────────────
 * 本文件承载三处修复（逐处有 `S6` 注释）：
 *   - 429（假红那一半）：「确定 undefined」早退臂**不再**对 `or` 无条件报违例
 *     —— 析取契约改为**逐支求值**（任一支真即过）⇒ `unionFn(null)` /
 *     `nullableFn(null)` / `numOrNullFn(null)` 不再报假红
 *   - 431 / 1020（非标量那一半）：`eq` / `or` 两个分支**不再**被 `lv` 值类型门
 *     挡在门外 ⇒ 对象 / 数组 / bigint 实参对 `lit(...)` 契约（**确定违例**）
 *     不再零义务
 *   - 任务③：`or` 聚合臂的 `unknown` 语义收紧为「**全部成员都判不了**才算
 *     不可判定」⇒ 有一个成员判为 false 就报违例
 *
 * ── 1157 落地注记（非标量字面量实参；两处 brand 拆壳）────────────────────
 * 抽取层（`literal-args.ts` 的 `parseCallArgs`）把函数/箭头/类表达式、内建 `new`、
 * 正则、模板、`Symbol(...)`、`NaN` / `Infinity`、`void` 从 `unknown` 变成**确定
 * Abs** 之后，本模块补两处，让「顶层执行态回退」与「函数体静态扫描」同口径：
 *   - `typeof` 通道（`argTypeofName`）：`brand` 拆壳 —— `new Date(0)` / `/re/` /
 *     `new Map()`（brand obj）此前落 `actualPrim === undefined` ⇒ 裸 prim 契约
 *     （`positive` / `number()` / `string()`）**零义务**，而 union 面的
 *     `typeofNameOf` 会拆 ⇒ 同一个实参两种裁决
 *   - `checkShapeAgainstAbs`：`brand` 拆壳 —— brand 的内层是对象，`shape({})`
 *     （= 任意对象）不再把它误报成「object shape at x」；带必填字段的 shape
 *     仍按内层槽判 missing field
 *
 * ── 本模块的公开（内部模块级）签名 ────────────────────────────────────────
 *   - `projectAbsPath(arg: Abs, segments: readonly string[]): Abs | undefined`
 *     （共享叶子 `scan/path-projection.ts`；与 `check-case-scan.ts` 同源）
 *   - `checkReqs(ctx, displayName, reqs, paramNames, absArgs, argIndexOf, loc?)`
 *   - `checkShapeAgainstAbs(ctx, displayName, paramName, constraint, absArg, path, loc?)`
 *   - `checkFieldConstraint(ctx, displayName, paramName, constraint, fieldAbs, fieldPath, loc?, actualOf?)`
 *   - `checkShapeReqs(ctx, displayName, reqs, paramNames, absArgs, argIndexOf, loc?)`
 */

import { litValue } from "../abs.ts";
import type { Abs } from "../abs.ts";
import { getSlot } from "../objects.ts";
import { mayBeUndefinedAbs, nonUndefinedAbsValues } from "../leq.ts";
import { projectAbsPath } from "./path-projection.ts";
import {
  derefConstraint,
  isIntFlag,
  LAZY_TEMPLATE_DEPTH,
  type NudoConstraint,
  type NudoField,
} from "../constraint.ts";
import { formatConstraint } from "../interface.ts";
import { literalMeetsConstraint } from "../domain-membership.ts";
import type { CheckIssue } from "../check-report.ts";
import type { RefineEntry } from "../refine.ts";
import type { Pred } from "../pred.ts";
import { predToString } from "../pred.ts";
import { formatAbs } from "../format.ts";
import { DIAG } from "../diag-codes.ts";
import { arrayLengthOf, restArgAbs, type LiteralScanCtx } from "./literal-args.ts";
import {
  isNullishLitAbs,
  judgeLiteralPred,
  nullishKindOf,
  predEqLiteral,
  predEqNullish,
} from "./literal-preds.ts";

/**
 * Bug 439（S2 用）：结构义务闸门要**先 deref `lazy` 包装**再判
 * `fields/element/int/prim` —— `lazy(() => shape(...))` 的包装自身四项全空，
 * 不 deref 就被闸门 `continue` 掉 ⇒ 整个结构义务被静默丢弃（假绿）。
 *
 * 这里只把**同包相对 import 通路**打通（re-export），不改闸门行为
 * （S2 在本文件内消费）。
 */
export { derefConstraint } from "../constraint.ts";

/**
 * lazy 包装解引用（Bug 439）。
 *
 * `derefConstraint` 只解**一层**；自引用模板（issue #120）会一层套一层 ⇒
 * 这里按 `LAZY_TEMPLATE_DEPTH` 预算递归解到「不再是 lazy 包装」为止。
 * `derefConstraint` 按 thunk 记忆化 ⇒ 重复解引用返回同一对象（幂等）。
 */
function derefDeep(c: NudoConstraint): NudoConstraint {
  let cur = c;
  for (let i = 0; i < LAZY_TEMPLATE_DEPTH && cur.lazy; i++) {
    cur = derefConstraint(cur);
  }
  return cur;
}

/**
 * 实参的**形态档**（union 成员判定用；Bug 433）。
 *
 * - `shape`  ：对象（`shape.k === "obj"`）
 * - `array`  ：数组 / 元组
 * - `scalar` ：原语值（number / string / boolean）
 * - `nullish`：`null` / `undefined`（`shape.k === "unknown"` **且有 term**）
 * - `opaque` ：无信息（unknown / any / never）⇒ 不猜
 */
type ArgForm = "shape" | "array" | "scalar" | "nullish" | "opaque";

function argFormOf(a: Abs): ArgForm {
  const sh = a.shape;
  const s = sh.k === "brand" ? sh.shape.shape : sh;
  if (s.k === "obj") return "shape";
  if (s.k === "arr" || s.k === "tuple") return "array";
  if (s.k === "prim") return "scalar";
  if (s.k === "unknown" || s.k === "any" || s.k === "never") {
    return nullishKindOf(a) !== undefined ? "nullish" : "opaque";
  }
  return "opaque";
}

/**
 * union **成员**的形态档（Bug 433）。
 *
 * - `shape`  ：带 `fields`（`shape({...})`）
 * - `array`  ：带 `element`（`array(...)`）
 * - `scalar` ：带 `prim` 或 `preds`（`number()` / `lit(1)` / `number().gt(0)`）
 * - `any`    ：四者皆空（`any()`）⇒ 接受一切
 */
type MemberForm = "shape" | "array" | "scalar" | "any";

function memberFormOf(m: NudoConstraint): MemberForm {
  if (m.fields) return "shape";
  if (m.element) return "array";
  if (m.prim !== undefined || m.preds.length > 0) return "scalar";
  return "any";
}

/** and 谓词展平（`and` 递归展开；`true` 恒真丢弃） */
function flattenPred(p: Pred): Pred[] {
  return p.op === "and" ? p.args.flatMap(flattenPred) : p.op === "true" ? [] : [p];
}

/**
 * 实参的**形态类型档**（族 11 片 S6 任务②：非标量实参的类型级判定）。
 *
 * - `"number"` / `"string"` / `"boolean"` / `"bigint"` / `"symbol"`：prim 形状
 * - `"object"`：对象 / 数组 / 元组
 * - `"function"`：函数
 * - `undefined`：**无确定形态**（unknown / any / never / 无 term 的 nullish）
 *   ⇒ 不可判定（不猜）
 *
 * brand 拆壳取内层（品牌值的形态仍是其内层类型）。
 */
function argScalarKind(arg: Abs): string | undefined {
  const sh = arg.shape;
  const s = sh.k === "brand" ? sh.shape.shape : sh;
  if (s.k === "prim") return s.type;
  if (s.k === "obj" || s.k === "arr" || s.k === "tuple") return "object";
  if (s.k === "fn") return "function";
  return undefined;
}

/**
 * 实参的 JS `typeof` 名（`typeof` 通道用；brand 拆壳）。
 *
 * Bug 1157：`brand` 包装（`new Date(0)` / `/re/` / `new Map()` / boxed prim …）
 * 此前在本通道直接落 `undefined` ⇒ 裸 prim 契约（`number()` / `string()` /
 * `positive`）对 brand 实参**零义务**（假绿）；而同一条 `typeof` 判据在
 * `literal-preds.ts` 的 `typeofNameOf`（union 面）**会**拆 brand ⇒ 同一个
 * 实参、同一个 `typeof` 原子，两条通道两种裁决（引擎内第 2 套 typeof 口径）。
 * `argScalarKind` 已拆 brand ⇒ 这里与它同口径。
 *
 * nullish 回落 "undefined" 是**本通道原有语义**（`isNullishLitAbs` 把 null 与
 * undefined 合成一档；`lit(null)` 的字面量域由 eq 通道另行分档）。
 */
function argTypeofName(arg: Abs): string | undefined {
  const sh = arg.shape;
  if (sh.k === "brand") return argTypeofName(sh.shape);
  if (sh.k === "prim") return sh.type;
  if (sh.k === "obj" || sh.k === "arr" || sh.k === "tuple") return "object";
  if (sh.k === "fn") return "function";
  return isNullishLitAbs(arg) ? "undefined" : undefined;
}

/**
 * 谓词原子是否挂在**参数自身**（var 项）上。
 *
 * 结构成员（shape / array）实例化出来的原子挂在**字段 / 元素**上
 * （`get(x, k)` / `length(x)` 之类的非 var 项）⇒ 据此识别「union 含结构成员」。
 * `true` / `false` / `not` 等恒真恒假形态不算「挂在自身」。
 */
function predOnVar(p: Pred): boolean {
  switch (p.op) {
    case "eq":
    case "ne":
      return p.a.op === "var" || p.b.op === "var";
    case "typeof":
      return p.t.op === "var";
    case "gt":
    case "ge":
    case "lt":
    case "le":
      return p.a.op === "var";
    case "and":
    case "or":
      return p.args.every(predOnVar);
    default:
      return false;
  }
}

/**
 * `or` 的**全部**成员是否都挂在参数自身上（= union **不含**结构成员）。
 *
 * union 含结构成员时，结构通道（`checkUnionMembers`）要能接管（析取语义：
 * 任一成员满足即放行）⇒ 谓词通道的类型级兜底必须让位，否则结构面与谓词面
 * 双报（Bug 433 的让位闸）。
 */
function orMembersOnVar(or: { op: "or"; args: Pred[] }): boolean {
  return or.args.every(predOnVar);
}

/**
 * `or` 成员的三值判定（族 11 片 S6 任务② + ③）。
 *
 * - `judgeLiteralPred`（S1）判得 true / false ⇒ 直接采信；
 * - 判不了（undefined）⇒ **类型级**兜底（仅当 `typeLevel` 开启）：成员是
 *   挂在参数自身的 `eq(var, lit)` 原子、且实参形态**确定**与该字面量端
 *   类型不同 ⇒ **确定违例**（false）；形态不可判定或类型相同 ⇒ 仍 undefined
 *   （不猜）。
 */
function judgeOrMember(
  q: Pred,
  arg: Abs,
  argLen: number | undefined,
  typeLevel: boolean,
): boolean | undefined {
  const r = judgeLiteralPred(q, arg, argLen);
  if (r !== undefined) return r;
  if (!typeLevel) return undefined;
  const v = predEqLiteral(q);
  if (v === undefined) return undefined;
  const actual = argScalarKind(arg);
  if (actual === undefined) return undefined;
  return actual === typeof v ? undefined : false;
}

/**
 * 实参的**域类型**（`or` 成员的域兼容性判定用）。
 *
 * 与 `argScalarKind` 的差别：**区分 null / undefined 两个域**（nullish 实参的
 * shape 是 `unknown` ⇒ `argScalarKind` 判不出 ⇒ 会把「nullish 实参撞数值界」
 * 误当成未决）。null 与 undefined 是两个互不相等的域（Bug 429 负控制钉住）。
 */
function argDomainKind(arg: Abs): string | undefined {
  const nk = nullishKindOf(arg);
  if (nk !== undefined) return nk;
  return argScalarKind(arg);
}

/**
 * `or` 成员的**域类型**（该成员能容纳哪一类标量）——`undefined` = 判不出。
 *
 * Bug 1109：`union(number().gt(0), lit("a"))` 的成员实例化出来是
 * `gt(x, 0)` 与 `eq(x, "a")`（`instantiateOnTerm` 对「prim + preds」**不带**
 * typeof 原子）。对**非字面量 number** 实参：`gt` 不可判定（值未知）、
 * `eq(x,"a")` 按类型为假 ⇒ 旧聚合规则「有 false ⇒ 违例」⇒ 报
 * `(x > 0 ∨ x = "a")` ⇒ **假红**（实参完全可能满足 `x > 0` 那支）。
 *
 * 修法（与域面 `domain-membership.ts` 同口径）：把成员分成三类 ——
 * - **true**：放行（析取满足）；
 * - **确定假**：判得假，**或**域类型与实参形态**不兼容**（类型级确定违例）；
 * - **未决**：判不了，**且**域类型与实参形态兼容（或域类型判不出）。
 *
 * 只有**全部成员都确定假**才报违例；存在未决成员 ⇒ 整条 union 保持未决
 * （fail-closed：不猜 ⇒ 不报）。
 */
function memberDomainKind(q: Pred): string | undefined {
  switch (q.op) {
    case "eq": {
      const v = predEqLiteral(q);
      if (v !== undefined) return typeof v;
      const nv = predEqNullish(q);
      if (nv !== undefined) return nv.value === null ? "null" : "undefined";
      return undefined;
    }
    case "typeof":
      return q.t.op === "var" ? q.type : undefined;
    case "gt":
    case "ge":
    case "lt":
    case "le":
      // 挂在参数自身的数值界 ⇒ 域是 number（length 界挂在 `length(x)` 上 ⇒ 判不出）
      return q.a.op === "var" && q.b.op === "lit" && typeof q.b.value === "number"
        ? "number"
        : undefined;
    case "and": {
      for (const a of q.args) {
        const k = memberDomainKind(a);
        if (k !== undefined) return k;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/**
 * `or`（union / nullable 契约）的**三值聚合**（Bug 1109 修法）。
 *
 * - `true`：任一支为真 ⇒ 放行（析取满足）。
 * - `false`：**全部**成员都确定假 ⇒ 违例。
 * - `undefined`：存在未决成员 ⇒ 整条未决 ⇒ 跳过（不猜）。
 */
function judgeOrUnion(
  or: { op: "or"; args: Pred[] },
  arg: Abs,
  argLen: number | undefined,
): boolean | undefined {
  const typeLevel = orMembersOnVar(or);
  let hasFalse = false;
  let undecided = false;
  for (const q of or.args) {
    const r = judgeOrMember(q, arg, argLen, typeLevel);
    if (r === true) return true;
    if (r === false) {
      hasFalse = true;
      continue;
    }
    // 判不了 ⇒ 类型级再看**域类型**：域与实参形态不兼容 ⇒ 确定假；
    // 兼容（或判不出）⇒ 未决 ⇒ 整条 union 保持未决。
    if (typeLevel) {
      const kind = argDomainKind(arg);
      const dom = memberDomainKind(q);
      if (kind !== undefined && dom !== undefined && dom !== kind) {
        hasFalse = true;
        continue;
      }
    }
    undecided = true;
  }
  if (undecided) return undefined;
  return hasFalse ? false : undefined;
}

/**
 * 形参位的谓词执法：逐条 Pred 裁决实参是否满足。
 *
 * 通道顺序（**顺序敏感**，勿调换）：
 *   ① `typeof`（原语类型） ② `eq` + nullish 字面量域（Bug 965）
 *   ③ 确定 undefined（**不含 `or`**：析取契约逐支求值，见 `or` 聚合臂）
 *   ④ length 界 ⑤ `or` 聚合臂（union / nullable；逐支求值 + 三值聚合）
 *   ⑥ `eq` 字面量域（lit(...)；精确字面量比 / 类型级兜底） ⑦ 普通数值界
 */
export function checkReqs(
  ctx: LiteralScanCtx,
  displayName: string,
  reqs: Array<
    [
      number,
      Pred,
      string[] | undefined,
      string | undefined,
      boolean | undefined,
    ]
  >,
  paramNames: string[],
  absArgs: Abs[],
  /** target 参下标 → 实参下标；缺省恒等 */
  argIndexOf: (reqIdx: number) => number | undefined,
  loc?: { start: { line: number; column: number } },
  /**
   * Bug 1114：**结构通道已报「实参不是 object」**的形参下标 ⇒ 该实参位的谓词
   * 通道让位（否则同一条违例被报两次：「object shape at x」+「x.id > 0」）。
   */
  skipParams?: ReadonlySet<number>,
): void {
  const out = ctx.out;
  for (const [idx, pred, fieldPath, contractParam, rest] of reqs) {
    if (skipParams?.has(idx)) continue;
    const argIdx = argIndexOf(idx);
    if (argIdx === undefined) continue;
    let arg = absArgs[argIdx];
    if (!arg) continue;
    // Bug 400：rest 形参 → 值 = 该位之后**全部实参**聚成的数组（不是第 i 个）
    if (rest) arg = restArgAbs(absArgs.slice(argIdx));
    // C4.1：解构契约展示名优先用契约面（x），不回落到求值占位 _p0
    const paramName = contractParam || paramNames[idx] || `arg${idx}`;
    // C4.1：解构契约字段投影后再判 pred；缺字段不能静默跳过（FN）
    // #137：投影走路径（嵌套 'card.grade' 逐段下钻），展示用点连接串
    if (fieldPath) {
      const projected = projectAbsPath(arg, fieldPath);
      if (!projected) {
        const k = arg.shape.k;
        // unknown/any 无法证明缺字段；其余已知形态（含 obj 缺槽）→ 违例
        if (k !== "unknown" && k !== "any") {
          const field = fieldPath.join(".");
          out.push({
            severity: "error",
            code: DIAG.constraintViolated,
            message: `${displayName}[${paramName}]: argument ⊭ precondition`,
            actual: formatAbs(arg),
            expected: `missing field ${field}`,
            suggestion: `add the missing field ${field}`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
        continue;
      }
      arg = projected;
    }
    const lvR = litValue(arg);
    const lv = lvR.ok ? lvR.value : undefined;
    const isStr = arg.shape.k === "prim" && (arg.shape as { type: string }).type === "string";
    // length 通道：字符串取字面量长度；**数组**取元素个数（Bug 922：
    // `array(number()).min(3)` 的长度界此前只在字符串上求值 ⇒ 数组实参的
    // 长度界整条被跳过 ⇒ 门禁假绿）。
    const argLen = typeof lv === "string" ? lv.length : arrayLengthOf(arg);
    // 确定 undefined：不进 positive/nonEmpty 等 typed 域（any 仍放行）
    const argIsUndef = isNullishLitAbs(arg);
    const flat = flattenPred(pred);
    // 本条 req 的谓词里是否有**挂在参数自身**的 typeof 原子（`lit(1)` 的 prim
    // 门会实例化出 `typeof(x,"number")`）⇒ 类型不匹配由 typeof 通道独家报 ⇒
    // eq 通道的类型级兜底必须让位（否则同一条违例报两次）。
    const hasVarTypeof = flat.some((q) => q.op === "typeof" && q.t.op === "var");
    // Bug 1114：同一实参位上 **typeof 通道已报** ⇒ **数值界**通道让位
    // （类型都不对时「x > 0」这类界判据对实参没有意义 ⇒ 同一条违例报两次：
    // `number().gt(0)` 收到 boolean ⇒ 「typeof x = "number"」+「x > 0」）。
    // 让位只压**同一实参位**的其它通道，不影响别的形参位。
    // ⚠ **eq（值义务）通道不让位**（族 48 口径：类型义务与值义务是两条独立
    // 义务 ⇒ 既有门禁 core-bug-1020 / eval-bug-1046 钉住条数 2）。
    let typeofReported = false;
    for (const p of flat) {
      // typeof 约束（string() / number() / boolean() 裸 prim）
      // 只检查挂在参数自身上的 typeof；字段访问（u.name）交给 shape 路径
      if (p.op === "typeof") {
        if (p.t.op !== "var") continue;
        const expected = p.type;
        // Bug 1157：brand 拆壳（`new Date(0)` / `/re/` / `new Map()` …）——
        // 此前 brand 落 `undefined` ⇒ 裸 prim 契约对 brand 实参零义务。
        const actualPrim = argTypeofName(arg);
        // 只在有确定 prim 信息且不匹配时拦截；unknown/any 不猜
        if (actualPrim !== undefined && actualPrim !== expected) {
          typeofReported = true;
          out.push({
            severity: "error",
            code: DIAG.constraintViolated,
            message: `${displayName}[${paramName}]: argument ⊭ precondition`,
            actual: formatAbs(arg),
            expected: `typeof ${paramName} = "${expected}"`,
            suggestion: `use a value of type ${expected}, or relax the refine on ${paramName}`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
        continue;
      }
      // Bug 1114：**数值界**通道在 typeof 通道已报时让位 —— 类型都不对时，
      // 「x > 0」这类界判据对实参**没有意义**（布尔 / 字符串不可能 > 0）
      // ⇒ 与「typeof x = "number"」是同一条违例的两种说法 ⇒ 只报一次。
      //
      // ⚠ **eq（值义务）通道不让位**：契约「`typeof x = "bigint" ∧ x = 1n`」是
      // **两条独立义务**，类型不符**与**值不符是**两个事实**（族 48 · 主 agent
      // 追认 2026-10-23：bigint 字面量契约补齐 typeof 义务 ⇒ 类型不符时**多报
      // 一条**「类型义务」诊断）⇒ 既有门禁 core-bug-1020 /
      // eval-bug-1046 钉住条数（2 条）⇒ 这里只让位**界**通道。
      // nullish 字面量域（lit(null) / lit(undefined)）：值域只有那**一个**
      // nullish 值（Bug 965）。此前 eq 通道只认 number/string/boolean ⇒
      // lit(null) / lit(undefined) 契约整条不执法（假绿：f(2) 被放行），
      // 而 dts / zod / standard 三面都把这条契约当真 ⇒ 四面互相矛盾。
      // 排在「确定 undefined」分支**之前**：null 与 undefined 是两个域，
      // 实参恰为该 nullish 值时**满足**契约（不该报违例）。
      if (p.op === "eq") {
        const nv = predEqNullish(p);
        if (nv !== undefined) {
          const want = nv.value === null ? "null" : "undefined";
          if (nullishKindOf(arg) !== want) {
            out.push({
              severity: "error",
              code: DIAG.constraintViolated,
              message: `${displayName}[${paramName}]: argument ⊭ precondition`,
              actual: formatAbs(arg),
              expected: predToString(p),
              suggestion: `use a value satisfying ${predToString(p)}, or relax the precondition on ${paramName}`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
          continue;
        }
      }
      // 确定 undefined 对数值界 / eq 同样不满足（undefined ⊭ positive）
      //
      // ⚠ **`or` 不在此无条件报违例**（Bug 429 假红那一半；族 11 片 S6）：
      // 析取契约（`union(...)` / `nullable(...)`）必须**逐支求值**——任一支真
      // 即过。`union(number().gt(0), lit(null))` 收到 `null` 是**合法**的
      // （`lit(null)` 支为真）⇒ 此前 `or` 无条件报违例 ⇒ 合法实参报假红
      // （`unionFn(null)` / `nullableFn(null)` / `numOrNullFn(null)` 各 1 条）。
      // ⇒ `or` 落到下面的 **`or` 聚合臂**（逐支求值 + 三值聚合）。
      if (argIsUndef && p.op !== "or") {
        if (
          p.op === "gt" ||
          p.op === "ge" ||
          p.op === "lt" ||
          p.op === "le" ||
          p.op === "eq"
        ) {
          // Bug 1114：数值界在 typeof 通道已报时让位（见上：类型都不对时界判据
          // 没有意义 ⇒ 同一条违例只报一次）；eq（值义务）仍报（族 48 口径）。
          if (
            typeofReported &&
            (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le")
          )
            continue;
          out.push({
            severity: "error",
            code: DIAG.constraintViolated,
            message: `${displayName}[${paramName}]: argument ⊭ precondition`,
            actual: formatAbs(arg),
            expected: predToString(p),
            suggestion: `use a value satisfying ${predToString(p)}, or relax the precondition on ${paramName}`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
        continue;
      }
      // length 界通道（string().min/max 与 array(...).min/max）：只看长度，
      // 与标量字面量无关 ⇒ 必须排在「lv 不可判定」的短路**之前**（数组实参
      // 没有标量字面量，但长度可判——Bug 922）。
      if (
        (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") &&
        p.b.op === "lit" &&
        typeof p.b.value === "number" &&
        p.a.op === "app" &&
        p.a.fn === "length" &&
        argLen !== undefined
      ) {
        const n = p.b.value;
        const opSym = { gt: ">", ge: "≥", lt: "<", le: "≤" }[p.op];
        let ok = true;
        if (p.op === "gt") ok = argLen > n;
        if (p.op === "ge") ok = argLen >= n;
        if (p.op === "lt") ok = argLen < n;
        if (p.op === "le") ok = argLen <= n;
        if (!ok) {
          out.push({
            severity: "error",
            code: DIAG.constraintViolated,
            message: `${displayName}[${paramName}]: argument ⊭ precondition`,
            actual: formatAbs(arg),
            expected: `length(${paramName}) ${opSym} ${n}`,
            suggestion: `use a value whose length is ${opSym} ${n}, or relax the precondition on ${paramName}`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
        continue;
      }
      // ── `or` 聚合臂（union / nullable 契约）────────────────────────────
      // 放在 `lv` 值类型门**之前**：析取契约的成员实例化出来的是 `typeof`
      // 原子（`union(number(), string())`）或 nullish 字面量端（`lit(null)`），
      // 实参**不一定是标量字面量**——此前 `lv` 门把对象 / 数组 / bigint /
      // nullish 实参整条挡在门外 ⇒ 那些实参对 union 契约**零义务**
      // （假绿：Bug 431 的非标量那一半）。
      //
      // 逐支求值 + **三值聚合**（族 11 片 S6 任务③ + Bug 1109 修法）：
      //   - 任一支 true     ⇒ 放行（析取满足）
      //   - **全部**支确定假 ⇒ 违例（确定违例的成员 + 域类型与实参形态不兼容
      //                        的成员；「有 false 就报」会把**不可判定但域兼容**
      //                        的成员误判成违例 ⇒ 假红）
      //   - 存在未决成员     ⇒ 不可判定 ⇒ 跳过（不猜）
      if (p.op === "or") {
        const verdict = judgeOrUnion(p, arg, argLen);
        if (verdict === false) {
          out.push({
            severity: "error",
            code: DIAG.constraintViolated,
            message: `${displayName}[${paramName}]: argument ⊭ precondition`,
            actual: formatAbs(arg),
            expected: predToString(p),
            suggestion: `use a value satisfying ${predToString(p)}, or relax the precondition on ${paramName}`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
        continue;
      }
      // ── `eq` 字面量域（lit(...) 契约）────────────────────────────────
      // ⚠ 值类型门（族 11 片 S6 任务② / Bug 1020 的非标量那一半）：此前 `lv`
      // 门只放 number/string/boolean ⇒ 对象 / 数组 / bigint 实参整条被跳过
      // （**假绿**：这些实参对 `lit(...)` 契约是**确定违例**，不是「不知道」）。
      // 现在分三档：
      //   - 实参是**精确字面量** ⇒ 按**字面量同一性**比（`===` + NaN 特例；
      //     契约面口径，见 `scan/literal-preds.ts` 的 `sameLiteral`）；
      //   - 实参**不是**字面量但**形态确定** ⇒ **类型级**判定：形态与字面量
      //     端类型不同 ⇒ **确定违例**；类型相同 ⇒ 仍不可判定（不猜）；
      //   - 形态不可判定（unknown / any / 无 term 的 nullish）⇒ 跳过。
      //
      // ⚠ `lit(1)` / `lit("a")` / `lit(true)` 的 prim 门会实例化出
      // `typeof(x, "number")` 之类的原子 ⇒ 类型不匹配由 **typeof 通道**报 ⇒
      // eq 通道的类型级兜底必须**让位**（否则同一条违例报两次）。
      if (p.op === "eq") {
        const v = predEqLiteral(p);
        if (v !== undefined) {
          const r = judgeLiteralPred(p, arg, argLen);
          let violated = r === false;
          if (r === undefined && !hasVarTypeof) {
            const actual = argScalarKind(arg);
            violated = actual !== undefined && actual !== typeof v;
          }
          if (violated) {
            out.push({
              severity: "error",
              code: DIAG.constraintViolated,
              message: `${displayName}[${paramName}]: argument ⊭ precondition`,
              actual: formatAbs(arg),
              expected: predToString(p),
              suggestion: `use a value satisfying ${predToString(p)}, or relax the precondition on ${paramName}`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
        }
        continue;
      }
      if (lv === undefined) continue;
      if (
        (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") &&
        p.b.op === "lit" &&
        typeof p.b.value === "number"
      ) {
        const n = p.b.value;
        // length(t) 形式已在**上面的 length 通道**判完（字符串 / 数组）⇒
        // 走到这里的是普通数值界。
        //
        // BUG-211：长度谓词**只由** length 通道裁决——那里要求 `argLen` 可判
        // （字符串 `.length` / 数组元素个数）。长度不可判的实参（数字 / 布尔 …）
        // 在此处属于**不可判定**，不得落进下面的数值比较：`3 >= 1` 会造出假绿
        // （参数位放行、返回位按长度语义判违反）、`0 >= 1` 会造出假红。返回位读
        // 的是同一个谓词的长度语义 ⇒ 两通道同口径。
        if (p.a.op === "app" && p.a.fn === "length") continue;
        // boolean/null 不进数值域（includes/every/some 返回 boolean 误当收窄）
        if (typeof lv === "boolean" || lv === null) {
          // Bug 1114：typeof 通道已报（类型都不对）⇒ 数值界判据对实参**没有
          // 意义**（布尔 / null 不可能 > 0）⇒ 同一条违例只报一次。
          if (typeofReported) continue;
          out.push({
            severity: "error",
            code: DIAG.constraintViolated,
            message: `${displayName}[${paramName}]: argument ⊭ precondition`,
            actual: formatAbs(arg),
            expected: predToString(p),
            suggestion: `use a value satisfying ${predToString(p)}, or relax the precondition on ${paramName}`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
          continue;
        }
        // 普通数值界
        if (isStr || typeof lv !== "number") continue;
        let ok = true;
        if (p.op === "gt") ok = (lv as number) > n;
        if (p.op === "ge") ok = (lv as number) >= n;
        if (p.op === "lt") ok = (lv as number) < n;
        if (p.op === "le") ok = (lv as number) <= n;
        if (!ok) {
          out.push({
            severity: "error",
            code: DIAG.constraintViolated,
            message: `${displayName}[${paramName}]: argument ⊭ precondition`,
            actual: formatAbs(arg),
            expected: predToString(p),
            suggestion: `use a value satisfying ${predToString(p)}, or relax the precondition on ${paramName}`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
      }
    }
  }
}

/**
 * shape 约束：实参 object Abs 的每个字段 ⊭ 嵌套约束。
 * 缺字段 / 类型不符 / 数值界违例 → nudo:constraint-violated。
 *
 * 返回值（Bug 1114）：`true` = 报了「实参**不是 object**」这条（`object shape
 * at <path>`）⇒ 同一实参位的**谓词通道**（字段界那条）必须让位 ⇒ 否则
 * `shape({id:number().gt(0)})` 收到 `null` 会同时发「object shape at x」与
 * 「x.id > 0」两条（同一条违例报两次）。
 */
export function checkShapeAgainstAbs(
  ctx: LiteralScanCtx,
  displayName: string,
  paramName: string,
  constraint: NudoConstraint,
  absArg: Abs,
  path: string,
  loc?: { start: { line: number; column: number } },
): boolean {
  const out = ctx.out;
  // Bug 439：`lazy(() => shape(...))` 的结构信息在 thunk 里 ⇒ 先 deref
  // （包装自身 `fields` 为空 ⇒ 不 deref 就被下面的 `!constraint.fields` 丢掉）
  const c = derefDeep(constraint);
  if (!c.fields) return false;
  // Bug 1157：brand 拆壳——`new Date(0)` / `/re/` / boxed prim 的内层是**对象**
  // （`typeof` 为 "object"）。此前这里只认 `shape.k === "obj"` ⇒ 同一个
  // 「对象」实参两种裁决：字面量 `{}` 对 `shape({})` 放行，brand 对象却报
  // 「object shape at x」假红。拆壳后字段义务照查（Date 没有 `id` ⇒
  // `shape({ id: … })` 仍是 missing field）。
  const value = absArg.shape.k === "brand" ? absArg.shape.shape : absArg;
  // unknown 实参：无信息，不猜
  if (value.shape.k === "unknown" && !value.term) return false;

  const slots =
    value.shape.k === "obj"
      ? (value.shape as { slots: Record<string, { value: Abs; optional?: boolean }> }).slots
      : undefined;

  if (!slots) {
    // 有形状信息但不是 object。
    // unknown/any 实参：无信息，不猜（与标量 pred 通道「any ≤ 任意目标」
    // 同口径——check-recall-gold any-assign-to-number-ok；any 值上的
    // shape 违例不可证，报 error 是假阳性，#76 缺口 B）
    //
    // Bug 1021：排除条件必须看「**有没有信息**」而不是「`shape.k` 字面是不是
    // unknown」——`null` / `undefined` 的 Abs 正是 `shape.k === "unknown"`
    // **但有 term** ⇒ 此前被一并排除 ⇒ 顶层结构约束对 nullish 实参零义务
    // （假绿：同一实参位上 `number()` 判违例、`shape()` 静默放行 ⇒ 引擎内
    // 第 4 套「nullish 是否满足契约」口径）。⇒ 有 term 的 nullish 现在与
    // 其它「有信息但不是 object」的实参同口径判违例。
    const k = value.shape.k;
    const noInfo = k === "never" || ((k === "unknown" || k === "any") && !value.term);
    if (!noInfo) {
      out.push({
        severity: "error",
        code: DIAG.constraintViolated,
        message: `${displayName}[${paramName}]: argument ⊭ precondition`,
        actual: formatAbs(absArg),
        expected: `object shape at ${path}`,
        suggestion: `use an object satisfying the ${path} shape constraint`,
        fn: displayName,
        line: loc?.start.line,
        column: loc?.start.column,
      });
      return true;
    }
    return false;
  }

  for (const [key, field] of Object.entries(c.fields) as Array<
    [string, NudoField]
  >) {
    const slot = getSlot(slots, key);
    const fieldPath = path === paramName ? `${paramName}.${key}` : `${path}.${key}`;
    if (!slot) {
      if (!field.optional && !field.constraint.isOptional) {
        out.push({
          severity: "error",
          code: DIAG.constraintViolated,
          message: `${displayName}[${paramName}]: argument ⊭ precondition`,
          actual: formatAbs(absArg),
          expected: `missing field ${fieldPath}`,
          suggestion: `add the missing field ${fieldPath}`,
          fn: displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        });
      }
      continue;
    }
    // BUG-246：可选槽**吸收 undefined**（TS 默认
    // `exactOptionalPropertyTypes: false` ⇒ `{ a?: string }` 的槽类型是
    // `string | undefined`）⇒ `{ a: undefined }` 是合法实参。
    // 修前这里只对「**缺槽**」看可选位（上方 `if (!slot)` 的 continue），
    // 槽存在但值是 undefined 时照样进 prim 门 ⇒ 假红
    // `typeof a = "string"`（与签名面 `a?: string` 自相矛盾）。
    // 判定与 `leqAbs` 的槽规则**同口径**（共享 `mayBeUndefinedAbs` /
    // `nonUndefinedAbsValues`）：剥掉 undefined 臂后**剩余成员仍须**满足字段
    // 约束 ⇒ `{ a: string | undefined }` 按 string 判、`{ a: number | undefined }`
    // 仍判红；`null` 不被吸收（strictNullChecks）。必填字段不受影响。
    const optionalField = field.optional || field.constraint.isOptional;
    const fieldValues =
      optionalField && mayBeUndefinedAbs(slot.value)
        ? nonUndefinedAbsValues(slot.value)
        : [slot.value];
    for (const fieldValue of fieldValues) {
      checkFieldConstraint(
        ctx,
        displayName,
        paramName,
        field.constraint,
        fieldValue,
        fieldPath,
        loc,
      );
    }
  }
  return false;
}

/** 单字段：prim 类型 + 数值界 + 嵌套 shape + array 元素 + int + 长度
 *
 *  Bug 400：`actualOf` = **报告用实参**（默认 = 被检字段本身）。rest 形参
 *  的契约面是「该位之后全部实参聚成的数组」⇒ 元素违例要报**整个聚合值**
 *  （`[1, -2]`），不是那个元素（`-2`）。 */
export function checkFieldConstraint(
  ctx: LiteralScanCtx,
  displayName: string,
  paramName: string,
  constraint: NudoConstraint,
  fieldAbs: Abs,
  fieldPath: string,
  loc?: { start: { line: number; column: number } },
  actualOf?: Abs,
): void {
  const out = ctx.out;
  if (fieldAbs.shape.k === "unknown" && !fieldAbs.term) return;

  // Bug 439：`lazy(() => number())` 之类的字段约束，prim / preds 都在 thunk 里
  // ⇒ 先 deref 再判（包装自身 prim/preds 全空 ⇒ 义务被静默丢弃）
  const c = derefDeep(constraint);

  // prim 类型
  //
  // Bug 914：nullish 实参（`shape.k === "unknown"` **但有 term**）**不满足**
  // 裸 prim 契约（`number()` 不接受 null / undefined）——此前 prim 门要求
  // `shape.k === "prim"` ⇒ nullish 整条原语检查被跳过 ⇒ `{ v: null }` /
  // `[null]` 完全不被执法（假绿），而**同一条约束**在顶层标量位与返回值面
  // 都判违例 ⇒ 引擎内 3 套口径。现在与顶层标量面同口径显式判违例。
  //
  // 注：`lit(...)` 形态的成员约束自带 eq 谓词（域隶属通道负责判 nullish
  // 违例，文案是「v ∈ lit(1)」）⇒ 这里**不抢**它的诊断，保持文案不变。
  const hasEqDomain = c.preds.some((p) => p.op === "eq");
  if (c.prim) {
    const actualPrim =
      fieldAbs.shape.k === "prim" ? (fieldAbs.shape as { type: string }).type : undefined;
    if (actualPrim === undefined) {
      // 无 prim 信息：nullish（有 term）**确定**违反裸 prim 契约；
      // 其它（无 term 的 unknown / any）不可证 ⇒ 不猜。
      if (nullishKindOf(fieldAbs) !== undefined && !hasEqDomain) {
        out.push({
          severity: "error",
          code: DIAG.constraintViolated,
          message: `${displayName}[${paramName}]: argument ⊭ precondition`,
          actual: formatAbs(actualOf ?? fieldAbs),
          expected: `typeof ${fieldPath} = "${c.prim}"`,
          suggestion: `change ${fieldPath} to ${c.prim}`,
          fn: displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        });
        return;
      }
    } else if (actualPrim !== c.prim) {
      out.push({
        severity: "error",
        code: DIAG.constraintViolated,
        message: `${displayName}[${paramName}]: argument ⊭ precondition`,
        actual: formatAbs(actualOf ?? fieldAbs),
        expected: `typeof ${fieldPath} = "${c.prim}"`,
        suggestion: `change ${fieldPath} to ${c.prim}`,
        fn: displayName,
        line: loc?.start.line,
        column: loc?.start.column,
      });
      return;
    }
  }

  // int：字面量必须是整数（builder 上 .int 是方法，标志须经 isIntFlag 读）
  if (isIntFlag(c)) {
    const ivR = litValue(fieldAbs);
    const iv = ivR.ok ? ivR.value : undefined;
    if (typeof iv === "number" && !Number.isInteger(iv)) {
      out.push({
        severity: "error",
        code: DIAG.constraintViolated,
        message: `${displayName}[${paramName}]: argument ⊭ precondition`,
        actual: formatAbs(actualOf ?? fieldAbs),
        expected: `${fieldPath} is int`,
        suggestion: `change ${fieldPath} to an integer`,
        fn: displayName,
        line: loc?.start.line,
        column: loc?.start.column,
      });
    }
  }

  // 嵌套 shape
  if (c.fields) {
    checkShapeAgainstAbs(ctx, displayName, paramName, c, fieldAbs, fieldPath, loc);
  }

  // array 元素：逐元素检查
  if (c.element) {
    if (fieldAbs.shape.k === "arr") {
      checkFieldConstraint(
        ctx,
        displayName,
        paramName,
        c.element,
        (fieldAbs.shape as { element: Abs }).element,
        `${fieldPath}[]`,
        loc,
        actualOf,
      );
    } else if (fieldAbs.shape.k === "tuple") {
      const els = (fieldAbs.shape as { elements: Abs[] }).elements;
      els.forEach((el, i) => {
        checkFieldConstraint(
          ctx,
          displayName,
          paramName,
          c.element!,
          el,
          `${fieldPath}[${i}]`,
          loc,
          actualOf,
        );
      });
    }
  }

  // 数值界 + 长度界（preds 里可能含 length(t) 比较）
  const lvR = litValue(fieldAbs);
  const lv = lvR.ok ? lvR.value : undefined;
  const sv = typeof lv === "string" ? lv.length : undefined;
  const isStr = fieldAbs.shape.k === "prim" && (fieldAbs.shape as { type: string }).type === "string";
  for (const p of c.preds) {
    const flat = p.op === "and" ? p.args : [p];
    for (const atom of flat) {
      if (
        (atom.op === "gt" || atom.op === "ge" || atom.op === "lt" || atom.op === "le") &&
        atom.b.op === "lit" &&
        typeof atom.b.value === "number"
      ) {
        const n = atom.b.value;
        const opSym = { gt: ">", ge: "≥", lt: "<", le: "≤" }[atom.op];
        // length(t) 形式
        if (atom.a.op === "app" && atom.a.fn === "length") {
          if (sv === undefined) continue;
          let ok = true;
          if (atom.op === "gt") ok = sv > n;
          if (atom.op === "ge") ok = sv >= n;
          if (atom.op === "lt") ok = sv < n;
          if (atom.op === "le") ok = sv <= n;
          if (!ok) {
            out.push({
              severity: "error",
              code: DIAG.constraintViolated,
              message: `${displayName}[${paramName}]: argument ⊭ precondition`,
              actual: formatAbs(actualOf ?? fieldAbs),
              expected: `length(${fieldPath}) ${opSym} ${n}`,
              suggestion: `use a ${fieldPath} whose length is ${opSym} ${n}`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
          continue;
        }
        // 普通数值界
        //
        // Bug 914：nullish / boolean 实参**不满足**数值界（与顶层标量面
        // `checkReqs` 的界通道同口径：`typeof lv === "boolean" || lv === null`
        // ⇒ 报违例）。此前字段/元素位的界通道对 nullish 直接 `continue`
        // ⇒ `{ v: null }` / `[null]` 零诊断（假绿）。
        if (nullishKindOf(fieldAbs) !== undefined || typeof lv === "boolean") {
          out.push({
            severity: "error",
            code: DIAG.constraintViolated,
            message: `${displayName}[${paramName}]: argument ⊭ precondition`,
            actual: formatAbs(actualOf ?? fieldAbs),
            expected: `${fieldPath} ${opSym} ${n}`,
            suggestion: `use a value satisfying ${fieldPath} ${opSym} ${n}, or relax the precondition on ${paramName}`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
          continue;
        }
        if (lv === undefined || typeof lv !== "number" || isStr) continue;
        let ok = true;
        if (atom.op === "gt") ok = lv > n;
        if (atom.op === "ge") ok = lv >= n;
        if (atom.op === "lt") ok = lv < n;
        if (atom.op === "le") ok = lv <= n;
        if (!ok) {
          out.push({
            severity: "error",
            code: DIAG.constraintViolated,
            message: `${displayName}[${paramName}]: argument ⊭ precondition`,
            actual: formatAbs(actualOf ?? fieldAbs),
            expected: `${fieldPath} ${opSym} ${n}`,
            suggestion: `use a value satisfying ${fieldPath} ${opSym} ${n}, or relax the precondition on ${paramName}`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
      }
    }
  }

  // eq / union 域（lit()/union() 字段契约）：bounds 分支判不了——域隶属
  // 判定（domain-membership 语义复用）；仅 eq/union 形态触发，防双报。
  // litValue 哨兵：lit(undefined)/lit(null) 也是字面量证据，须看 term
  // 后走完整域隶属（与 leq / domain-membership 同口径）。
  //
  // Bug 915 延伸（族 11 片 S7）：本守卫此前只放行 number / string /
  // boolean / null / undefined ⇒ **bigint 字面量实参被直接跳过** ⇒
  // `shape({ v: lit(1n) })` 收到 `{ v: 2n }` 零诊断（假绿），而同一条
  // 契约在**标量实参位**（S6 修好）报违例 ⇒ 同一份契约两个位置两种裁决。
  // ⇒ 值域补上 **bigint**（只补 bigint：object / array / function 不在
  // 标量字面量域内，放进来会与 prim 通道**双报**）。
  const fieldLit = fieldAbs.term?.op === "lit" ? fieldAbs.term.value : undefined;
  const fieldIsLit = fieldAbs.term?.op === "lit";
  if (
    fieldIsLit &&
    (typeof fieldLit === "number" || typeof fieldLit === "string" || typeof fieldLit === "boolean" || typeof fieldLit === "bigint" || fieldLit === null || fieldLit === undefined) &&
    ((c.members?.length ?? 0) > 0 || c.preds.some((p) => p.op === "eq")) &&
    !literalMeetsConstraint(fieldLit, c)
  ) {
    out.push({
      severity: "error",
      code: DIAG.constraintViolated,
      message: `${displayName}[${paramName}]: argument ⊭ precondition`,
      actual: formatAbs(actualOf ?? fieldAbs),
      expected: `${fieldPath} ∈ ${formatConstraint(c)}`,
      suggestion: `use a ${fieldPath} satisfying ${formatConstraint(c)}`,
      fn: displayName,
      line: loc?.start.line,
      column: loc?.start.column,
    });
  }
}

/** 对带 shape / array / int / prim 的 refine 做结构检查 */
export function checkShapeReqs(
  ctx: LiteralScanCtx,
  displayName: string,
  reqs: Array<[number, RefineEntry, string[] | undefined, boolean | undefined]>,
  paramNames: string[],
  absArgs: Abs[],
  argIndexOf: (reqIdx: number) => number | undefined,
  loc?: { start: { line: number; column: number } },
): Set<number> {
  const out = ctx.out;
  /**
   * Bug 1114：返回「**实参不是 object**（已报 `object shape at <path>`）」的形参
   * 下标集合 ⇒ 同一实参位的**谓词通道**（字段界那条）必须让位 ⇒ 否则
   * `shape({id:number().gt(0)})` 收到 `null` 会同时发「object shape at x」与
   * 「x.id > 0」两条（同一条违例报两次）。
   */
  const notObject = new Set<number>();
  for (const [idx, entry, fieldPath, rest] of reqs) {
    // Bug 439：`lazy(() => shape(...))` 的**包装自身**四项（fields / element /
    // int / prim）全空 ⇒ 闸门若只看约束自身，整条结构义务会被 `continue`
    // 掉（假绿）。⇒ **先 deref 再判闸门**（与 `constraintAdmitsNullish` /
    // `domain-membership` 同口径）。
    // Bug 433：union 约束的结构义务在**成员**里 ⇒ 闸门也要放行 union。
    const c = derefDeep(entry.constraint);
    if (!c.fields && !c.element && !isIntFlag(c) && !c.prim && !c.members) continue;
    const argIdx = argIndexOf(idx);
    if (argIdx === undefined) continue;
    let arg = absArgs[argIdx];
    if (!arg) continue;
    // Bug 400：rest 形参 → 值 = 该位之后**全部实参**聚成的数组（不是第 i 个）
    let restAgg: Abs | undefined;
    if (rest) {
      restAgg = restArgAbs(absArgs.slice(argIdx));
      arg = restAgg;
    }
    const paramName = entry.param || paramNames[idx] || `arg${idx}`;
    // C4.1：解构契约 → 投影到字段再查；缺字段报 violation（与 checkReqs 同口径）
    // #137：投影走路径（嵌套 'card.grade' 逐段下钻），展示用点连接串
    // Bug 436：「投影失败 → missing field」**只由 checkReqs 报一次**——两条
    // 并行通道各发一份会让同一条违例被上报两次（`nudo check` 错误计数翻倍）。
    if (fieldPath) {
      const projected = projectAbsPath(arg, fieldPath);
      if (!projected) {
        // 缺字段诊断由 checkReqs 独占（同一组 reqs 两条通道都会跑）
        continue;
      }
      arg = projected;
    }
    // Bug 433：union 成员的结构义务（消费侧补 union 成员分支）
    if (c.members) {
      checkUnionMembers(ctx, displayName, paramName, c, entry.pred, arg, loc);
      continue;
    }
    // 裸 prim 已由 checkReqs 的 typeof pred 覆盖；此处只处理 shape/array/int
    // shape 字段
    if (c.fields) {
      if (checkShapeAgainstAbs(ctx, displayName, paramName, c, arg, paramName, loc)) {
        notObject.add(idx);
      }
    }
    // 顶层 array 元素
    if (c.element) {
      if (arg.shape.k === "arr") {
        checkFieldConstraint(
          ctx,
          displayName,
          paramName,
          c.element,
          (arg.shape as { element: Abs }).element,
          `${paramName}[]`,
          loc,
          restAgg,
        );
      } else if (arg.shape.k === "tuple") {
        const els = (arg.shape as { elements: Abs[] }).elements;
        els.forEach((el, i) => {
          checkFieldConstraint(
            ctx,
            displayName,
            paramName,
            c.element!,
            el,
            `${paramName}[${i}]`,
            loc,
            restAgg,
          );
        });
      } else if (
        isNullishLitAbs(arg) ||
        (arg.shape.k !== "unknown" && arg.shape.k !== "any")
      ) {
        out.push({
          severity: "error",
          code: DIAG.constraintViolated,
          message: `${displayName}[${paramName}]: argument ⊭ precondition`,
          actual: formatAbs(arg),
          expected: `array at ${paramName}`,
          suggestion: `use a value satisfying the array constraint`,
          fn: displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        });
      }
    }
    // 顶层 int（builder 上 .int 是方法，标志须经 isIntFlag 读）
    if (isIntFlag(c)) {
      const ivR = litValue(arg);
      const iv = ivR.ok ? ivR.value : undefined;
      if (typeof iv === "number" && !Number.isInteger(iv)) {
        out.push({
          severity: "error",
          code: DIAG.constraintViolated,
          message: `${displayName}[${paramName}]: argument ⊭ precondition`,
          actual: formatAbs(arg),
          expected: `${paramName} is int`,
          suggestion: `use an integer`,
          fn: displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        });
      }
    }
  }
  return notObject;
}

/**
 * union **成员**的结构义务（Bug 433）。
 *
 * 契约侧（`constraint.ts` 的 `instantiateConstraint`）把 union 成员摊成顶层
 * `or(...)` 谓词，成员的 `fields` / `element` **不会**抬到 union 约束上 ⇒
 * 消费侧若只看 union 约束自身的 `fields/element`，整条结构义务被静默丢弃
 * （假绿：`fUnioned({ id: "x" })` / `fArrUnion(["x"])` 零诊断）。
 *
 * 这里在**消费侧**补 union 成员分支（不动谓词代数 ⇒ 不波及 dts / zod /
 * standard 三面）：
 *   ① 只在 union **带结构义务成员**时接管（无结构成员的 union 由谓词通道
 *      的 `or` 聚合臂裁决 —— Bug 431 归 S1，此处**不重复产出诊断**）；
 *   ② union 是**析取**：任一成员满足即放行；**全部**与实参形态匹配的成员
 *      都不满足才报违例；
 *   ③ 实参形态（对象 / 数组）与成员形态不匹配时**不接管**（该实参只能由
 *      标量成员接 ⇒ 属 union 的标量面，同样归 S1）⇒ 避免与谓词通道双报。
 */
function checkUnionMembers(
  ctx: LiteralScanCtx,
  displayName: string,
  paramName: string,
  c: NudoConstraint,
  pred: Pred,
  arg: Abs,
  loc?: { start: { line: number; column: number } },
): void {
  const members = (c.members ?? []).map(derefDeep);
  // `any()` 成员：接受一切 ⇒ union 无结构义务
  if (members.some((m) => memberFormOf(m) === "any")) return;
  const structural = members.filter((m) => m.fields || m.element);
  if (structural.length === 0) return;
  const form = argFormOf(arg);
  // 实参形态必须与某个结构成员形态**一致**才接管（否则该实参只能由标量
  // 成员接 ⇒ 归谓词通道）
  const matching = structural.filter((m) => memberFormOf(m) === form);
  if (matching.length === 0) return;
  // 谓词通道（`checkReqs` 的 `or` 聚合臂）若能**自己**裁决（全部分支 false）
  // ⇒ 由它产出诊断，本模块让位 ⇒ 同一条违例不会双报。
  if (unionPredDecides(pred, arg, arrayLengthOf(arg))) return;

  let firstDiags: CheckIssue[] | undefined;
  for (const m of matching) {
    const tmp: CheckIssue[] = [];
    const sub: LiteralScanCtx = { ...ctx, out: tmp };
    if (form === "shape") {
      checkShapeAgainstAbs(sub, displayName, paramName, m, arg, paramName, loc);
    } else {
      checkArrayElements(sub, displayName, paramName, m, arg, loc);
    }
    // 该成员满足 ⇒ union 满足（析取）⇒ 放行
    if (tmp.length === 0) return;
    if (!firstDiags) firstDiags = tmp;
  }
  // 与实参形态匹配的成员**全部**不满足 ⇒ union 被违反
  if (firstDiags && firstDiags.length > 0) {
    for (const d of firstDiags) ctx.out.push(d);
    return;
  }
  // 兜底：成员没有逐条诊断可展示 ⇒ 报 union 级违例
  const shown = formatConstraint(c);
  ctx.out.push({
    severity: "error",
    code: DIAG.constraintViolated,
    message: `${displayName}[${paramName}]: argument ⊭ precondition`,
    actual: formatAbs(arg),
    expected: shown,
    suggestion: `use a value satisfying ${shown}`,
    fn: displayName,
    line: loc?.start.line,
    column: loc?.start.column,
  });
}

/**
 * 谓词通道（`checkReqs` 的 `or` 聚合臂）能否**自己**裁决这条 union。
 *
 * 与 `or` 聚合臂**逐字同口径**（族 11 片 S6 任务③ + Bug 1109 修法）：聚合规则是
 * 「有 true ⇒ 放行；**全部**成员确定假 ⇒ 违例；否则（存在未决成员）⇒ 跳过」
 * ⇒ 本函数返回 true 的条件 = 「谓词通道会产出诊断」⇒ 两条通道互斥
 * （同一条违例不会双报）。
 *
 * 结构成员实例化出的分支（`ptypeof(get(u, id), "number")`）**恒不可判定**
 * ⇒ `or` 臂被压住 ⇒ 不报 ⇒ 由结构分支接管（Bug 433 的让位闸）。
 */
function unionPredDecides(
  pred: Pred,
  arg: Abs,
  argLen: number | undefined,
): boolean {
  const or = flattenPred(pred).find((q) => q.op === "or");
  if (!or || or.op !== "or") return false;
  return judgeOrUnion(or, arg, argLen) === false;
}

/** array 成员的元素义务（逐元素；`arr` 走 join 元素、`tuple` 走逐槽） */
function checkArrayElements(
  ctx: LiteralScanCtx,
  displayName: string,
  paramName: string,
  m: NudoConstraint,
  arg: Abs,
  loc?: { start: { line: number; column: number } },
): void {
  const element = m.element;
  if (!element) return;
  if (arg.shape.k === "arr") {
    checkFieldConstraint(
      ctx,
      displayName,
      paramName,
      element,
      (arg.shape as { element: Abs }).element,
      `${paramName}[]`,
      loc,
    );
  } else if (arg.shape.k === "tuple") {
    const els = (arg.shape as { elements: Abs[] }).elements;
    els.forEach((el, i) => {
      checkFieldConstraint(ctx, displayName, paramName, element, el, `${paramName}[${i}]`, loc);
    });
  }
}
