/**
 * 关系 / NaN 守卫与补集事实。
 *
 * 从 predicates.ts 抽出；影子重绑骨架复用 narrow-arm。
 */
import { matchRelIdentLit, matchRelIdentLitComposite } from "../../../arithmetic.ts";
import { narrowArmShadowWrap, type ArmShadowBinding } from "./narrow-arm.ts";

export type RelGuard = {
  /** 被守卫的标识符 */
  name: string;
  /** 关系（含翻转后的 `3 < x` → gt） */
  op: "gt" | "ge" | "lt" | "le";
  /** 字面量界 */
  k: number;
  /**
   * **复合**关系式（合取 `x > 0 && x < 10`）派生的守卫（族 60 · 第 4 条）。
   *
   * 合取为真 ⇒ 每一合取项为真 ⇒ **事实臂**接守卫可靠；
   * 但 `¬(A ∧ B)` = `¬A ∨ ¬B` **不是**单一关系 ⇒ **补集方向**
   * （后续路径 / else 臂）**不可**用它 ⇒ 消费方
   * （`narrowRelComplementArmThunk`）**必须**跳过 `composite: true` 的守卫，
   * 否则会在「测试为假」的路径上断言 `¬A`（**假绿**）。
   */
  composite?: boolean;
  /**
   * 复合守卫的**其余**合取项界（**同名**变量；事实臂一并接上）。
   * `x > 0 && x < 10` ⇒ 主界 `x > 0` + 其余界 `x < 10`
   * （事实臂同时持有两个界 ⇒ 契约朝任一方向都能证得）。
   */
  extra?: Array<{ op: "gt" | "ge" | "lt" | "le"; k: number }>;
  /**
   * 复合守卫的其余合取项界（**异名**变量；只用于**事实臂**）。
   * `x >= 1 && y >= 2` ⇒ 主守卫 `x` + `others: [{ name: "y", … }]`——
   * 合取为真 ⇒ 每一项为真 ⇒ 事实臂同时持有全部名字的界（issue #185：
   * 旧实现只留先到的一个名字 ⇒ `x + y` 只折一侧 ⇒ 合取守卫下的和契约
   * 证不出）。补集方向与 `composite` 同禁（`¬(A ∧ B)` 不是单事实）。
   */
  others?: Array<{ name: string; op: "gt" | "ge" | "lt" | "le"; k: number }>;
};

export function relGuardOf(test: unknown): RelGuard | undefined {
  // 单一关系式优先（行为逐字不变）；复合式（合取）才走复合匹配。
  return matchRelIdentLit(test) ?? matchRelIdentLitComposite(test);
}

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
export function relGuardOfNegation(test: unknown): RelGuard | undefined {
  const t = test as { type?: string; operator?: string; argument?: unknown } | null | undefined;
  if (t?.type !== "UnaryExpression" || t.operator !== "!" || t.argument == null) return undefined;
  return relGuardOf(t.argument);
}

/** 关系守卫事实集 → 影子重绑槽（主界在内、其余界按序在外；seq 嵌套顺序
 *  与既有「主界最内」口径一致）。 */
function relGuardBindings(guard: RelGuard): ArmShadowBinding[] {
  const facts = [
    { name: guard.name, op: guard.op, k: guard.k },
    ...(guard.extra ?? []).map((b) => ({ name: guard.name, op: b.op, k: b.k })),
    ...(guard.others ?? []),
  ];
  return facts.map((f) => ({
    name: f.name,
    arg: `$refineRel(${f.name}, ${JSON.stringify(f.op)}, ${f.k})`,
  }));
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
  // 复合守卫（合取）的**其余**合取项界一并接上（同名 + 异名）——
  // 合取为真 ⇒ 每一合取项为真 ⇒ 事实臂同时持有全部界
  // （只接一个界会在契约朝**另一**方向时把「证不出」变成「证反了」⇒ 假红）。
  return narrowArmShadowWrap(thunk, relGuardBindings(guard), forkBindingNames, "seq");
}

/** **否定臂**关系剪影（`relGuardOfNegation` 派生的事实集，issue #185）：
 *  只用于测试为假的臂（else / early-return 后续路径 / `||` 右臂）——
 *  `!(A ∧ …)` 为假 ⇒ 每个关系合取项为真，断言健全（见
 *  `relGuardOfNegation`）。不可拿来处理裸关系守卫的补集（NaN 面）。 */
export function narrowRelNegationArmThunk(
  thunk: string,
  guard: RelGuard | undefined,
  forkBindingNames: ReadonlySet<string> | readonly string[],
): string {
  if (!guard) return thunk;
  return narrowArmShadowWrap(thunk, relGuardBindings(guard), forkBindingNames, "seq");
}

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
export function relGuardComplementFactsOf(test: unknown): RelGuard[] {
  const single = matchRelIdentLit(test);
  if (single) return [single];
  return flattenBareRelDisjuncts(test) ?? [];
}

/** `||` 链上的裸关系析取项；任一项不是单关系（合取 / 别的表达式）⇒ 放弃整条 */
function flattenBareRelDisjuncts(test: unknown): RelGuard[] | undefined {
  const t = test as
    | { type?: string; operator?: string; left?: unknown; right?: unknown }
    | null
    | undefined;
  if (t?.type === "LogicalExpression" && t.operator === "||") {
    const left = flattenBareRelDisjuncts(t.left);
    if (!left) return undefined;
    const right = flattenBareRelDisjuncts(t.right);
    if (!right) return undefined;
    return [...left, ...right];
  }
  const g = matchRelIdentLit(test);
  return g ? [g] : undefined;
}

/**
 * 关系守卫**补集**臂剪影（issue #185 + 契约 `number().finite()`）：
 * `if (x < k) return …;` 的后续路径 / `x < k ? a : b` 的 else 臂在 `x` 可证
 * **非 NaN** 时断言 `x ≥ k`；`A ∨ B` 形态逐项断言。
 *
 * 转译器只负责发射调用：是否真正收紧由运行时 `$refineRelComplement` 按
 * `isNonNaN` 判定（拿不到 Abs 的语法层不得自行决定，缺证据即原样返回）。
 * 合取守卫不在内（`¬(A ∧ B)` 是析取，不是单一事实）。
 */
export function narrowRelComplementArmThunk(
  thunk: string,
  guards: readonly RelGuard[] | undefined,
  forkBindingNames: ReadonlySet<string> | readonly string[],
): string {
  const facts = (guards ?? []).filter((g) => !g.composite);
  if (facts.length === 0) return thunk;
  return narrowArmShadowWrap(
    thunk,
    facts.map((g) => ({
      name: g.name,
      arg: `$refineRelComplement(${g.name}, ${JSON.stringify(g.op)}, ${g.k})`,
    })),
    forkBindingNames,
    "seq",
  );
}

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
export type NanGuard = {
  name: string;
  truthyMeansNaN: boolean;
  /**
   * 单边事实：只有「测试为真」一侧蕴含非 NaN（`Number.isFinite(x)`）；
   * 假侧不蕴含 NaN（`"abc"` 也不 finite）⇒ **禁止**布尔取反后复用，
   * 也禁止用于 NaN 臂。
   */
  oneSided?: boolean;
};

export function nanGuardOf(
  test: unknown,
  shadowed?: ReadonlySet<string>,
  aliases?: ReadonlyMap<string, NanGuard>,
): NanGuard | undefined {
  // 用户遮蔽了 `Number`（形参 / 声明 / mock 注入）⇒ `Number.isNaN` 不是内建，
  // 不得产出 `ne(x, NaN)` 事实（fail-closed）。
  if (shadowed?.has("Number")) return undefined;
  const t = test as
    | {
        type?: string;
        name?: string;
        operator?: string;
        argument?: unknown;
        callee?: {
          type?: string;
          computed?: boolean;
          object?: { type?: string; name?: string };
          property?: { type?: string; name?: string };
        };
        arguments?: unknown[];
        left?: { type?: string; name?: string };
        right?: { type?: string; name?: string };
      }
    | null
    | undefined;
  if (t?.type === "Identifier" && typeof t.name === "string") {
    const alias = aliases?.get(t.name);
    return alias ? { ...alias } : undefined;
  }
  if (t?.type === "UnaryExpression" && t.operator === "!" && t.argument != null) {
    const inner = nanGuardOf(t.argument, shadowed, aliases);
    // 单边事实不可取反（`!Number.isFinite(x)` 假侧不蕴含 NaN）
    if (!inner || inner.oneSided) return undefined;
    return { name: inner.name, truthyMeansNaN: !inner.truthyMeansNaN };
  }
  if (
    t?.type === "CallExpression" &&
    t.callee?.type === "MemberExpression" &&
    !t.callee.computed &&
    t.callee.object?.type === "Identifier" &&
    t.callee.object.name === "Number" &&
    t.callee.property?.type === "Identifier" &&
    (t.callee.property.name === "isNaN" || t.callee.property.name === "isFinite") &&
    t.arguments?.length === 1 &&
    (t.arguments[0] as { type?: string; name?: string } | undefined)?.type ===
      "Identifier" &&
    typeof (t.arguments[0] as { name?: string }).name === "string"
  ) {
    const name = (t.arguments[0] as { name: string }).name;
    // isFinite 为真 ⇒ 有限数 ⇒ 非 NaN；为假 ⇒ 非有限（含非数字）**不**蕴含 NaN。
    if (t.callee.property.name === "isFinite") {
      return { name, truthyMeansNaN: false, oneSided: true };
    }
    return { name, truthyMeansNaN: true };
  }
  if (
    t?.type === "BinaryExpression" &&
    (t.operator === "!==" || t.operator === "===") &&
    t.left?.type === "Identifier" &&
    t.right?.type === "Identifier" &&
    typeof t.left.name === "string" &&
    t.left.name === t.right.name
  ) {
    return { name: t.left.name!, truthyMeansNaN: t.operator === "!==" };
  }
  return undefined;
}

/**
 * NaN 守卫的**非 NaN 臂**剪影：`Number.isNaN(x) === false` / `x === x` 成立
 * ⇒ `$refineNotNaN(x)`（挂 `ne(x, NaN)`），供关系补集与内建判定采信。
 * 另一臂（x 确为 NaN）不剪影——`$refineNotNaN` 没有对偶事实。
 */
export function narrowNotNaNArmThunk(
  thunk: string,
  guard: NanGuard | undefined,
  arm: "cons" | "alt",
  forkBindingNames: ReadonlySet<string> | readonly string[],
): string {
  if (!guard) return thunk;
  const notNanArm = guard.truthyMeansNaN ? "alt" : "cons";
  if (arm !== notNanArm) return thunk;
  return narrowArmShadowWrap(
    thunk,
    [{ name: guard.name, arg: `$refineNotNaN(${guard.name})` }],
    forkBindingNames,
    "seq",
  );
}
