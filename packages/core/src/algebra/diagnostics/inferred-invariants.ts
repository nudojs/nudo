/**
 * ABS-08：**自动循环不变量候选**（审计面；不参与证明）。
 *
 * 阶段纪律（计划 §ABS-08）：自动推断先只做 info 观测——候选**不进入**
 * 证明前提（`applyInvariantsToPack` 只消费用户 `@nudo:invariant`），
 * 因此不可能因为「推断错了」产生假绿。用户看到候选后可显式写成
 * `@nudo:invariant`，那时才参与门禁（`nudo:invariant-relied` 归因）。
 *
 * 推断依据：循环宽化器 `observe` 的**出口快照**——每个候选都记录样本数
 * 与观测区间；宽化真正发生（growth ≠ null）时才有候选（未宽化 = 已有
 * 精确值，无需不变量）。
 */
export type InferredInvariant = {
  /** 循环携带绑定名（pack 槽键） */
  name: string;
  /** 下钻路径（当前只推顶层标量：空数组） */
  path: Array<{ k: "idx" } | { k: "prop"; name: string }>;
  rel: "ge" | "le";
  value: number;
  /** 观测样本数（推断依据的强度指标） */
  samples: number;
  /** 来源标记：自动推断（消费面必须显式区分，不得冒充用户申报） */
  source: "inferred";
};

let inferred: InferredInvariant[] = [];

/** 清空本轮候选（check 面在求值前调用；与 assume-ledger 的既有口径同款） */
export function resetInferredInvariants(): void {
  inferred = [];
}

/** 记一条候选（同名/同路径/同关系取更宽观测样本数；值不同则都保留） */
export function noteInferredInvariant(x: InferredInvariant): void {
  const hit = inferred.find(
    (y) =>
      y.name === x.name &&
      y.rel === x.rel &&
      y.value === x.value &&
      JSON.stringify(y.path) === JSON.stringify(x.path),
  );
  if (hit) {
    if (x.samples > hit.samples) hit.samples = x.samples;
    return;
  }
  inferred.push(x);
}

/** 本轮候选快照（check 面取；消费面只读） */
export function inferredInvariants(): readonly InferredInvariant[] {
  return inferred;
}
