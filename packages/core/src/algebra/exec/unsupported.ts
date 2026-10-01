/**
 * 转译器无法正确 lowering 的构造：抛此错误（替代静默降级注释）。
 * 消费方（tryRunTranspiled / body-fn）捕获后记录并 fail-closed
 * 结构化回落理由（unsupported:*）——能力知识单一事实源在转译点，
 * 不再依赖带外的 isEvalCapable 清单。
 */
export class NudoUnsupportedError extends Error {
  readonly reason: string;
  readonly loc?: { line: number; column: number };

  constructor(
    reason: string,
    loc?: { line: number; column: number },
    /** BUG-026：附加辨析面（如 class 碰撞的双方特征）——进 message 随回落观测 */
    detail?: string,
  ) {
    super(
      detail
        ? `nudo:unsupported ${reason} (${detail})`
        : `nudo:unsupported ${reason}`,
    );
    this.name = "NudoUnsupportedError";
    this.reason = reason;
    this.loc = loc;
  }
}
