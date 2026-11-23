/**
 * 臂窄化影子重绑骨架与 strict 非法绑定名判据。
 *
 * nullish / typeof / 判别等值 / case 标签 / 关系守卫共用。
 */

const STRICT_ILLEGAL_BINDINGS = new Set(["arguments", "eval"]);

/** 守卫名是否不能作 strict 绑定名（守卫影子包装须跳过） */
export function isStrictIllegalBinding(name: string): boolean {
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

/** 臂窄化影子重绑的一个形参槽：name = 影子参数名（兼跳过检查的守卫名），
 *  arg = 重绑实参表达式（$removeNullish / $narrowTypeOf / $narrowMemberEq /
 *  $lit / $join / $refineRel 调用串，由各通道构造）。 */
export type ArmShadowBinding = { name: string; arg: string };

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
export function narrowArmShadowWrap(
  thunk: string,
  bindings: readonly ArmShadowBinding[],
  forkBindingNames: ReadonlySet<string> | readonly string[],
  mode: "multi" | "seq",
): string {
  if (bindings.length === 0) return thunk;
  const names =
    forkBindingNames instanceof Set ? (forkBindingNames as Set<string>) : new Set(forkBindingNames);
  if (bindings.some((b) => names.has(b.name) || isStrictIllegalBinding(b.name))) return thunk;
  if (mode === "seq") {
    let out = thunk;
    for (const b of bindings) out = `((${b.name}) => ${out})(${b.arg})`;
    return out;
  }
  const params = bindings.map((b) => b.name).join(", ");
  const args = bindings.map((b) => b.arg).join(", ");
  return `((${params}) => ${thunk})(${args})`;
}
