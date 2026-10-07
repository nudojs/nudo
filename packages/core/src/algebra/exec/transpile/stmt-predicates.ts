/**
 * 语句控制流谓词（leaf）：与 transpile 主递归解耦，便于单测与拆文件。
 */
import type { Statement, Node } from "@babel/types";
import { indent } from "./helpers.ts";

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
    default:
      return false;
  }
}

/** 语句或块内是否出现 return/throw（决定 if 是否提升为 return $fork） */
export function stmtReturns(stmt: Statement): boolean {
  if (stmt.type === "ReturnStatement" || stmt.type === "ThrowStatement") return true;
  if (stmt.type === "BlockStatement") return stmt.body.some(stmtReturns);
  if (stmt.type === "IfStatement") {
    return stmtReturns(stmt.consequent) && stmt.alternate != null && stmtReturns(stmt.alternate);
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
   * 槽值剥 nullish）。只做单层；嵌套路径 / 计算键不识别。
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
 * StringLiteral 值。
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
  if (m.computed) return undefined;
  if (m.object?.type !== "Identifier" || !m.object.name) return undefined;
  const p = m.property;
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

/**
 * 测试表达式的**全部**独立 nullish 守卫事实（issue #118 v3 / #120 多名
 * 复合）。单（非复合）测试式 → nullishGuardOf 单守卫；LogicalExpression
 * 同方向递归展开：`||` 收各析取项的穿透臂（alt）事实——整体假 = 各项皆
 * 假，各项事实独立成立（`obj == null || node.property == null` 的穿透臂
 * 里 obj 与 node.property 双双非 nullish）；`&&` 收各合取项的成立臂
 * （cons）事实。同名同臂合并粒度、异键保首；异方向子式（`||` 内嵌 `&&`）
 * 的单侧真假不传播事实——递归结果按臂过滤后自然丢弃。单守卫 API
 * nullishGuardOf 对异名复合仍保守 undefined（历史语义），多名收窄一律
 * 走本入口。
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
  return g ? [g] : [];
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
  if (matching.some((g) => names.has(g.name))) return thunk;
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
  if (names.has(guard.name)) return thunk;
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
  if (matching.some((g) => names.has(g.name))) return thunk;
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
