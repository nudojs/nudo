/**
 * 转译器无法正确 lowering 的构造：抛此错误（替代静默降级注释）。
 * 消费方（tryRunTranspiled / body-fn）捕获后回落解释路径并记录
 * 结构化回落理由（unsupported:*）——能力知识单一事实源在转译点，
 * 不再依赖带外的 isBPathCapable 清单。
 */
export class NudoUnsupportedError extends Error {
  readonly reason: string;
  readonly loc?: { line: number; column: number };

  constructor(reason: string, loc?: { line: number; column: number }) {
    super(`nudo:unsupported ${reason}`);
    this.name = "NudoUnsupportedError";
    this.reason = reason;
    this.loc = loc;
  }
}
