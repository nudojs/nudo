/**
 * 投影/格式化层共享的 Abs 遍历预算（DESIGN-001）。
 *
 * Abs 是可计算值：shape 图可环（evaluator 对 `const a = {}; a.self = a` 产出
 * 真环）、可深（深层嵌套结构 / harvest 链）。所有外延出口（formatShape /
 * absToString / absToTSType / absToSchemaNode / denoteGuard / absToConstraint /
 * serializeCaseArg）必须有界——absStableKey / absShapeKey 的 "cycle" 哨兵早已
 * 承认该不变量，本模块是它的共享抽象。
 *
 * 语义：
 * - enter/exit 按「当前路径」记账（进栈/出栈）：只有祖先重复才算环。
 *   兄弟复用同一子树（DAG 共享）不误判——与 absStableKey 的累积 seen 不同，
 *   那是键生成口径，渲染需要完整兄弟分支，不能沿用。
 * - 深度 = 当前路径长度；达到 maxDepth 返回 "depth"。
 * - truncated 粘性记录本次投影是否截断及原因，供 dropped 台账 / 注释标记
 *   消费（与 load-deps-fp truncated → noCache 同风格：截断必须可观测）。
 *
 * 本模块零依赖（Abs/Shape 都是普通 object），供 core 各层与 service emit
 * 共同 import，不引入环。
 */

/** 投影深度上限。BUG-014 给手写 case 实参文法 32 层（合法用例 ~4 层）；
 *  渲染面消费的是机器生成的 shape（evaluator 嵌套 / env harvest），取 2×
 *  余量 64：足够深到覆盖真实结构，又把最坏输出/栈框钉在有界。 */
export const PROJECTION_MAX_DEPTH = 64;

export type ProjectionStopReason = "cycle" | "depth";

export class ProjectionBudget {
  readonly #maxDepth: number;
  #path: object[] = [];
  #onPath = new Set<object>();
  /** 粘性：本次投影是否发生过截断（"cycle" / "depth"），供台账记录 */
  truncated: ProjectionStopReason | undefined;

  constructor(maxDepth: number = PROJECTION_MAX_DEPTH) {
    this.#maxDepth = maxDepth;
  }

  /**
   * 进入一个 Abs（或 Shape）子树。返回 null → 继续递归，之后必须配对
   * `exit()`；返回 "cycle" | "depth" → 不得递归，按出口各自的约定渲染
   * 截断标记（不调用 exit——本次 enter 没有入栈）。
   */
  enter(a: object): ProjectionStopReason | null {
    if (this.#onPath.has(a)) {
      this.truncated = "cycle";
      return "cycle";
    }
    if (this.#path.length >= this.#maxDepth) {
      this.truncated = "depth";
      return "depth";
    }
    this.#path.push(a);
    this.#onPath.add(a);
    return null;
  }

  /** 离开子树（与返回 null 的 enter 严格配对）。 */
  exit(): void {
    const a = this.#path.pop();
    if (a !== undefined) this.#onPath.delete(a);
  }
}
