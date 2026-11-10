/**
 * ABS-02：`unknown` / `any` 来源可解释（**旁路**）。
 *
 * 纪律：
 * - 本模块**不**改 Abs 结构，也不进 `absKey` / `leqAbs` / 指纹 / 缓存键 ⇒
 *   默认输出逐字节不变、冷/暖缓存一致（解释是观察面，不是分析输入）；
 * - 只有显式请求（`nudo check --explain-unknown` / 健康计数）才物化；
 * - 归因只读**已有**观测面：signatures / issues / budget / eval fallback /
 *   契约来源，不新增采集点、不改变任何判定。
 */

/** 未知来源分类（产品面口径，顺序稳定） */
export type UnknownReason =
  /** 调用 / 循环 / promise 预算截断 */
  | "budget"
  /** 缺 env / 模块不可解析 / 导出缺失 */
  | "missing-env"
  /** 未建模构造（成员方法 / 槽位 / 宿主 effect） */
  | "unsupported"
  /** 转译 / 求值失败（模块级回落） */
  | "eval-failure"
  /** 入口无契约（形参按 `any` 展示） */
  | "no-contract"
  /** 显式 `any()` 契约 */
  | "explicit-any"
  /** 推导失败（unknown / partial / opaque） */
  | "inference-failure";

export type AnalysisExplanation = {
  /** 归属函数（文件级原因省略） */
  fn?: string;
  reason: UnknownReason;
  detail: string;
  /** 可执行的下一步（可选） */
  suggestion?: string;
};

/** 结构化输入（只取观察面已有字段；结构性类型避免与 check 模块成环） */
export type ExplainInput = {
  signatures: ReadonlyArray<{
    name: string;
    paramTypes?: readonly string[];
    display?: string;
    detail?: string;
    conf?: string;
    entry?: boolean;
  }>;
  issues?: ReadonlyArray<{
    code: string;
    fn?: string;
    message?: string;
    reason?: string;
    severity?: string;
  }>;
  budget?: {
    truncated?: boolean;
    loopTruncated?: boolean;
    reasons?: readonly string[];
    callReasons?: readonly string[];
    evalReasons?: readonly string[];
  };
  /** CLI 侧已采集的求值回落（reason/origin/gateFatal 与 core 同口径） */
  evalFallbacks?: ReadonlyArray<{
    reason: string;
    message?: string;
    fn?: string;
    origin?: string;
    gateFatal?: boolean;
  }>;
  /** 函数 → 有效契约来源（区分「无契约」与「显式 any()」） */
  contractSourceOf?: (fn: string) => "handwritten" | "generated" | "implicit" | undefined;
  /** 函数 → 契约里是否出现显式 `any()`（无 prim/preds/结构） */
  explicitAnyOf?: (fn: string) => boolean;
};

const MISSING_ENV_CODES = new Set([
  "nudo:env-unresolved",
  "nudo:module-missing",
  "nudo:module-unreadable",
  "nudo:module-cycle",
  "nudo:module-depth",
  "nudo:missing-export",
  "nudo:exports-unresolved",
  "nudo:contract-load",
]);

const UNSUPPORTED_CODES = new Set([
  "nudo:no-method",
  "nudo:missing-slot",
  "nudo:unknown-recv",
  "nudo:unknown-inference",
  "nudo:host-effect-blocked",
  "nudo:mock-invalid",
]);

const BUDGET_CODES = new Set([
  "nudo:recursion-truncated",
  "nudo:loop-truncated",
  "nudo:promise-micro-truncated",
  "nudo:call-truncated",
]);

function budgetSuggestion(reason: string): string {
  if (reason === "cycle") {
    return "same-abstract-argument call cycle: @nudo:budget cannot help — pin a witness with @nudo:case or accept the symbolic signature";
  }
  return "raise @nudo:budget calls=/depth= for this function, or pin a witness with @nudo:case";
}

/**
 * 由观察面构造未知来源清单（去重 + 稳定排序）。
 * 纯函数：无副作用、不读全局 collector。
 */
export function buildUnknownExplanations(input: ExplainInput): AnalysisExplanation[] {
  const out: AnalysisExplanation[] = [];
  const push = (e: AnalysisExplanation): void => {
    const key = `${e.fn ?? ""}\0${e.reason}\0${e.detail}`;
    if (!out.some((x) => `${x.fn ?? ""}\0${x.reason}\0${x.detail}` === key)) {
      out.push(e);
    }
  };

  // 1) 求值回落（转译 / 模块求值 / 引擎内部）
  for (const f of input.evalFallbacks ?? []) {
    const reason: UnknownReason =
      f.reason === "unsupported"
        ? "unsupported"
        : f.origin === "host"
          ? "unsupported"
          : "eval-failure";
    push({
      ...(f.fn !== undefined ? { fn: f.fn } : {}),
      reason,
      detail: f.message ?? `eval fallback: ${f.reason}`,
      suggestion:
        reason === "eval-failure"
          ? "module evaluation failed (fail-closed empty exports) — report this as an engine bug with the file attached"
          : "the construct is not modeled on the eval path — mock it (@nudo:mock) or pin the result with @nudo:case",
    });
  }

  // 2) 预算截断（report.budget 是既有观测面）
  const budget = input.budget;
  if (budget) {
    const reasons = new Set<string>([
      ...(budget.reasons ?? []),
      ...(budget.callReasons ?? []),
      ...(budget.evalReasons ?? []),
    ]);
    if (budget.loopTruncated) reasons.add("loop-iterations");
    for (const r of [...reasons].sort()) {
      push({
        reason: "budget",
        detail: `analysis truncated (${r}) — affected values were widened`,
        suggestion: budgetSuggestion(r),
      });
    }
    if (reasons.size === 0 && budget.truncated) {
      push({
        reason: "budget",
        detail: "analysis truncated — affected values were widened",
        suggestion: budgetSuggestion("calls"),
      });
    }
  }

  // 3) issues：缺 env / 未建模 / 预算 / 溢出
  for (const i of input.issues ?? []) {
    const base = {
      ...(i.fn !== undefined ? { fn: i.fn } : {}),
      detail: i.message ?? i.code,
    };
    if (MISSING_ENV_CODES.has(i.code)) {
      push({
        ...base,
        reason: "missing-env",
        suggestion:
          "declare the environment (/// @nudo:env, package.json#nudo.env) or provide a mock (@nudo:mock / @nudo:mock-module)",
      });
      continue;
    }
    if (BUDGET_CODES.has(i.code)) {
      push({
        ...base,
        reason: "budget",
        suggestion: budgetSuggestion(i.reason ?? "calls"),
      });
      continue;
    }
    if (UNSUPPORTED_CODES.has(i.code)) {
      push({
        ...base,
        reason: "unsupported",
        suggestion:
          "the construct is not modeled — mock it (@nudo:mock) or pin the result with @nudo:case",
      });
    }
  }

  // 4) 签名面：入口 any（无契约 / 显式 any）与推导失败（partial / opaque / unknown）
  for (const s of input.signatures) {
    const anyParams = (s.paramTypes ?? []).filter((t) => t === "any");
    if (anyParams.length > 0) {
      const source = input.contractSourceOf?.(s.name);
      const explicit = input.explicitAnyOf?.(s.name) === true;
      push({
        fn: s.name,
        reason: explicit ? "explicit-any" : "no-contract",
        detail: explicit
          ? `${anyParams.length} parameter(s) constrained by any() (no obligation)`
          : source === "handwritten" || source === "generated"
            ? `${anyParams.length} parameter(s) fall back to any (contract does not cover them)`
            : `${anyParams.length} parameter(s) have no contract — entry params display as any`,
        suggestion: explicit
          ? "replace any() with the domain you rely on (number()/string()/shape(...)) if the parameter is meant to be constrained"
          : "add @nudo:contract <param> <name> in the JSDoc (sidecar template) to constrain the parameter",
      });
    }
    if (s.conf === "partial" || s.conf === "opaque") {
      push({
        fn: s.name,
        reason: "inference-failure",
        detail:
          s.conf === "opaque"
            ? "return value is opaque (host value / unmodeled effect)"
            : "return value was inferred partially (unknown absorbed)",
        suggestion:
          "feed concrete input via @nudo:case / @nudo:mock, or declare the return contract explicitly",
      });
    }
  }

  out.sort((a, b) => {
    const fa = a.fn ?? "";
    const fb = b.fn ?? "";
    if (fa !== fb) return fa < fb ? -1 : 1;
    if (a.reason !== b.reason) return a.reason < b.reason ? -1 : 1;
    return a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0;
  });
  return out;
}

/** 稳定文本面（`--explain-unknown` 人类输出；逐字节可快照） */
export function formatUnknownExplanations(
  explanations: readonly AnalysisExplanation[],
): string {
  if (explanations.length === 0) return "";
  const lines = ["unknown / any origins"];
  for (const e of explanations) {
    lines.push(`  ${e.fn ?? "(file)"}  ${e.reason}: ${e.detail}`);
    if (e.suggestion) lines.push(`    → ${e.suggestion}`);
  }
  return lines.join("\n");
}
