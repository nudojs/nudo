/**
 * AST 泛型走查骨架（第三轮重复逻辑收敛 #8 单源）：此前 body-fn.ts
 * （bodyIdentNames / nestedBodyNodes）与 generalize.ts（bodyReferencesName /
 * bodyReferenceCount）各持一份 `Object.keys` 下钻 + skip 键过滤的同构遍历。
 *
 * ⚠ 两族消费者的 skip 口径有**真实差异**，拼平即行为变更，故全部参数化：
 * - body-fn 族：跳 comments 系键（comments/leadingComments/trailingComments/
 *   innerComments），**不**跳非计算 MemberExpression.property（属性键里的
 *   Identifier 也是用户绑定词形，正是 bodyIdentNames 要收的）；带 seen
 *   WeakSet 去重（防环/防共享节点重复访问）。
 * - generalize 族：**不**跳 comments 系键（原实现未列），跳非计算
 *   MemberExpression.property（`a.name` 的 name 不是对变量 name 的引用，
 *   计数/查引用都不得算）；无 seen 去重（原实现就没有）。
 * - 两族共同跳 loc/start/end/tokens（skipLoc）。
 *
 * `visit` 返回 true ⇒ 整棵走查早退（bodyReferencesName 的 found 短路）。
 */

/** loc/start/end/tokens：位置与词法面，两族消费者都跳 */
const LOC_KEYS: ReadonlySet<string> = new Set(["loc", "start", "end", "tokens"]);
/** comments 系键：Babel 挂在节点上的注释面，body-fn 族跳 */
const COMMENT_KEYS: ReadonlySet<string> = new Set([
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments",
]);

export type WalkAstOptions = {
  /** 跳 comments/leadingComments/trailingComments/innerComments（body-fn 族） */
  skipComments?: boolean;
  /** 跳 loc/start/end/tokens（两族都用） */
  skipLoc?: boolean;
  /**
   * 跳非计算 MemberExpression 的 property 键（`a.name` 的 name 不是变量
   * 引用——generalize 族的查引用/计数口径；bodyIdentNames 要收属性键
   * 词形，**不得**开）。
   */
  skipNonComputedProperty?: boolean;
  /**
   * seen WeakSet 去重（body-fn 族：防环 / 防共享节点重复访问）。
   * generalize 族原实现无去重，保持关。
   */
  dedup?: boolean;
};

/**
 * 从 root 深度优先走查 AST：对每个对象节点（含 root）调 `visit`，返回
 * true 则整棵早退；否则按 `Object.keys` 序下钻子节点（数组逐项、对象
 * 递归），skip 口径见 {@link WalkAstOptions}。visit 收到的是原始节点
 * （unknown 形态，窄化由消费方做）。
 */
export function walkAstNodes(
  root: object,
  opts: WalkAstOptions,
  visit: (n: object) => boolean | void,
): void {
  const seen = opts.dedup ? new WeakSet<object>() : undefined;
  const walk = (n: unknown): boolean => {
    if (!n || typeof n !== "object") return false;
    const obj = n as object;
    if (seen) {
      if (seen.has(obj)) return false;
      seen.add(obj);
    }
    if (visit(obj) === true) return true;
    const o = obj as { type?: string; [k: string]: unknown };
    for (const key of Object.keys(o)) {
      if (opts.skipLoc && LOC_KEYS.has(key)) continue;
      if (opts.skipComments && COMMENT_KEYS.has(key)) continue;
      if (
        opts.skipNonComputedProperty &&
        key === "property" &&
        o.type === "MemberExpression" &&
        (o as { computed?: boolean }).computed !== true
      ) {
        continue;
      }
      const v = o[key];
      if (Array.isArray(v)) {
        for (const item of v) if (walk(item)) return true;
      } else if (v && typeof v === "object") {
        if (walk(v)) return true;
      }
    }
    return false;
  };
  walk(root);
}
