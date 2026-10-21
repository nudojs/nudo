/**
 * 语句控制流谓词（leaf）：与 transpile 主递归解耦，便于单测与拆文件。
 */
import type { Statement, Node } from "@babel/types";
import { indent } from "./helpers.ts";
import { matchRelIdentLit } from "../../arithmetic.ts";

export function stmtCompletesControl(stmt: Statement | undefined | null): boolean {
  if (!stmt) return false;
  switch (stmt.type) {
    case "BreakStatement":
    case "ReturnStatement":
    case "ThrowStatement":
    case "ContinueStatement":
      return true;
    case "BlockStatement":
      return stmtCompletesControl(stmt.body[stmt.body.length - 1] as Statement);
    case "IfStatement":
      return (
        stmt.alternate != null &&
        stmtCompletesControl(stmt.consequent as Statement) &&
        stmtCompletesControl(stmt.alternate as Statement)
      );
    case "TryStatement":
      return tryCompletesControl(stmt as unknown as TryShape);
    default:
      return false;
  }
}

/** try 语句的最小形态（Babel TryStatement 的结构投影） */
type TryShape = {
  block: Statement;
  handler: { body: Statement } | null;
  finalizer: Statement | null;
};

/** finalizer 内的 break/continue 是否可能跳出 finalizer——取消 try 的
 *  return/throw abrupt completion（原生：finally 里的 break/continue 覆盖
 *  try/catch 的退出，控制流落在 try 语句之后）。无标签信号只跳最近的
 *  循环/switch（迭代深度 >0 时留在 finalizer 体内）；带标签信号仅当标签
 *  未在 finalizer 内声明（祖先标签集之外）时外逃。嵌套函数体不参与
 *  （调用不转移控制权）。 */
function finalizerJumpsOut(node: Node): boolean {
  const LOOP_OR_SWITCH = new Set([
    "ForStatement",
    "ForOfStatement",
    "ForInStatement",
    "WhileStatement",
    "DoWhileStatement",
    "SwitchStatement",
  ]);
  const FN_BODY = new Set([
    "FunctionExpression",
    "ArrowFunctionExpression",
    "FunctionDeclaration",
    "ObjectMethod",
    "ClassMethod",
    "ClassPrivateMethod",
    "StaticBlock",
  ]);
  const walk = (n: unknown, iterDepth: number, labels: ReadonlySet<string>): boolean => {
    if (!n || typeof n !== "object") return false;
    const t = n as Record<string, unknown> & { type?: string };
    if (typeof t.type === "string" && FN_BODY.has(t.type)) return false;
    if (t.type === "BreakStatement" || t.type === "ContinueStatement") {
      const lbl = (t.label as { name?: string } | undefined)?.name;
      return lbl !== undefined ? !labels.has(lbl) : iterDepth === 0;
    }
    let nextIter = iterDepth;
    let nextLabels: ReadonlySet<string> = labels;
    if (t.type === "LabeledStatement") {
      nextLabels = new Set(labels).add((t.label as { name: string }).name);
    }
    if (typeof t.type === "string" && LOOP_OR_SWITCH.has(t.type)) nextIter = iterDepth + 1;
    for (const key of Object.keys(t)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
      const child = t[key] as unknown;
      if (Array.isArray(child)) {
        for (const c of child) if (walk(c, nextIter, nextLabels)) return true;
      } else if (child && typeof child === "object") {
        if (walk(child, nextIter, nextLabels)) return true;
      }
    }
    return false;
  };
  return walk(node, 0, new Set<string>());
}

/** try 是否绝不正常完成（return/throw/break/continue 任一控制转移）：
 *  - finalizer 自身确定退出 → 覆盖一切出口；
 *  - finalizer 可跳出 → break/continue 取消 try 的退出 → 正常完成；
 *  - 否则 block 与（有 catch 时）handler 体都绝不正常完成才成立。 */
function tryCompletesControl(stmt: TryShape): boolean {
  if (stmt.finalizer) {
    if (stmtCompletesControl(stmt.finalizer)) return true;
    if (finalizerJumpsOut(stmt.finalizer)) return true;
  }
  if (stmt.handler) {
    return (
      stmtCompletesControl(stmt.block) && stmtCompletesControl(stmt.handler.body)
    );
  }
  return stmtCompletesControl(stmt.block);
}

/** 语句或块内是否出现 return/throw（决定 if 是否提升为 return $fork） */
export function stmtReturns(stmt: Statement): boolean {
  if (stmt.type === "ReturnStatement" || stmt.type === "ThrowStatement") return true;
  if (stmt.type === "BlockStatement") return stmt.body.some(stmtReturns);
  if (stmt.type === "IfStatement") {
    return stmtReturns(stmt.consequent) && stmt.alternate != null && stmtReturns(stmt.alternate);
  }
  if (stmt.type === "TryStatement") {
    const t = stmt as unknown as TryShape;
    // finalizer 自身确定 return/throw：一切出口被覆盖，整体终止
    if (t.finalizer && stmtReturns(t.finalizer)) return true;
    // finalizer 可 break/continue 外逃：取消 try/catch 的 return/throw，
    // try 可能正常完成——不得视为终止（提升会丢 fall-through 路径）
    if (t.finalizer && finalizerJumpsOut(t.finalizer)) return false;
    if (t.handler) {
      // block 必终止（return 直出 / throw 入 catch）且 handler 必终止
      return stmtReturns(t.block) && stmtReturns(t.handler.body);
    }
    return stmtReturns(t.block);
  }
  // switch：所有可达臂均 return/throw 且 **存在 default** 才视为终止
  // （无 default 时 no-match 会 fall-through，不得当终止 — P0-1）
  if (stmt.type === "SwitchStatement") {
    type Arm = { stmts: Statement[]; isDefault: boolean };
    const arms: Arm[] = [];
    for (const c of stmt.cases) {
      const testIsDefault = c.test === null || c.test === undefined;
      const last = arms[arms.length - 1];
      if (last && !last.isDefault && last.stmts.length === 0 && !testIsDefault) {
        last.stmts = c.consequent;
        continue;
      }
      if (
        last &&
        !last.isDefault &&
        !testIsDefault &&
        last.stmts.length > 0 &&
        c.consequent.length === 0
      ) {
        continue; // fall-through 空臂并入前一有体臂
      }
      arms.push({ stmts: c.consequent, isDefault: testIsDefault });
    }
    const armOk = (a: Arm): boolean => a.stmts.length > 0 && a.stmts.every(stmtReturns);
    const nonDefault = arms.filter((a) => !a.isDefault);
    const dflt = arms.find((a) => a.isDefault);
    if (dflt === undefined) return false; // 无 default：必然 fall-through
    return nonDefault.length > 0 && nonDefault.every(armOk) && armOk(dflt);
  }
  return false;
}

/** 终止语句：return / throw */
export function isTerminalStmt(s: Statement): boolean {
  return s.type === "ReturnStatement" || s.type === "ThrowStatement";
}

/**
 * 把 if/else-if 后的终止尾句收进缺失的最终 else：
 *   if (A) return 1; else if (B) return 2; return 0;
 * → if (A) return 1; else if (B) return 2; else return 0;
 * 否则 return $fork 优化不触发，臂内 JS return 被 thunk 吞掉后
 * 尾部 return 覆盖早退值（ms 的 else-if 数字分支即此形态）。
 */
export function completeElseChain(ifStmt: Statement, tail: Statement[]): Statement | null {
  if (ifStmt.type !== "IfStatement") return null;
  if (!tail.every(isTerminalStmt)) return null;
  const asBlock = (body: Statement): Statement =>
    body.type === "BlockStatement"
      ? body
      : ({ type: "BlockStatement", body: [body] } as unknown as Statement);
  if (ifStmt.alternate == null) {
    return {
      ...ifStmt,
      alternate: {
        type: "BlockStatement",
        body: [...tail],
      } as unknown as Statement,
    } as unknown as Statement;
  }
  if (ifStmt.alternate.type === "IfStatement") {
    const inner = completeElseChain(ifStmt.alternate, tail);
    if (!inner) return null;
    return { ...ifStmt, alternate: asBlock(inner) } as unknown as Statement;
  }
  return null;
}

export function completeElseChains(stmts: Statement[]): Statement[] {
  const out = stmts.map((s) => ({ ...s }) as unknown as Statement);
  for (let i = 0; i < out.length; i++) {
    const stmt = out[i]!;
    if (stmt.type !== "IfStatement") continue;
    // 仅早退 if：consequent 含 return/throw 时，尾句才是「未走 then」的续体
    if (!stmtReturns(stmt.consequent)) continue;
    const tail = out.slice(i + 1);
    if (tail.length === 0) continue;
    const fixed = completeElseChain(stmt, tail);
    if (!fixed) continue;
    out[i] = fixed;
    out.length = i + 1;
    break;
  }
  return out;
}

/** 块体无确定 return 时补隐式 return $lit(void 0) */
export function withImplicitReturn(body: Node, bodyStmts: string, depth: number): string {
  if (stmtReturns(body as unknown as Statement)) return bodyStmts;
  return `${bodyStmts}\n${indent(depth)}return $lit(void 0);`;
}

// --- nullish / typeof 守卫识别（issue #97 / Bug 2/3/23） ---------------------

/**
 * 严格模式非法绑定名：`arguments` / `eval` 在 strict 代码里不能作形参/绑定
 * 名。守卫影子重绑 `((name) => THUNK)(…)` 以**被守卫标识符**作形参——被守卫
 * 名是 `arguments`（如 `if (arguments.length === 0)` 判别守卫）时，产物在
 * strict 模块体（Bug 116 `"use strict"` 前缀）下 new Function 编译期直接
 * SyntaxError（"Unexpected eval or arguments in strict mode"）→ 整模块
 * fail-closed 空导出且失败不进 memo（yargs yargs-factory.js 实证：bench
 * check 5.5x 回退）。此名面上影子包装整体跳过——与 fork 绑定集冲突跳过
 * 同一口径（宁缺毋假：窄化是精度增益，跳过只是少剪，语义不变）。
 */
const STRICT_ILLEGAL_BINDINGS = new Set(["arguments", "eval"]);

/** 守卫名是否不能作 strict 绑定名（守卫影子包装须跳过） */
function isStrictIllegalBinding(name: string): boolean {
  return STRICT_ILLEGAL_BINDINGS.has(name);
}

export type NullishGuard = {
  /** 被守卫的标识符 */
  name: string;
  /** 该标识符可证非 nullish（指定粒度）的臂 */
  arm: "cons" | "alt";
  /**
   * 剪除粒度（Bug 3）：nullish = null+undefined（`p == null`、`!p`、复合
   * `p === null || p === undefined` 的否定臂）；null = 仅 null（严格
   * `p === null` 的假值臂——`null === undefined` 为 false，臂内 p 仍可能
   * undefined）；undefined = 仅 undefined（`typeof u === "undefined"` /
   * 严格 `u === undefined` 的假值臂——`typeof null === "object"`，臂内
   * u 仍可能 null）。
   */
  grain?: "nullish" | "null" | "undefined";
  /**
   * 单层成员真值守卫（issue #118）：`o.p` / `o?.p` 真值守卫——真值 ⇒ 基名
   * 非 nullish（真值访问未抛）且槽 p 的值非 nullish、槽必在场。臂内基名
   * 重绑为 $removeMemberNullish($removeNullish(o), key)（optional 摘除 +
   * 槽值剥 nullish）。只做单层；嵌套路径不识别；计算键仅数值字面量
   * （issue #136 (b)，`m[1]` 下标槽键即 String(i)）。
   */
  memberKey?: string;
};

const TYPEOF_NAMES = new Set([
  "undefined", "object", "boolean", "number", "string", "function", "symbol", "bigint",
]);

const isStrLitNode = (n: unknown): n is { value: string } => {
  const t = n as { type?: string; value?: unknown };
  return t?.type === "StringLiteral" && typeof t.value === "string";
};

/** UnaryExpression `typeof x` 且 x 是 Identifier */
const typeofArgName = (n: unknown): string | undefined => {
  const t = n as { type?: string; operator?: string; argument?: { type?: string; name?: string } };
  if (t?.type === "UnaryExpression" && t.operator === "typeof" && t.argument?.type === "Identifier") {
    return t.argument.name;
  }
  return undefined;
};

/** 粒度合并（复合守卫否定臂的合取事实）：覆盖两粒度 → nullish */
function mergeGrain(a: "null" | "undefined", b: "null" | "undefined"): "nullish" | "null" | "undefined" {
  if (a !== b) return "nullish";
  return a;
}

/**
 * 成员真值守卫目标（issue #118）：`o.p` / `o?.p`（MemberExpression /
 * OptionalMemberExpression，后者可能被 ChainExpression 包裹——非表达式
 * 语句起点不包，if 测试实测为裸 OptionalMemberExpression，双形态兼容）。
 * 只认非计算键 + Identifier 基名（单层）；property 取 Identifier 名或
 * StringLiteral 值。issue #136 (b)：计算键认数值（NumericLiteral / 数值
 * 字符串 StringLiteral）——`m[1]` 真值守卫与 `m.p` 同事实（RegExpExecArray
 * 下标槽键即 String(i)）；非数值字面量 / 字符串模板计算键不识别。
 */
const memberGuardTarget = (n: unknown): { name: string; key: string } | undefined => {
  const t = n as {
    type?: string;
    expression?: unknown;
    object?: { type?: string; name?: string };
    computed?: boolean;
    property?: { type?: string; name?: string; value?: unknown };
  };
  const m = (t?.type === "ChainExpression" ? t.expression : t) as typeof t;
  if (m?.type !== "MemberExpression" && m?.type !== "OptionalMemberExpression") return undefined;
  if (m.object?.type !== "Identifier" || !m.object.name) return undefined;
  const p = m.property;
  if (m.computed) {
    // 数值下标：键 = String(value)（"1" / "-1"；非规范数值字符串保守不认）
    if (p?.type === "NumericLiteral" && typeof p.value === "number") {
      return { name: m.object.name, key: String(p.value) };
    }
    if (p?.type === "StringLiteral" && typeof p.value === "string" && /^-?\d+$/.test(p.value)) {
      return { name: m.object.name, key: p.value };
    }
    return undefined;
  }
  const key =
    p?.type === "Identifier" ? p.name : p?.type === "StringLiteral" && typeof p.value === "string" ? p.value : undefined;
  if (key === undefined) return undefined;
  return { name: m.object.name, key };
};

/**
 * 赋值即守卫目标（issue #118 v3）：`(m = re.exec(s))` —— `=` + Identifier
 * 左值（任意右值）。测试真值 ⇒ 赋予该变量的值（= 测试值）非 nullish，
 * cons（真值）臂内变量可剪影；`!(m = f())` 同理 → alt 臂。复合赋值（+=
 * 等）的真值不能干净推出非 nullish，不识别。
 */
const assignGuardTarget = (n: unknown): string | undefined => {
  const t = n as { type?: string; operator?: string; left?: { type?: string; name?: string } };
  if (t?.type === "AssignmentExpression" && t.operator === "=" && t.left?.type === "Identifier" && t.left.name) {
    return t.left.name;
  }
  return undefined;
};

/**
 * 测试表达式是否是「标识符的 nullish 守卫」，返回非 nullish 事实所属臂：
 * - `p === null` / `p === undefined`（严格）→ else（alt）臂剪对应粒度
 *   （严格等价只排除该字面量：`p === null` 假值臂仍可能 undefined）
 * - `p == null` / `p == undefined`（宽松）→ else 臂剪 nullish（宽松等价
 *   `null == undefined` 同真，假值臂两者皆非）
 * - `p !== null` / `p != null` … → then（cons）臂同粒度剪除
 * - `!p` → else 臂（¬!p ⇒ p 真值 ⇒ 非 nullish）
 * - 裸 `p` → then 臂（p 真值 ⇒ 非 nullish）
 * - `typeof u === "undefined"` → else 臂仅剪 undefined（`typeof null ===
 *   "object"`，臂内 u 仍可能 null）；`!==` → then 臂
 * - `p === null || p === undefined` → else 臂剪 nullish（两比较同假 ⇒
 *   p 既非 null 也非 undefined）；`p !== null && p !== undefined` → then
 *   臂剪 nullish（同标识符两侧 nullish 比较的确定复合形态）
 * - `o.p` 真值守卫（issue #118，非计算键 + Identifier 基名）→ then 臂：
 *   真值 ⇒ 基名非 nullish（真值访问未抛）且槽 p 值非 nullish、槽必在场；
 *   `!o.p` → else 臂同事实；`o?.p` / `!o?.p`（可选链，Babel 产
 *   OptionalMemberExpression，可能 ChainExpression 包裹）同臂位——truthy
 *   ⇒ 基名非 nullish 且槽值真值
 * - `o.p == null` / `o.p != null`（宽松，issue #120 静态名形态）→ 宽松
 *   等价下缺槽读出 undefined 与 null 互通（`undefined == null` 真），比较
 *   为假（==）/为真（!=）⇒ 槽必在场且槽值非 nullish、基名非 nullish
 *   （求值未抛），与成员真值守卫同事实。严格 `===`/`!==` 成员形态**不
 *   识别**：`o.p !== null` 真仍可能 undefined（缺槽/显式 undefined 值），
 *   双粒度成员剪影（剥槽值 nullish + 摘 optional）不健全——保守放弃
 *   （文档化边界）。
 * - `(m = f())` 赋值即守卫（issue #118 v3）：测试真值 ⇒ 赋值结果非
 *   nullish → cons 臂剪 m；`!(m = f())` → alt 臂。`while ((m = re.exec(s)))`
 *   / `if ((m = f()))` 即此形态。
 * 守卫变量在该臂内以 $removeNullish/$removeNull/$removeUndefined/
 * $removeMemberNullish 影子重绑，成员读写不再记 may-throw（issue #97：
 * `if (p === null) return -1; p.major`；#118：`if (o.p) return o.p.q`）。
 */
export function nullishGuardOf(test: unknown): NullishGuard | undefined {
  const t = test as {
    type?: string;
    operator?: string;
    left?: unknown;
    right?: unknown;
    argument?: { type?: string; name?: string };
    name?: string;
  };
  if (t?.type === "LogicalExpression") return compositeNullishGuardOf(t);
  if (t?.type === "UnaryExpression" && t.operator === "!" && t.argument?.type === "Identifier" && t.argument.name) {
    return { name: t.argument.name, arm: "alt", grain: "nullish" };
  }
  // `!o.p` / `!o?.p`：测试假值臂 ⇒ 成员真值（issue #118）
  if (t?.type === "UnaryExpression" && t.operator === "!") {
    const m = memberGuardTarget(t.argument);
    if (m) return { name: m.name, arm: "alt", grain: "nullish", memberKey: m.key };
    // `!(m = f())`：测试假值臂 ⇒ 赋值结果真值（issue #118 v3）
    const a = assignGuardTarget(t.argument);
    if (a) return { name: a, arm: "alt", grain: "nullish" };
  }
  if (t?.type === "Identifier" && t.name) {
    return { name: t.name, arm: "cons", grain: "nullish" };
  }
  // 裸 `o.p` / `o?.p`：测试真值臂 ⇒ 成员真值（issue #118）
  const bare = memberGuardTarget(t);
  if (bare) return { name: bare.name, arm: "cons", grain: "nullish", memberKey: bare.key };
  // 裸 `(m = f())`：测试真值臂 ⇒ 赋值结果真值（issue #118 v3）
  const bareAssign = assignGuardTarget(t);
  if (bareAssign) return { name: bareAssign, arm: "cons", grain: "nullish" };
  if (t?.type !== "BinaryExpression") return undefined;
  const op = t.operator;
  if (op !== "===" && op !== "!==" && op !== "==" && op !== "!=") return undefined;
  const truthyArm = op === "===" || op === "==" ? "alt" : "cons";
  // `typeof u === "undefined"`：真值臂 u 是 undefined；假值臂仅证非 undefined
  const lTo = typeofArgName(t.left);
  const rTo = typeofArgName(t.right);
  if (lTo !== undefined && isStrLitNode(t.right)) {
    if (t.right.value === "undefined") return { name: lTo, arm: truthyArm, grain: "undefined" };
    return undefined;
  }
  if (rTo !== undefined && isStrLitNode(t.left)) {
    if (t.left.value === "undefined") return { name: rTo, arm: truthyArm, grain: "undefined" };
    return undefined;
  }
  const litGrain = (lit: unknown): "null" | "undefined" | "nullish" | undefined => {
    const ln = lit as { type?: string; name?: string };
    const isNull = ln?.type === "NullLiteral";
    if (!isNull && ln?.name !== "undefined") return undefined;
    // 宽松等价：null/undefined 互通（`null == undefined` 为真）→ 假值臂全剪
    if (op === "==" || op === "!=") return "nullish";
    return isNull ? "null" : "undefined";
  };
  const l = t.left as { type?: string; name?: string };
  const r = t.right as { type?: string; name?: string };
  if (l?.type === "Identifier" && l.name) {
    const grain = litGrain(r);
    if (grain !== undefined) return { name: l.name, arm: truthyArm, grain };
  }
  if (r?.type === "Identifier" && r.name) {
    const grain = litGrain(l);
    if (grain !== undefined) return { name: r.name, arm: truthyArm, grain };
  }
  // 成员宽松等价守卫（issue #120 静态名形态）：`o.p == null` / `o.p != null`
  // —— 宽松等价下缺槽读出 undefined 与 null 互通（`undefined == null` 真），
  // 比较为假（==）/为真（!=）⇒ 槽必在场且槽值非 nullish，基名亦非 nullish
  // （求值未抛），与成员真值守卫（issue #118）同事实。字面量在左对称识别。
  // 严格 ===/!== 成员形态不在此处理（见上文文档化边界：undefined 仍可能）。
  if (op === "==" || op === "!=") {
    const nullishLit = (n: unknown): boolean => {
      const ln = n as { type?: string; name?: string };
      return ln?.type === "NullLiteral" || ln?.name === "undefined";
    };
    const lm = memberGuardTarget(t.left);
    const rm = memberGuardTarget(t.right);
    if (lm && nullishLit(t.right)) {
      return { name: lm.name, arm: truthyArm, grain: "nullish", memberKey: lm.key };
    }
    if (rm && nullishLit(t.left)) {
      return { name: rm.name, arm: truthyArm, grain: "nullish", memberKey: rm.key };
    }
  }
  return undefined;
}

/**
 * LogicalExpression 复合 nullish 守卫（issue #118 放宽）：
 * - 同一 Identifier 两侧 nullish 比较的确定形态（既有语义）——`||` 的
 *   穿透臂 / `&&` 的成立臂合并两侧粒度与成员事实；
 * - 单侧成立即可：`A || B` 的穿透臂（整体假 = 两侧皆假）里，任一析取项
 *   自身是「非 nullish 事实臂 = alt」的 nullish 守卫（如 `!doc`）即单独
 *   成立——另一侧（typeof 守卫 `typeof doc !== 'object'` 或任意谓词）的
 *   真假不否定该事实；`&&` 同理 cons（整体真 = 两侧皆真，单侧事实独立
 *   成立）。
 * - 两侧都是 nullish 守卫但**异名** → 保守 undefined（与既有语义一致：
 *   只重绑单名的影子机制无法同时表达双事实，宁缺毋假）。
 */
function compositeNullishGuardOf(test: unknown): NullishGuard | undefined {
  const t = test as { type?: string; operator?: string; left?: unknown; right?: unknown };
  if (t?.type !== "LogicalExpression" || (t.operator !== "||" && t.operator !== "&&")) return undefined;
  const wantArm = t.operator === "||" ? "alt" : "cons";
  const l = nullishGuardOf(t.left);
  const r = nullishGuardOf(t.right);
  const lg = l && l.arm === wantArm ? l : undefined;
  const rg = r && r.arm === wantArm ? r : undefined;
  if (lg && rg) {
    if (lg.name !== rg.name) return undefined;
    const g1 = lg.grain === "null" || lg.grain === "undefined" ? lg.grain : null;
    const g2 = rg.grain === "null" || rg.grain === "undefined" ? rg.grain : null;
    const grain =
      g1 === null || g2 === null
        ? "nullish"
        : mergeGrain(g1, g2);
    // 成员事实取并集可表的部分：不同键只保留第一侧（sound 子集）
    const memberKey = lg.memberKey ?? rg.memberKey;
    return { name: lg.name, arm: wantArm, grain, ...(memberKey !== undefined ? { memberKey } : {}) };
  }
  return lg ?? rg;
}

/** 同名守卫事实合并进列表（多名复合，issue #118 v3 / #120）：粒度取并
 *  （覆盖两粒度 → nullish），成员键缺失侧补齐；键不同只保留第一侧
 *  （sound 子集，与单守卫 compositeNullishGuardOf 同规则）。 */
function mergeGuardInto(list: NullishGuard[], g: NullishGuard): void {
  const prev = list.find((x) => x.name === g.name);
  if (!prev) {
    list.push(g);
    return;
  }
  const grainA = prev.grain ?? "nullish";
  const grainB = g.grain ?? "nullish";
  if (grainA !== grainB) prev.grain = "nullish";
  if (prev.memberKey === undefined && g.memberKey !== undefined) prev.memberKey = g.memberKey;
}

/** 方法调用接收者的静态路径（issue #136 (c)）：callee 为普通
 *  MemberExpression（`x.m(...)`）且接收者（callee.object）是标识符或
 *  单层静态成员/数值下标（memberGuardTarget 同形态）。OptionalMember /
 *  ChainExpression（`?.` 链）不识别——可选链短路求值不蕴含接收者非
 *  nullish；接收者含调用/三元等复杂表达式不提取（宁缺毋假）。 */
const methodReceiverTarget = (callee: unknown): { name: string; key?: string } | undefined => {
  const c = callee as { type?: string; object?: unknown };
  if (c?.type !== "MemberExpression") return undefined;
  const o = c.object as { type?: string; name?: string };
  if (o?.type === "Identifier" && o.name) return { name: o.name };
  if (o?.type === "MemberExpression") return memberGuardTarget(o);
  return undefined;
};

/** 接收者事实的臂上下文：both = 无条件求值（双臂成立）；cons/alt = 仅在该
 *  臂成立；null = 任一臂都不可证（丢弃）。 */
type ReceiverArmCtx = "both" | "cons" | "alt" | null;

/**
 * 测试表达式内方法调用接收者的非 nullish 事实收集（issue #136 (c)）：
 * `x.m(...)` / `x.p.m(...)` / `x[1].m(...)` 的调用子式求值到达 ⇒ 接收者
 * 非 nullish（nullish 臂在方法名成员读处 throws 分流——undefined.trim()
 * TypeError；测试取得值即证接收者有值）。臂归属按短路方向：
 * - 无条件求值位（二元/一元操作数、调用实参、`A && B`/`A || B` 的 A 位、
 *   三元 test）→ 双臂；
 * - `A && B` 的 B 位 → 仅 cons（B 求值 ⇒ A 真 ⇒ 整体真，假值臂含 A 假短路
 *   位不可证）；
 * - `A || B` 的 B 位 → 仅 alt（B 求值 ⇒ A 假，整体真假随 B——真值臂含 A
 *   真短路位不可证）；
 * - `??` 右侧 / 三元分支 / 嵌套反向逻辑（臂交不出单臂）→ 不提取。
 */
const collectReceiverFacts = (n: unknown, ctx: ReceiverArmCtx, out: NullishGuard[]): void => {
  if (ctx === null || !n || typeof n !== "object") return;
  const t = n as {
    type?: string;
    operator?: string;
    left?: unknown;
    right?: unknown;
    test?: unknown;
    argument?: unknown;
    callee?: unknown;
    arguments?: unknown[];
    object?: unknown;
    property?: unknown;
    computed?: boolean;
  };
  switch (t.type) {
    case "LogicalExpression":
      if (t.operator === "&&" || t.operator === "||") {
        const rArm: "cons" | "alt" = t.operator === "&&" ? "cons" : "alt";
        collectReceiverFacts(t.left, ctx, out);
        // B 位臂位 = 当前臂位 ∩ rArm：both → rArm；同向保持；异向/不确定 → null
        collectReceiverFacts(
          t.right,
          ctx === "both" || ctx === rArm ? rArm : null,
          out,
        );
      } else if (t.operator === "??") {
        // 右侧仅左 nullish 时求值，与整体真假无确定关系 → 只收左侧
        collectReceiverFacts(t.left, ctx, out);
      }
      return;
    case "ConditionalExpression":
      // 三元：test 无条件求值；两分支与整体真假无确定关系 → 分支不提取
      collectReceiverFacts(t.test, ctx, out);
      return;
    case "CallExpression": {
      const recv = methodReceiverTarget(t.callee);
      if (recv) {
        for (const arm of ctx === "both" ? (["cons", "alt"] as const) : [ctx]) {
          out.push({
            name: recv.name,
            arm,
            grain: "nullish",
            ...(recv.key !== undefined ? { memberKey: recv.key } : {}),
          });
        }
      }
      // 实参无条件求值；callee 为嵌套调用（f(x).m() 的 f(x)）时其内部同臂位
      collectReceiverFacts(t.callee, ctx, out);
      for (const a of t.arguments ?? []) collectReceiverFacts(a, ctx, out);
      return;
    }
    default:
      // 二元/一元/赋值等无条件求值位：操作数按当前臂位继续；成员访问的
      // object 位（`m[1].trim().length` 的调用在 .length 的 object 里）与
      // 计算键属性位（`a[k.m()]` 的 k.m() 无条件求值）同此
      collectReceiverFacts(t.left, ctx, out);
      collectReceiverFacts(t.right, ctx, out);
      collectReceiverFacts(t.argument, ctx, out);
      collectReceiverFacts(t.object, ctx, out);
      if (t.computed) collectReceiverFacts(t.property, ctx, out);
      return;
  }
};

/** 接收者事实并入守卫列表：同名同臂合并（粒度取并、成员键补缺——接收者
 *  事实自身蕴含基名非 nullish，nullish 粒度并进不放大）；同名异臂并存
 *  （narrowNullishArmThunks 按臂过滤，不产生重复形参）；已有不同成员键 →
 *  保留首个（sound 子集，与 mergeGuardInto 同规则）。 */
function appendReceiverGuards(test: unknown, out: NullishGuard[]): void {
  const facts: NullishGuard[] = [];
  collectReceiverFacts(test, "both", facts);
  for (const f of facts) {
    const prev = out.find((x) => x.name === f.name && x.arm === f.arm);
    if (!prev) {
      out.push(f);
      continue;
    }
    const grainA = prev.grain ?? "nullish";
    const grainB = f.grain ?? "nullish";
    if (grainA !== grainB) prev.grain = "nullish";
    if (prev.memberKey === undefined && f.memberKey !== undefined) prev.memberKey = f.memberKey;
  }
}

/**
 * 测试表达式的**全部**独立 nullish 守卫事实（issue #118 v3 / #120 多名
 * 复合）。单（非复合）测试式 → nullishGuardOf 单守卫；LogicalExpression
 * 同方向递归展开：`||` 收各析取项的穿透臂（alt）事实——整体假 = 各项皆
 * 假，各项事实独立成立（`obj == null || node.property == null` 的穿透臂
 * 里 obj 与 node.property 双双非 nullish）；`&&` 收各合取项的成立臂
 * （cons）事实。同名同臂合并粒度、异键保首；异方向子式（`||` 内嵌 `&&`）
 * 的单侧真假不传播事实——递归结果按臂过滤后自然丢弃。单守卫 API
 * nullishGuardOf 对异名复合仍保守 undefined（历史语义），多名收窄一律
 * 走本入口。issue #136 (c)：非复合测试式额外并入方法调用接收者事实
 * （collectReceiverFacts，含臂归属的短路方向推理）。
 */
export function nullishGuardsOf(test: unknown): NullishGuard[] {
  const t = test as { type?: string; operator?: string; left?: unknown; right?: unknown };
  if (t?.type === "LogicalExpression" && (t.operator === "||" || t.operator === "&&")) {
    const wantArm: "cons" | "alt" = t.operator === "||" ? "alt" : "cons";
    const out: NullishGuard[] = [];
    for (const g of [...nullishGuardsOf(t.left), ...nullishGuardsOf(t.right)]) {
      if (g.arm !== wantArm) continue;
      mergeGuardInto(out, g);
    }
    return out;
  }
  const g = nullishGuardOf(test);
  const out: NullishGuard[] = g ? [g] : [];
  appendReceiverGuards(test, out);
  return out;
}

/**
 * typeof 类型守卫（Bug 23）：`typeof v === "string"` / `"string" === typeof v`
 * （`===`/`!==`/`==`/`!=`）→ arm 臂内 v 的 typeof 恒为 typeOf（`===` → cons，
 * `!==` → alt）。"undefined" 交由 nullishGuardOf 的 grain 通道处理（同一
 * 表达式不得双守卫），此处不认。
 */
export type TypeGuard = {
  /** 被守卫的标识符 */
  name: string;
  /** typeof 结果字面量 */
  typeOf: string;
  /** 该 typeof 事实成立的臂 */
  arm: "cons" | "alt";
};

export function typeGuardOf(test: unknown): TypeGuard | undefined {
  const t = test as {
    type?: string;
    operator?: string;
    left?: unknown;
    right?: unknown;
  };
  if (t?.type !== "BinaryExpression") return undefined;
  const op = t.operator;
  if (op !== "===" && op !== "!==" && op !== "==" && op !== "!=") return undefined;
  const lTo = typeofArgName(t.left);
  const rTo = typeofArgName(t.right);
  const litSide = lTo !== undefined ? t.right : rTo !== undefined ? t.left : null;
  const name = lTo ?? rTo;
  if (name === undefined || !isStrLitNode(litSide)) return undefined;
  if (litSide.value === "undefined" || !TYPEOF_NAMES.has(litSide.value)) return undefined;
  return { name, typeOf: litSide.value, arm: op === "===" || op === "==" ? "cons" : "alt" };
}

/** nullish 守卫的臂 thunk 剪影运行时助手调用串（按粒度/成员形态分发） */
export function nullishRemoveCallOf(guard: NullishGuard): string {
  if (guard.memberKey !== undefined) {
    // 成员真值守卫（issue #118）：真值访问未抛 ⇒ 基名非 nullish（$removeNullish
    // 先行），槽值再剥 nullish（$removeMemberNullish 同时摘 optional 标记）
    return `$removeMemberNullish($removeNullish(${guard.name}), ${JSON.stringify(guard.memberKey)})`;
  }
  if (guard.grain === "undefined") return `$removeUndefined(${guard.name})`;
  if (guard.grain === "null") return `$removeNull(${guard.name})`;
  return `$removeNullish(${guard.name})`;
}

/** 守卫臂 thunk 的 nullish 剪影包装：`((p) => THUNK)($removeNullish(p))`。
 *  仅当守卫名不在 fork 绑定集（臂内无写/快照重绑）时应用——否则影子参数
 *  会吞掉臂内写，破坏 forkJoin 的绑定 join。单守卫入口（多守卫见
 *  narrowNullishArmThunks）。 */
export function narrowNullishArmThunk(thunk: string, guard: NullishGuard | undefined, arm: "cons" | "alt", forkBindingNames: ReadonlySet<string> | readonly string[]): string {
  if (!guard) return thunk;
  return narrowNullishArmThunks(thunk, [guard], arm, forkBindingNames);
}

/** 多守卫臂 thunk 剪影包装（issue #118 v3 / #120）：`((a, b) => THUNK)
 *  (<rm a>, <rm b>)`——一名一影子参数，多个独立事实同臂齐用（`obj == null
 *  || node.property == null` 穿透臂）。只应用 arm 匹配的守卫；任一匹配
 *  守卫名在 fork 绑定集（臂内写/快照重绑）→ 全部跳过（宁缺毋假：与单
 *  守卫同一跳过口径，不做部分应用）。 */
export function narrowNullishArmThunks(
  thunk: string,
  guards: readonly NullishGuard[] | undefined | null,
  arm: "cons" | "alt",
  forkBindingNames: ReadonlySet<string> | readonly string[],
): string {
  if (!guards || guards.length === 0) return thunk;
  const matching = guards.filter((g) => g.arm === arm);
  if (matching.length === 0) return thunk;
  const names =
    forkBindingNames instanceof Set ? (forkBindingNames as Set<string>) : new Set(forkBindingNames);
  if (matching.some((g) => names.has(g.name) || isStrictIllegalBinding(g.name))) return thunk;
  const params = matching.map((g) => g.name).join(", ");
  const args = matching.map((g) => nullishRemoveCallOf(g)).join(", ");
  return `((${params}) => ${thunk})(${args})`;
}

/** typeof 类型守卫臂 thunk 的剪影包装：`((v) => THUNK)($narrowTypeOf(v, T, keep))`。
 *  事实臂（arm）保留匹配成员，对侧臂绑补集；守卫名在 fork 绑定集时跳过
 *  （与 nullish 剪影同规则）。 */
export function narrowTypeArmThunk(thunk: string, guard: TypeGuard | undefined, arm: "cons" | "alt", forkBindingNames: ReadonlySet<string> | readonly string[]): string {
  if (!guard) return thunk;
  const names =
    forkBindingNames instanceof Set ? (forkBindingNames as Set<string>) : new Set(forkBindingNames);
  if (names.has(guard.name) || isStrictIllegalBinding(guard.name)) return thunk;
  const keep = arm === guard.arm;
  return `((${guard.name}) => ${thunk})($narrowTypeOf(${guard.name}, ${JSON.stringify(guard.typeOf)}, ${keep}))`;
}

// --- 判别等值守卫（issue #126） ---------------------------------------------

/**
 * 判别等值守卫（issue #126）：`x.key === 'lit'`（或 `!==` 对偶，字面量在
 * 左对称）——判别事实「x.key === value」成立的臂（`===` → cons、`!==` →
 * alt）内 x 以 $narrowMemberEq 影子重绑为「key 值域可能等于 value」的
 * union 成员子集，kind-specific 字段的 index 读（`node.quasis[0]`）不再
 * 撞其他臂的 undefined 记假 may-throw。只认严格等价（`===`/`!==`——宽松
 * `==` 有强制转换面）与非计算键单层成员（memberGuardTarget 同形态）；
 * nullish 字面量归 nullishGuardOf 通道，此处只认 string/number/boolean。
 */
export type DiscriminantGuard = {
  /** 被守卫的标识符（判别基名） */
  name: string;
  /** 判别键（非计算成员） */
  key: string;
  /** 判别字面量（string/number/boolean） */
  value: string | number | boolean;
  /** 「x.key === value」事实成立的臂（`===` → cons / `!==` → alt） */
  arm: "cons" | "alt";
};

const isPrimLitNode = (n: unknown): n is { value: string | number | boolean } => {
  const t = n as { type?: string; value?: unknown };
  if (t?.type === "StringLiteral") return typeof t.value === "string";
  if (t?.type === "NumericLiteral") return typeof t.value === "number";
  if (t?.type === "BooleanLiteral") return typeof t.value === "boolean";
  return false;
};

export function discriminantGuardOf(test: unknown): DiscriminantGuard | undefined {
  const t = test as { type?: string; operator?: string; left?: unknown; right?: unknown };
  if (t?.type !== "BinaryExpression") return undefined;
  if (t.operator !== "===" && t.operator !== "!==") return undefined;
  const lm = memberGuardTarget(t.left);
  const rm = memberGuardTarget(t.right);
  const m =
    lm !== undefined && isPrimLitNode(t.right) ? { target: lm, lit: t.right as { value: string | number | boolean } } :
    rm !== undefined && isPrimLitNode(t.left) ? { target: rm, lit: t.left as { value: string | number | boolean } } :
    undefined;
  if (!m) return undefined;
  return {
    name: m.target.name,
    key: m.target.key,
    value: m.lit.value,
    arm: t.operator === "===" ? "cons" : "alt",
  };
}

/**
 * 测试表达式的全部独立判别等值事实（issue #126）：LogicalExpression 同方向
 * 递归展开——`&&` 收各合取项的成立臂（cons）事实（整体真 = 各项皆真，各项
 * 判别事实独立成立）；`||` 收各析取项的穿透臂（alt）事实。同名多键互不冲
 * 突（链式窄化取交集），同名同键同值去重；异方向子式的单侧真假不传播事实。
 */
export function discriminantGuardsOf(test: unknown): DiscriminantGuard[] {
  const t = test as { type?: string; operator?: string; left?: unknown; right?: unknown };
  if (t?.type === "LogicalExpression" && (t.operator === "&&" || t.operator === "||")) {
    const wantArm: "cons" | "alt" = t.operator === "&&" ? "cons" : "alt";
    const out: DiscriminantGuard[] = [];
    for (const g of [...discriminantGuardsOf(t.left), ...discriminantGuardsOf(t.right)]) {
      if (g.arm !== wantArm) continue;
      if (out.some((x) => x.name === g.name && x.key === g.key && x.value === g.value)) continue;
      out.push(g);
    }
    return out;
  }
  const g = discriminantGuardOf(test);
  return g ? [g] : [];
}

/** 判别等值守卫臂 thunk 的剪影包装（issue #126）：`((x) => THUNK)
 *  ($narrowMemberEq(x, key, value, true))`——事实臂内按守卫链式窄化（同名
 *  多键交集），异名各一影子参数。只应用 arm 匹配的守卫；任一匹配守卫名在
 *  fork 绑定集（臂内写/快照重绑）→ 全部跳过（与 nullish/typeof 剪影同一
 *  跳过口径，宁缺毋假）。keep 恒 true：守卫 arm 即「key === value」事实臂，
 *  成员过滤语义（剪 never 成员）由 $narrowMemberEq 内部裁定。 */
export function narrowDiscriminantArmThunks(
  thunk: string,
  guards: readonly DiscriminantGuard[] | undefined | null,
  arm: "cons" | "alt",
  forkBindingNames: ReadonlySet<string> | readonly string[],
): string {
  if (!guards || guards.length === 0) return thunk;
  const matching = guards.filter((g) => g.arm === arm);
  if (matching.length === 0) return thunk;
  const names =
    forkBindingNames instanceof Set ? (forkBindingNames as Set<string>) : new Set(forkBindingNames);
  if (matching.some((g) => names.has(g.name) || isStrictIllegalBinding(g.name))) return thunk;
  const byName = new Map<string, DiscriminantGuard[]>();
  for (const g of matching) {
    const list = byName.get(g.name) ?? [];
    if (!list.some((x) => x.key === g.key && x.value === g.value)) list.push(g);
    byName.set(g.name, list);
  }
  const params = [...byName.keys()].join(", ");
  const args = [...byName.entries()]
    .map(([name, gs]) =>
      gs.reduce(
        (acc, g) => `$narrowMemberEq(${acc}, ${JSON.stringify(g.key)}, ${JSON.stringify(g.value)}, true)`,
        name,
      ),
    )
    .join(", ");
  return `((${params}) => ${thunk})(${args})`;
}

// --- switch case 标签窄化（Bug 184） ---------------------------------------

/** case 标签的 prim 字面量值（string / number / boolean） */
export type CaseLabelValue = string | number | boolean;

/**
 * switch 臂的 case 标签窄化事实（Bug 184）。
 *
 * 判别式（`switch (x)` / `switch (o.kind)`）天然携带两类事实：
 * - **命中事实**：本臂的 case 标签是字面量时，判别值在本臂内**等于**该字面量
 *   （`case 1:` ⇒ 臂内 x === 1；`case null:` ⇒ 臂内 v === null）；
 * - **排除事实**：本臂**之外**的 case 标签是字面量时，判别值在本臂内**不等于**
 *   该字面量（`default:` 臂里 v !== null —— `case null` 已捕获 null）。
 *
 * 标识符判别式：命中事实以影子重绑表达（`((x) => THUNK)($lit(1))`——臂内 x
 * 恒为该字面量）；排除事实只有 **nullish** 标签可表达（$removeNull /
 * $removeUndefined / $removeNullish）——非 nullish 字面量的补集无 Abs 可表，
 * 保守放弃。
 * 成员判别式：命中 / 排除事实均走 $narrowMemberEq（keep=true / keep=false）。
 *
 * Bug 241（第二形态）：**非字面量 case 测试**（`case v === null:`）的
 * nullish 比较事实走 compareExclude——判别变量可与判别式无关
 * （`switch (true) { case v === null: … }`），故与判别名的排除事实分表。
 */
export type SwitchCaseFacts = {
  /** 判别基名（标识符判别式 = 判别标识符；成员判别式 = 成员基名） */
  name: string;
  /** 判别成员键（成员判别式 `switch (o.kind)`）；undefined = 标识符判别式 */
  key?: string;
  /** 命中事实：本臂的 case 标签 prim 字面量 */
  hit?: CaseLabelValue[];
  /** 排除事实：其它臂的 case 标签 prim 字面量（成员判别式用） */
  exclude?: CaseLabelValue[];
  /** 排除事实里的 nullish 标签粒度（标识符判别式用） */
  excludeNullish?: "null" | "undefined" | "nullish";
  /**
   * Bug 241（第二形态）：非字面量 case 测试（nullish 比较 `v === null`）
   * 的排除事实——「该测试为假」⇒ 被比较的变量不含该 nullish 粒度。
   * 判别变量名可与判别式无关（判别式是字面量 true 时）⇒ 独立于 name。
   */
  compareExclude?: { name: string; grain: "null" | "undefined" | "nullish" }[];
};

/** case 测试节点的标签事实（null / undefined / prim 字面量；其余不可判） */
type CaseLabelKind =
  | { k: "prim"; v: CaseLabelValue }
  | { k: "null" }
  | { k: "undefined" };

/** case 测试节点的标签事实（非字面量 → undefined＝不产事实） */
function caseLabelOf(node: unknown): CaseLabelKind | undefined {
  const t = node as { type?: string; name?: string };
  if (t?.type === "NullLiteral") return { k: "null" };
  if (t?.type === "Identifier" && t.name === "undefined") return { k: "undefined" };
  if (isPrimLitNode(node)) return { k: "prim", v: (node as { value: CaseLabelValue }).value };
  return undefined;
}

/** 一臂的标签事实集：prim 字面量集 + nullish 粒度 */
type ArmLabels = { prims: CaseLabelValue[]; nullish: "null" | "undefined" | "nullish" | null };

/** 收集一臂的 case 标签事实（prim 去重；null/undefined 合并粒度） */
function armLabelsOf(tests: readonly unknown[]): ArmLabels {
  const prims: CaseLabelValue[] = [];
  let nullish: "null" | "undefined" | "nullish" | null = null;
  for (const t of tests) {
    const l = caseLabelOf(t);
    if (!l) continue;
    if (l.k === "prim") {
      if (!prims.includes(l.v)) prims.push(l.v);
      continue;
    }
    if (nullish === null) nullish = l.k;
    else if (nullish !== l.k) nullish = "nullish";
  }
  return { prims, nullish };
}

/**
 * Bug 241（第二形态）：非字面量 case 测试的 **nullish 比较**事实。
 *
 * 原生 case 测试是**运行时求值的表达式**——`case v === null:` 命中的是
 * 「`v === null` 为真」那条路径（不是「判别值等于某标签」）。⇒ 该测试
 * **为假**时（miss 路径 ⇒ 落到后续臂 / default），被比较的变量**不含**该
 * nullish 粒度：`v === null` 为假 ⇒ v 不是 null（$removeNull）；`v == null`
 * 为假 ⇒ v 既非 null 也非 undefined（$removeNullish）。
 *
 * 只认**可判的否定**：负向比较（`v !== null`）的否定是「v 是 null」——
 * 无排除类 Abs 可表（保守放弃）；关系比较（`v > 0`）的否定含 NaN（NaN 与
 * 任何比较皆假）——不可健全表示（同 narrowRelArmThunk 口径）。
 */
type NullishCompare = {
  /** 被比较的变量名 */
  name: string;
  /** nullish 粒度（严格比较按 null/undefined 分粒；松散比较恒 nullish） */
  grain: "null" | "undefined" | "nullish";
  /** 负向比较（`!==` / `!=`）——命中即「不含该粒度」 */
  negated: boolean;
};

/** case 测试节点的 nullish 比较事实（`X === null` / `X == null` / …） */
function nullishCompareOf(test: unknown): NullishCompare | undefined {
  const t = test as { type?: string; operator?: string; left?: unknown; right?: unknown };
  if (t?.type !== "BinaryExpression") return undefined;
  const op = t.operator;
  if (op !== "===" && op !== "==" && op !== "!==" && op !== "!=") return undefined;
  const identOf = (n: unknown): string | undefined => {
    const x = n as { type?: string; name?: string };
    return x?.type === "Identifier" ? x.name : undefined;
  };
  const isNullLit = (n: unknown): boolean => (n as { type?: string })?.type === "NullLiteral";
  const isUndefIdent = (n: unknown): boolean => {
    const x = n as { type?: string; name?: string };
    return x?.type === "Identifier" && x.name === "undefined";
  };
  let varName: string | undefined;
  let other: unknown;
  if (identOf(t.left) !== undefined && (isNullLit(t.right) || isUndefIdent(t.right))) {
    varName = identOf(t.left);
    other = t.right;
  } else if (identOf(t.right) !== undefined && (isNullLit(t.left) || isUndefIdent(t.left))) {
    varName = identOf(t.right);
    other = t.left;
  }
  // "undefined" 是全局绑定——不可作影子重绑的变量名
  if (!varName || varName === "undefined") return undefined;
  const negated = op === "!==" || op === "!=";
  const loose = op === "==" || op === "!=";
  // 松散比较：null 与 undefined 等值（null == undefined 为真）⇒ 粒度 nullish
  const grain: NullishCompare["grain"] = loose
    ? "nullish"
    : isUndefIdent(other)
      ? "undefined"
      : "null";
  return { name: varName, grain, negated };
}

/** 一臂的 nullish 比较事实（单测试臂——多测试臂的 miss 事实是「析取」的
 *  否定，不可由单条比较推出 ⇒ 保守放弃） */
function singleNullishCompare(arm: {
  tests: readonly unknown[];
  isDefault: boolean;
}): NullishCompare | undefined {
  if (arm.isDefault) return undefined;
  if (arm.tests.length !== 1) return undefined;
  return nullishCompareOf(arm.tests[0]);
}

/**
 * Bug 241（第二形态）：判别式是**字面量 true** 时的臂事实（case 测试的
 * 否定 ⇒ miss 路径收窄）。
 *
 * - 本臂自身：负向比较（`v !== null`）命中 ⇒ 「v 不含该 nullish 粒度」
 *   （$removeNull / $removeNullish）；正向比较的命中是「v 含该粒度」——
 *   无排除类 Abs 可表 ⇒ 保守放弃；
 * - miss 路径（落到本臂 ⇒ **之前**各臂的 case 测试已求值且为假）⇒ 它们
 *   的否定事实成立（正向比较 ⇒ 「v 不含该粒度」）。
 */
function booleanDiscCaseFacts(
  arms: readonly { tests: readonly unknown[]; isDefault: boolean }[],
  i: number,
): SwitchCaseFacts | undefined {
  const cmpExclude: { name: string; grain: "null" | "undefined" | "nullish" }[] = [];
  const own = singleNullishCompare(arms[i]!);
  if (own && own.negated) cmpExclude.push({ name: own.name, grain: own.grain });
  for (let j = 0; j < i; j++) {
    const c = singleNullishCompare(arms[j]!);
    if (c && !c.negated) cmpExclude.push({ name: c.name, grain: c.grain });
  }
  if (cmpExclude.length === 0) return undefined;
  return { name: cmpExclude[0]!.name, compareExclude: cmpExclude };
}

/**
 * switch 各臂的 case 标签窄化事实（Bug 184）。
 *
 * 判别目标：标识符（`switch (x)`）或成员（`switch (o.kind)`，复用
 * memberGuardTarget 的判别身份识别）——其余形态（调用 / 计算键 / 三元）
 * 不产事实（宁缺毋假）。
 *
 * 排除集合的取法：
 * - 非 default 臂：**其它**非 default 臂的标签（贯穿路径上判别值仍是本臂的
 *   命中值 ⇒ 与其它臂的标签值互斥）；
 * - default 臂：**之前**的非 default 臂的标签（default 之后的臂可被贯穿
 *   进入——那条路径上判别值可能是它们的标签值 ⇒ 不可排除）。
 */
export function switchCaseFacts(
  discriminant: unknown,
  arms: readonly { tests: readonly unknown[]; isDefault: boolean }[],
): (SwitchCaseFacts | undefined)[] {
  const disc = discriminant as { type?: string; name?: string; value?: unknown };
  // Bug 241（第二形态）：判别式是**字面量 true** + 非字面量 case 测试
  // （`case v === null:`）——臂事实来自 case 测试的**否定**（miss 路径
  // 收窄）：判别值是布尔 true 且 case 测试是布尔值时，「该臂未命中」⟺
  // 「该测试为假」⇒ 落到后续臂 / default 的路径上，被比较的变量不含该
  // nullish 粒度。判别值是其它值时「未命中」不蕴含「测试为假」⇒ 不产事实。
  if (disc?.type === "BooleanLiteral" && disc.value === true) {
    return arms.map((_arm, i) => booleanDiscCaseFacts(arms, i));
  }
  let name: string;
  let key: string | undefined;
  if (disc?.type === "Identifier" && disc.name) {
    name = disc.name;
  } else {
    const m = memberGuardTarget(discriminant);
    if (!m) return arms.map(() => undefined);
    name = m.name;
    key = m.key;
  }
  const labels = arms.map((a) => armLabelsOf(a.tests));
  return arms.map((arm, i) => {
    const mine = labels[i]!;
    const exclPrim: CaseLabelValue[] = [];
    let exclNullish: "null" | "undefined" | "nullish" | null = null;
    for (let j = 0; j < arms.length; j++) {
      if (j === i) continue;
      const other = arms[j]!;
      if (other.isDefault) continue;
      // default 臂只排除**之前**的臂（之后的臂可被贯穿进入）
      if (arm.isDefault && j > i) continue;
      const l = labels[j]!;
      for (const p of l.prims) {
        if (mine.prims.includes(p)) continue;
        if (!exclPrim.includes(p)) exclPrim.push(p);
      }
      if (l.nullish) {
        exclNullish = exclNullish === null ? l.nullish : exclNullish === l.nullish ? exclNullish : "nullish";
      }
    }
    const facts: SwitchCaseFacts = { name };
    if (key !== undefined) facts.key = key;
    // 命中事实：仅非 default 臂（default 臂无标签 ⇒ 无命中值）
    // 成员判别式的多标签臂（case "a": case "b": 共享体）——$narrowMemberEq
    // 的 keep=true 是**单值**语义（链式多值 = 交集 ⇒ 剪空后原样返回），
    // 保守放弃多标签臂的命中窄化。
    if (!arm.isDefault && mine.prims.length > 0 && (key === undefined || mine.prims.length === 1)) {
      facts.hit = [...mine.prims];
    }
    if (key !== undefined) {
      if (exclPrim.length > 0) facts.exclude = exclPrim;
    } else if (exclNullish) {
      facts.excludeNullish = exclNullish;
    }
    return facts;
  });
}

/**
 * case 标签窄化在臂体上的应用（Bug 184）。
 *
 * 标识符判别式：命中事实 → 影子重绑为该字面量（`$lit(1)` / 多标签 `$join`）；
 * 排除事实（nullish）→ `$removeNull` / `$removeUndefined` / `$removeNullish`
 * 影子重绑。成员判别式：命中 → `$narrowMemberEq(..., true)`；排除 →
 * `$narrowMemberEq(..., false)`（剪掉 key 值域恰为该字面量的成员）。
 *
 * 跳过口径与既有窄化通道一致：判别名在 fork 绑定集（臂内写 / 快照重绑）时
 * 跳过（影子参数会吞掉臂内写）；strict 非法绑定名（arguments / eval）跳过。
 *
 * Bug 241（第二形态）：非字面量 case 测试的 nullish 比较事实
 * （facts.compareExclude）——判别变量名可与判别式无关，各自独立跳过口径。
 */
export function narrowCaseLabelArmThunk(
  thunk: string,
  facts: SwitchCaseFacts | undefined,
  forkBindingNames: ReadonlySet<string> | readonly string[],
): string {
  if (!facts) return thunk;
  const names =
    forkBindingNames instanceof Set ? (forkBindingNames as Set<string>) : new Set(forkBindingNames);
  let out = thunk;
  // 判别名窄化（既有口径）：判别名在 fork 绑定集（臂内写 / 快照重绑）时跳过
  if (!(names.has(facts.name) || isStrictIllegalBinding(facts.name))) {
    if (facts.key !== undefined) {
      // 成员判别式：排除（keep=false）在内、命中（keep=true）在外
      for (const v of facts.exclude ?? []) {
        out = `((${facts.name}) => ${out})($narrowMemberEq(${facts.name}, ${JSON.stringify(facts.key)}, ${JSON.stringify(v)}, false))`;
      }
      for (const v of facts.hit ?? []) {
        out = `((${facts.name}) => ${out})($narrowMemberEq(${facts.name}, ${JSON.stringify(facts.key)}, ${JSON.stringify(v)}, true))`;
      }
    } else {
      if (facts.excludeNullish) {
        const call =
          facts.excludeNullish === "null" ? "$removeNull" :
          facts.excludeNullish === "undefined" ? "$removeUndefined" :
          "$removeNullish";
        out = `((${facts.name}) => ${out})(${call}(${facts.name}))`;
      }
      const hit = facts.hit ?? [];
      if (hit.length > 0) {
        const lits = hit.map((v) => `$lit(${JSON.stringify(v)})`);
        const arg = lits.length === 1 ? lits[0]! : lits.reduce((acc, l) => `$join(${acc}, ${l})`);
        out = `((${facts.name}) => ${out})(${arg})`;
      }
    }
  }
  // Bug 241（第二形态）：case 测试的 nullish 比较事实（miss 路径收窄）——
  // 变量名与判别式无关 ⇒ 各自独立判跳过（影子参数会吞掉臂内写）
  for (const c of facts.compareExclude ?? []) {
    if (names.has(c.name) || isStrictIllegalBinding(c.name)) continue;
    const call =
      c.grain === "null" ? "$removeNull" :
      c.grain === "undefined" ? "$removeUndefined" :
      "$removeNullish";
    out = `((${c.name}) => ${out})(${call}(${c.name}))`;
  }
  return out;
}

// --- 关系守卫（Bug 1）-----------------------------------------------------

/**
 * 关系守卫（Bug 1）：`x >= 0` / `0 < x`（标识符 × 数字字面量，matchRelIdentLit
 * 同一匹配面）→ 事实臂（cons）内以 $refineRel 影子重绑——守卫建立的隐含
 * 约束随**普通变量读取**进入返回 Abs（此前只有算术折叠消费 exec Φ，
 * `x + 0` 携带界而裸 `return x` 丢守卫事实 → return-constraint gate 假阳）。
 * 补集臂（¬x≥0）含 NaN 可能（NaN 与任何比较皆假），不可健全表示 → 不窄化。
 */
export type RelGuard = {
  /** 被守卫的标识符 */
  name: string;
  /** 关系（含翻转后的 `3 < x` → gt） */
  op: "gt" | "ge" | "lt" | "le";
  /** 字面量界 */
  k: number;
};

export function relGuardOf(test: unknown): RelGuard | undefined {
  return matchRelIdentLit(test);
}

/** 关系守卫臂 thunk 的剪影包装：`((x) => THUNK)($refineRel(x, "ge", 0))`——
 *  仅事实臂；守卫名在 fork 绑定集（臂内写/快照重绑）时跳过（与 nullish/
 *  typeof/判别剪影同一跳过口径，宁缺毋假：影子参数会吞掉臂内写）。 */
export function narrowRelArmThunk(
  thunk: string,
  guard: RelGuard | undefined,
  arm: "cons" | "alt",
  forkBindingNames: ReadonlySet<string> | readonly string[],
): string {
  if (!guard || arm !== "cons") return thunk;
  const names =
    forkBindingNames instanceof Set ? (forkBindingNames as Set<string>) : new Set(forkBindingNames);
  if (names.has(guard.name) || isStrictIllegalBinding(guard.name)) return thunk;
  return `((${guard.name}) => ${thunk})($refineRel(${guard.name}, ${JSON.stringify(guard.op)}, ${guard.k}))`;
}
