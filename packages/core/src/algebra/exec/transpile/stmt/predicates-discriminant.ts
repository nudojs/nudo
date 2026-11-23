/** 判别等值守卫与臂 thunk。 */
import { narrowArmShadowWrap } from "./narrow-arm.ts";
import { memberGuardTarget } from "./predicates-nullish.ts";

export type DiscriminantGuard = {
  /** 被守卫的标识符（判别基名） */
  name: string;
  /** 判别键（非计算成员）；undefined = 标识符–字面量等值守卫 */
  key?: string;
  /** 判别字面量（string/number/boolean） */
  value: string | number | boolean;
  /** 「x.key === value」事实成立的臂（`===` → cons / `!==` → alt） */
  arm: "cons" | "alt";
};

export const isPrimLitNode = (n: unknown): n is { value: string | number | boolean } => {
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
  if (m) {
    return {
      name: m.target.name,
      key: m.target.key,
      value: m.lit.value,
      arm: t.operator === "===" ? "cons" : "alt",
    };
  }
  // BUG-391：`k === "a"` 的标识符–字面量等值。只认 `===`（`!==` 的补集
  // 无法用单一 Abs 表示）；事实臂把 k 影子重绑为 `$lit("a")`，对象下标读
  // 因此能按字面量键分发。
  if (t.operator !== "===") return undefined;
  const left = t.left as { type?: string; name?: string };
  const right = t.right as { type?: string; name?: string };
  const pair =
    left?.type === "Identifier" && left.name && isPrimLitNode(t.right)
      ? { name: left.name, lit: t.right as { value: string | number | boolean } }
      : right?.type === "Identifier" && right.name && isPrimLitNode(t.left)
        ? { name: right.name, lit: t.left as { value: string | number | boolean } }
        : undefined;
  return pair !== undefined
    ? { name: pair.name, value: pair.lit.value, arm: "cons" }
    : undefined;
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
  const byName = new Map<string, DiscriminantGuard[]>();
  for (const g of matching) {
    const list = byName.get(g.name) ?? [];
    if (!list.some((x) => x.key === g.key && x.value === g.value)) list.push(g);
    byName.set(g.name, list);
  }
  return narrowArmShadowWrap(
    thunk,
    [...byName.keys()].map((name) => ({
      name,
      arg: (byName.get(name) ?? []).reduce(
        (acc, g) =>
          g.key === undefined
            ? // BUG-391：`k === "a"` 事实臂 ⇒ k 必为字面量 "a"。
              `$lit(${JSON.stringify(g.value)})`
            : `$narrowMemberEq(${acc}, ${JSON.stringify(g.key)}, ${JSON.stringify(g.value)}, true)`,
        name,
      ),
    })),
    forkBindingNames,
    "multi",
  );
}

// --- switch case 标签窄化（Bug 184） ---------------------------------------

/** case 标签的 prim 字面量值（string / number / boolean） */
