/** nullish / truthy 守卫识别与臂 thunk。 */
import { narrowArmShadowWrap } from "./narrow-arm.ts";

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

export const TYPEOF_NAMES = new Set([
  "undefined", "object", "boolean", "number", "string", "function", "symbol", "bigint",
]);

export const isStrLitNode = (n: unknown): n is { value: string } => {
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

/** `typeof` 守卫目标（BUG-291）：标识符或单层成员（`typeof o.v`）。
 *  成员形态复用 memberGuardTarget 的单层静态/数值下标识别。 */
export const typeofTargetOf = (n: unknown): { name: string; key?: string } | undefined => {
  const t = n as { type?: string; operator?: string; argument?: unknown };
  if (t?.type !== "UnaryExpression" || t.operator !== "typeof") return undefined;
  const arg = t.argument as { type?: string; name?: string };
  if (arg?.type === "Identifier" && arg.name) return { name: arg.name };
  const m = memberGuardTarget(t.argument);
  return m ? { name: m.name, key: m.key } : undefined;
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
export const memberGuardTarget = (n: unknown): { name: string; key: string } | undefined => {
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
 *
 * `undefinedIsIntrinsic = false`（本单元内 `undefined` 被用户绑定遮蔽）：
 * AST 标识符 `undefined` 是普通绑定值（如 `const undefined = 5`）——不作为
 * nullish 字面量识别（宽松/严格、左右任一位置皆同）。`typeof x ===
 * "undefined"` 是字符串字面量，不受影响。
 */
export function nullishGuardOf(
  test: unknown,
  undefinedIsIntrinsic = true,
): NullishGuard | undefined {
  const t = test as {
    type?: string;
    operator?: string;
    left?: unknown;
    right?: unknown;
    argument?: { type?: string; name?: string };
    name?: string;
  };
  if (t?.type === "LogicalExpression") return compositeNullishGuardOf(t, undefinedIsIntrinsic);
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
    // 遮蔽的 `undefined` 是普通绑定（如 `const undefined = 5`）⇒ 比较值不是
    // nullish 字面量，不产守卫事实（宁缺毋假）。
    const isUndef = undefinedIsIntrinsic && ln?.name === "undefined";
    if (!isNull && !isUndef) return undefined;
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
      return ln?.type === "NullLiteral" || (undefinedIsIntrinsic && ln?.name === "undefined");
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
function compositeNullishGuardOf(
  test: unknown,
  undefinedIsIntrinsic = true,
): NullishGuard | undefined {
  const t = test as { type?: string; operator?: string; left?: unknown; right?: unknown };
  if (t?.type !== "LogicalExpression" || (t.operator !== "||" && t.operator !== "&&")) return undefined;
  const wantArm = t.operator === "||" ? "alt" : "cons";
  const l = nullishGuardOf(t.left, undefinedIsIntrinsic);
  const r = nullishGuardOf(t.right, undefinedIsIntrinsic);
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
export function nullishGuardsOf(test: unknown, undefinedIsIntrinsic = true): NullishGuard[] {
  const t = test as { type?: string; operator?: string; left?: unknown; right?: unknown };
  if (t?.type === "LogicalExpression" && (t.operator === "||" || t.operator === "&&")) {
    const wantArm: "cons" | "alt" = t.operator === "||" ? "alt" : "cons";
    const out: NullishGuard[] = [];
    for (const g of [
      ...nullishGuardsOf(t.left, undefinedIsIntrinsic),
      ...nullishGuardsOf(t.right, undefinedIsIntrinsic),
    ]) {
      if (g.arm !== wantArm) continue;
      mergeGuardInto(out, g);
    }
    return out;
  }
  const g = nullishGuardOf(test, undefinedIsIntrinsic);
  const out: NullishGuard[] = g ? [g] : [];
  appendReceiverGuards(test, out);
  return out;
}

/**
 * 类型守卫事实（Bug 23 / BUG-282 / BUG-290 / BUG-291）：
 * - typeof 二元式：`typeof v === "string"`（`===` → cons，`!==` → alt），
 *   目标可为标识符或单层成员（`typeof o.v`，memberKey）；
 * - `in` 运算符（BUG-290）：`"a" in o`（cons）——inKey = 键名；
 * - 用户定义类型谓词调用（BUG-282）：`isStr(x)`（cons）——typeOf = 谓词
 *   声明的 typeof 名（`x is string`；只认 typeof 可表的目标类型）；
 * - 以上任一形态的 `!` 取反 → arm 对调。
 * "undefined" 交由 nullishGuardOf 的 grain 通道处理（同一表达式不得双守卫），
 * typeof 形态不认。
 */

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

/** 臂窄化影子重绑的一个形参槽：name = 影子参数名（兼跳过检查的守卫名），
 *  arg = 重绑实参表达式（$removeNullish / $narrowTypeOf / $narrowMemberEq /
 *  $lit / $join / $refineRel 调用串，由各通道构造）。 */


/** 臂窄化影子重绑骨架（五联臂单源：nullish / typeof / 判别等值 / case
 *  标签 / 关系守卫共用）：任一影子名在 fork 绑定集（臂内写 / 快照重绑
 *  ——影子参数会吞掉臂内写，破坏 forkJoin 的绑定 join）或为 strict 非法
 *  绑定名（arguments / eval，Bug 116——strict 代码不能作形参名，影子
 *  包装会令整模块 new Function 编译期 SyntaxError）→ 整体跳过（宁缺毋
 *  假，不做部分应用）；否则按 mode 发射影子重绑：
 *  - multi：多名一包 `((a, b) => THUNK)($rmA, $rmB)`（nullish / typeof /
 *    判别等值通道——全部事实同层生效）；
 *  - seq：逐名嵌套 `((a) => ((b) => THUNK)(y))(x)`（首元素最内层，保持
 *    case 标签「排除在内、命中在外」与关系「主界在内、extra 界在外」的
 *    既有内外层序）。
 *  bindings 为空（无事实）时原样返回 thunk。 */


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
  return narrowArmShadowWrap(
    thunk,
    matching.map((g) => ({ name: g.name, arg: nullishRemoveCallOf(g) })),
    forkBindingNames,
    "multi",
  );
}

/** TypeGuard → 运行时窄化调用串（typeof 标识符 / typeof 成员 / in）。 */
