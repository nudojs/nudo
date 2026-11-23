/** switch case 标签窄化事实与臂 thunk。 */
import { narrowArmShadowWrap, type ArmShadowBinding } from "./narrow-arm.ts";
import { isPrimLitNode } from "./predicates-discriminant.ts";
import { TYPEOF_NAMES, memberGuardTarget, typeofTargetOf } from "./predicates-nullish.ts";

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
  /**
   * BUG-363：`switch (typeof x)` / `switch (typeof o.v)` 的 typeof 事实——
   * case 标签是 typeof 结果名（"string" / "number" / …）。命中 = 本臂标签
   * （单标签臂才产）；排除 = 其它臂的标签。应用时走 `$narrowTypeOf`
   * （`key` 在场则收窄成员槽）。
   */
  typeOfHit?: string;
  typeOfExclude?: string[];
};

/** case 测试节点的标签事实（null / undefined / prim 字面量；其余不可判） */
type CaseLabelKind =
  | { k: "prim"; v: CaseLabelValue }
  | { k: "null" }
  | { k: "undefined" };

/** case 测试节点的标签事实（非字面量 → undefined＝不产事实） */
function caseLabelOf(node: unknown, undefinedIsIntrinsic = true): CaseLabelKind | undefined {
  const t = node as { type?: string; name?: string };
  if (t?.type === "NullLiteral") return { k: "null" };
  // 遮蔽的 `undefined`（`const undefined = 5`）是普通绑定 ⇒ case 标签是绑定值
  // （如 5），不是 undefined 字面量。
  if (undefinedIsIntrinsic && t?.type === "Identifier" && t.name === "undefined") return { k: "undefined" };
  if (isPrimLitNode(node)) return { k: "prim", v: (node as { value: CaseLabelValue }).value };
  return undefined;
}

/**
 * 一臂的标签事实集：prim 字面量集 + nullish 粒度 + 「是否全是原始字面量」。
 *
 * Bug 1117：`allLiteral` = 本臂的**每个** case 测试都是原始字面量
 * （prim / null / undefined）。共享体的多标签臂（`case null: case "ab":`）
 * 与含**非字面量**测试的臂（`case v === null: case "ab":`）都 ⇒ 命中值
 * **不唯一** ⇒ 不得按 prim 标签单值重绑（否则把 null 那条路径重绑成
 * "ab" ⇒ `null.length` 本该抛 TypeError 却读出 2 ⇒ L2 may-throw 消失）。
 */
type ArmLabels = {
  prims: CaseLabelValue[];
  nullish: "null" | "undefined" | "nullish" | null;
  /** 本臂的 case 测试**全部**是原始字面量（prim / null / undefined） */
  allLiteral: boolean;
};

/** 收集一臂的 case 标签事实（prim 去重；null/undefined 合并粒度） */
function armLabelsOf(tests: readonly unknown[], undefinedIsIntrinsic = true): ArmLabels {
  const prims: CaseLabelValue[] = [];
  let nullish: "null" | "undefined" | "nullish" | null = null;
  let allLiteral = true;
  for (const t of tests) {
    const l = caseLabelOf(t, undefinedIsIntrinsic);
    if (!l) {
      // 非字面量测试（`case v === null:`）⇒ 该臂的命中值不可由标签确定
      allLiteral = false;
      continue;
    }
    if (l.k === "prim") {
      if (!prims.includes(l.v)) prims.push(l.v);
      continue;
    }
    if (nullish === null) nullish = l.k;
    else if (nullish !== l.k) nullish = "nullish";
  }
  return { prims, nullish, allLiteral };
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
function nullishCompareOf(test: unknown, undefinedIsIntrinsic = true): NullishCompare | undefined {
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
    if (!undefinedIsIntrinsic) return false;
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
}, undefinedIsIntrinsic = true): NullishCompare | undefined {
  if (arm.isDefault) return undefined;
  if (arm.tests.length !== 1) return undefined;
  return nullishCompareOf(arm.tests[0], undefinedIsIntrinsic);
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
  undefinedIsIntrinsic = true,
): SwitchCaseFacts | undefined {
  const cmpExclude: { name: string; grain: "null" | "undefined" | "nullish" }[] = [];
  const own = singleNullishCompare(arms[i]!, undefinedIsIntrinsic);
  if (own && own.negated) cmpExclude.push({ name: own.name, grain: own.grain });
  for (let j = 0; j < i; j++) {
    const c = singleNullishCompare(arms[j]!, undefinedIsIntrinsic);
    if (c && !c.negated) cmpExclude.push({ name: c.name, grain: c.grain });
  }
  if (cmpExclude.length === 0) return undefined;
  return { name: cmpExclude[0]!.name, compareExclude: cmpExclude };
}

/**
 * BUG-363：`switch (typeof x)` 各臂的 typeof 事实。case 标签是 typeof 结果
 * 名（TYPEOF_NAMES）；非 typeof 标签不参与。命中事实只在该臂**所有**测试
 * 都是 typeof 标签且标签唯一时产生（多标签 = 并集，单值 `$narrowTypeOf`
 * 表达不了）；排除事实按既有 case 标签排除口径（非 default 臂排其它非
 * default 臂、default 臂只排之前臂）。
 */
function typeofSwitchCaseFacts(
  target: { name: string; key?: string },
  arms: readonly { tests: readonly unknown[]; isDefault: boolean }[],
  undefinedIsIntrinsic = true,
): (SwitchCaseFacts | undefined)[] {
  const typeofLabelOf = (n: unknown): string | undefined => {
    const l = caseLabelOf(n, undefinedIsIntrinsic);
    return l?.k === "prim" && typeof l.v === "string" && TYPEOF_NAMES.has(l.v) ? l.v : undefined;
  };
  const labels = arms.map((a) => a.tests.map(typeofLabelOf));
  return arms.map((arm, i) => {
    const mine = labels[i]!.filter((v): v is string => v !== undefined);
    const excl: string[] = [];
    for (let j = 0; j < arms.length; j++) {
      if (j === i) continue;
      const other = arms[j]!;
      if (other.isDefault) continue;
      if (arm.isDefault && j > i) continue;
      for (const v of labels[j]!) {
        if (v === undefined || mine.includes(v)) continue;
        if (!excl.includes(v)) excl.push(v);
      }
    }
    const facts: SwitchCaseFacts = { name: target.name };
    if (target.key !== undefined) facts.key = target.key;
    const uniq = [...new Set(mine)];
    const allTypeof = arm.tests.length > 0 && labels[i]!.every((v) => v !== undefined);
    if (!arm.isDefault && allTypeof && uniq.length === 1) facts.typeOfHit = uniq[0]!;
    if (excl.length > 0) facts.typeOfExclude = excl;
    return facts;
  });
}

/**
 * switch 各臂的 case 标签窄化事实（Bug 184）。
 *
 * 判别目标：标识符（`switch (x)`）或成员（`switch (o.kind)`，复用
 * memberGuardTarget 的判别身份识别）——其余形态（调用 / 计算键 / 三元）
 * 不产事实（宁缺毋假）。`switch (typeof x)` / `switch (typeof o.v)`
 * （BUG-363）走 typeofSwitchCaseFacts。
 *
 * 排除集合的取法：
 * - 非 default 臂：**其它**非 default 臂的标签（贯穿路径上判别值仍是本臂的
 *   命中值 ⇒ 与其它臂的标签值互斥）；
 * - default 臂：**之前**的非 default 臂的标签（default 之后的臂可被贯穿
 *   进入——那条路径上判别值可能是它们的标签值 ⇒ 不可排除）。
 *
 * `undefinedIsIntrinsic = false`（`undefined` 被用户绑定遮蔽）：`case
 * undefined:` 是普通表达式（比较绑定值，如 5），不产 undefined 标签事实；
 * `case v === undefined:` 同理不产 nullish 比较事实。
 */
export function switchCaseFacts(
  discriminant: unknown,
  arms: readonly { tests: readonly unknown[]; isDefault: boolean }[],
  undefinedIsIntrinsic = true,
): (SwitchCaseFacts | undefined)[] {
  const disc = discriminant as { type?: string; name?: string; value?: unknown };
  // Bug 241（第二形态）：判别式是**字面量 true** + 非字面量 case 测试
  // （`case v === null:`）——臂事实来自 case 测试的**否定**（miss 路径
  // 收窄）：判别值是布尔 true 且 case 测试是布尔值时，「该臂未命中」⟺
  // 「该测试为假」⇒ 落到后续臂 / default 的路径上，被比较的变量不含该
  // nullish 粒度。判别值是其它值时「未命中」不蕴含「测试为假」⇒ 不产事实。
  if (disc?.type === "BooleanLiteral" && disc.value === true) {
    return arms.map((_arm, i) => booleanDiscCaseFacts(arms, i, undefinedIsIntrinsic));
  }
  // BUG-363：`switch (typeof x)` —— 判别式是 UnaryExpression typeof
  const typeOfTarget = typeofTargetOf(discriminant);
  if (typeOfTarget) return typeofSwitchCaseFacts(typeOfTarget, arms, undefinedIsIntrinsic);
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
  const labels = arms.map((a) => armLabelsOf(a.tests, undefinedIsIntrinsic));
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
    //
    // Bug 1117：**同体的所有标签都必须是原始字面量**才谈得上「命中值」：
    // - `case null: case "ab":` 共享一个体 ⇒ 命中值可能是 null **或** "ab"
    //   ⇒ 只按 prim 标签单值重绑会把 null 那条路径重绑成 "ab"
    //   （`const x = null; switch (x) { case null: case "ab": return x.length; }`
    //   原生抛 TypeError，引擎却按 "ab" 读出 2 ⇒ L2 may-throw 消失 = 假绿）。
    // - `case v === null: case "ab":` 含**非字面量**测试 ⇒ 命中值不可由标签确定
    //   （原生命中的是「测试为真」那条路径）。
    // ⇒ 这两类臂**不产命中事实**（宁缺毋假）。
    //
    // 成员判别式的多标签臂（case "a": case "b": 共享体）——$narrowMemberEq
    // 的 keep=true 是**单值**语义（链式多值 = 交集 ⇒ 剪空后原样返回），
    // 保守放弃多标签臂的命中窄化。
    if (
      !arm.isDefault &&
      mine.allLiteral &&
      mine.nullish === null &&
      mine.prims.length > 0 &&
      (key === undefined || mine.prims.length === 1)
    ) {
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
  let out = thunk;
  // BUG-363：`switch (typeof x)` 的 typeof 事实——排除（keep=false）在内、
  // 命中（keep=true）在外；成员判别式（`switch (typeof o.v)`）带 key 收窄槽。
  const hasTypeOfFacts =
    facts.typeOfHit !== undefined || (facts.typeOfExclude?.length ?? 0) > 0;
  if (hasTypeOfFacts) {
    const typeOfBindings: ArmShadowBinding[] = [];
    const callOf = (t: string, keep: boolean): string =>
      facts.key !== undefined
        ? `$narrowTypeOf(${facts.name}, ${JSON.stringify(t)}, ${keep}, ${JSON.stringify(facts.key)})`
        : `$narrowTypeOf(${facts.name}, ${JSON.stringify(t)}, ${keep})`;
    for (const t of facts.typeOfExclude ?? []) {
      typeOfBindings.push({ name: facts.name, arg: callOf(t, false) });
    }
    if (facts.typeOfHit !== undefined) {
      typeOfBindings.push({ name: facts.name, arg: callOf(facts.typeOfHit, true) });
    }
    out = narrowArmShadowWrap(out, typeOfBindings, forkBindingNames, "seq");
  } else if (facts.key !== undefined) {
    // 成员判别式：排除（keep=false）在内、命中（keep=true）在外
    const memberBindings: ArmShadowBinding[] = [];
    for (const v of facts.exclude ?? []) {
      memberBindings.push({
        name: facts.name,
        arg: `$narrowMemberEq(${facts.name}, ${JSON.stringify(facts.key)}, ${JSON.stringify(v)}, false)`,
      });
    }
    for (const v of facts.hit ?? []) {
      memberBindings.push({
        name: facts.name,
        arg: `$narrowMemberEq(${facts.name}, ${JSON.stringify(facts.key)}, ${JSON.stringify(v)}, true)`,
      });
    }
    out = narrowArmShadowWrap(out, memberBindings, forkBindingNames, "seq");
  } else {
    const identBindings: ArmShadowBinding[] = [];
    if (facts.excludeNullish) {
      const call =
        facts.excludeNullish === "null" ? "$removeNull" :
        facts.excludeNullish === "undefined" ? "$removeUndefined" :
        "$removeNullish";
      identBindings.push({ name: facts.name, arg: `${call}(${facts.name})` });
    }
    const hit = facts.hit ?? [];
    if (hit.length > 0) {
      // Bug 1117（P2）：`case 0:` 命中的是 `x === 0` ⇒ 值域含 **-0**
      // （`-0 === 0` 为真，但 `-0 !== 0`）⇒ 直接重绑 `$lit(0)` 会把 -0
      // 改成 +0（`const x = -0; switch (x) { case 0: return 1 / x; }`
      // 原生是 -Infinity，引擎算成 Infinity = **自信的错值**）⇒ 数值 0 的
      // 标签按**交集细化** `{0, -0}`（`$join($lit(0), $lit(-0))`），
      // 不改写成单值。
      const lits: string[] = [];
      for (const v of hit) {
        if (typeof v === "number" && v === 0) {
          lits.push("$lit(0)", "$lit(-0)");
          continue;
        }
        lits.push(`$lit(${JSON.stringify(v)})`);
      }
      const arg = lits.length === 1 ? lits[0]! : lits.reduce((acc, l) => `$join(${acc}, ${l})`);
      identBindings.push({ name: facts.name, arg });
    }
    out = narrowArmShadowWrap(out, identBindings, forkBindingNames, "seq");
  }
  // Bug 241（第二形态）：case 测试的 nullish 比较事实（miss 路径收窄）——
  // 变量名与判别式无关 ⇒ 各自独立判跳过（影子参数会吞掉臂内写）
  for (const c of facts.compareExclude ?? []) {
    const call =
      c.grain === "null" ? "$removeNull" :
      c.grain === "undefined" ? "$removeUndefined" :
      "$removeNullish";
    out = narrowArmShadowWrap(out, [{ name: c.name, arg: `${call}(${c.name})` }], forkBindingNames, "seq");
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




/**
 * 否定测试（`!(R…)`）的**否定臂**事实（issue #185）：`!(A ∧ …)` 为**假**
 * ⇒ `A ∧ …` 为真（布尔取反是精确的，NaN 无关）⇒ 每个关系合取项都成立。
 *
 * 与裸关系守卫的补集**不同**：`¬(x < k)` 只断得 `x ≥ k ∨ x is NaN`
 * （Bug 1115，不可断言 `x ≥ k`）；而 `!(x < k)` 为假 ⇒ `x < k` 为真
 * ⇒ 事实精确、NaN 不可达。故该事实集只允许用于「测试为假」的臂
 * （else / early-return 后续路径 / `||` 右臂）——见
 * `narrowRelNegationArmThunk`。
 */


/** 关系守卫事实集 → 影子重绑槽（主界在内、其余界按序在外；seq 嵌套顺序
 *  与既有「主界最内」口径一致）。 */


/** 关系守卫臂 thunk 的剪影包装：`((x) => THUNK)($refineRel(x, "ge", 0))`——
 *  仅事实臂；守卫名在 fork 绑定集（臂内写/快照重绑）时跳过（与 nullish/
 *  typeof/判别剪影同一跳过口径，宁缺毋假：影子参数会吞掉臂内写）。 */


/** **否定臂**关系剪影（`relGuardOfNegation` 派生的事实集，issue #185）：
 *  只用于测试为假的臂（else / early-return 后续路径 / `||` 右臂）——
 *  `!(A ∧ …)` 为假 ⇒ 每个关系合取项为真，断言健全（见
 *  `relGuardOfNegation`）。不可拿来处理裸关系守卫的补集（NaN 面）。 */


/**
 * 关系守卫**补集**臂的事实集（issue #185 + 契约 `number().finite()`）。
 *
 * `¬(x < k)` / `¬(x < k ∨ y < m)` 的后续路径：
 * - 单一关系 `x < k` 为假 ⇒ 候选事实 `x ≥ k`；
 * - 析取 `A ∨ B` 为假 ⇒ `¬A ∧ ¬B`，每个**裸关系**析取项都可独立断言；
 * - 合取 `A ∧ B`（`composite`）**不在内**：`¬(A ∧ B)` 是析取，不是单一事实。
 *
 * 这里只收集候选事实；是否真正收紧由运行时 `$refineRelComplement` 按
 * `isNonNaN` 判定（缺证据原样返回，Bug 1115 的假绿红线不变）。
 */


/** `||` 链上的裸关系析取项；任一项不是单关系（合取 / 别的表达式）⇒ 放弃整条 */


/**
 * 关系守卫**补集**臂剪影（issue #185 + 契约 `number().finite()`）：
 * `if (x < k) return …;` 的后续路径 / `x < k ? a : b` 的 else 臂在 `x` 可证
 * **非 NaN** 时断言 `x ≥ k`；`A ∨ B` 形态逐项断言。
 *
 * 转译器只负责发射调用：是否真正收紧由运行时 `$refineRelComplement` 按
 * `isNonNaN` 判定（拿不到 Abs 的语法层不得自行决定，缺证据即原样返回）。
 * 合取守卫不在内（`¬(A ∧ B)` 是析取，不是单一事实）。
 */


// --- NaN 守卫（issue #185 残余） ------------------------------------------

/**
 * NaN 守卫：测试为真是否意味着「该值是 NaN」。
 *
 * 可识别形态（严格、无强制转换）：
 * - `Number.isNaN(x)`（truthy ⇒ NaN）
 * - `x !== x`（truthy ⇒ NaN；NaN 是唯一 `!==` 自身的值）
 * - `x === x`（truthy ⇒ 非 NaN）
 * - 以上任意一项的 `!` 取反（truthy 语义翻转）
 *
 * `isNaN(x)`（全局，会强制转换）与 `x != x`（宽松，ToPrimitive 可返回 NaN）
 * **不识别**：truthy 不保证 `x` 自身是 NaN。补集侧只加 `ne(x, NaN)`，
 * 因此只消费「非 NaN」那一臂；NaN 那一臂保持不剪影（宁缺毋假）。
 */




/**
 * NaN 守卫的**非 NaN 臂**剪影：`Number.isNaN(x) === false` / `x === x` 成立
 * ⇒ `$refineNotNaN(x)`（挂 `ne(x, NaN)`），供关系补集与内建判定采信。
 * 另一臂（x 确为 NaN）不剪影——`$refineNotNaN` 没有对偶事实。
 */
