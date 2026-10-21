/**
 * check 报告/JSON 映射（纯）：缓存重建、诊断码、issue 注入与 summary 聚合。
 */
import {
  formatCheckReport,
  serializeCheckJson,
  type CheckIssue,
  type CheckJson,
  type CheckReport,
  type NudoSig,
} from "@nudojs/core";
import { DIAG } from "@nudojs/core/internal";
import { CONFIG_SHAPE_CODE } from "./config-shape.ts";

/**
 * 磁盘缓存私有的签名注记（additive；写盘加、读回消费后剥除，
 * 不进 `--json` 契约面）：`ret` = miss 轮 formatCheckReport 渲染出的
 * 返回段（formatShape 口径，无 `= term` / `where pred` / `#conf` 注记）。
 * CheckJson.signatures 只存 formatAbs 全量串（含 term 注记），直接回填
 * display 会让命中轮签名行多出 term 注记（miss/hit 两轮渲染不对称）。
 */
export type CachedCheckSig = CheckJson["signatures"][number] & { ret?: string };

export function issueFromCachedJson(i: CheckJson["issues"][number]): CheckIssue {
  return {
    severity: i.severity as "error" | "warning" | "info",
    code: i.code,
    message: i.message,
    ...(i.fn !== undefined ? { fn: i.fn } : {}),
    ...(i.line !== undefined ? { line: i.line } : {}),
    ...(i.column !== undefined ? { column: i.column } : {}),
    ...(i.actual !== undefined ? { actual: i.actual } : {}),
    ...(i.expected !== undefined ? { expected: i.expected } : {}),
    ...(i.suggestion !== undefined ? { suggestion: i.suggestion } : {}),
    ...(i.reason !== undefined ? { reason: i.reason } : {}),
  };
}

export function signatureFromCachedJson(s: CachedCheckSig): NudoSig {
  // ret 存在（新缓存条目）：display 直接给 miss 轮渲染出的返回段，
  // abs.shape 留空让 formatCheckReport 走 display 回退分支 → 命中轮
  // 签名行与 miss 轮字节一致。display 本体是 formatAbs 全量串，
  // 含 `= term` 注记，不能直接用（会多渲染 term 注记）。
  // 无 ret（ret 落地前的旧缓存条目）：fake-any 占位回退（旧口径）。
  const hasRet = s.ret !== undefined;
  return {
    name: s.name,
    params: s.params,
    ...(s.paramTypes ? { paramTypes: s.paramTypes } : {}),
    // CheckJson abs 是 formatAbs 字符串；重建时不要伪造成 unknown（§2）
    abs: (hasRet
      ? { shape: undefined, conf: s.conf }
      : { shape: { k: "any" }, conf: s.conf }) as never,
    display: s.ret ?? s.display,
    detail: s.detail,
    conf: s.conf as never,
    ...(s.throws ? { throws: s.throws } : {}),
    ...(s.entry ? { entry: true } : {}),
  };
}

export function reportFromCachedJson(cached: CheckJson): CheckReport {
  return {
    file: cached.file,
    issues: cached.issues.map(issueFromCachedJson),
    ok: cached.ok,
    signatures: cached.signatures.map((s) => signatureFromCachedJson(s)),
    summary: { ...cached.summary },
    // budget 截断上屏块随缓存往返（缺失时命中轮会静默吞掉 budget 段）
    ...(cached.budget ? { budget: { ...cached.budget } } : {}),
  };
}

// ---------------------------------------------------------------------------
// 磁盘缓存签名保真：miss 轮渲染产物（ret）写盘 / 读回 / 剥除
// ---------------------------------------------------------------------------

/**
 * miss 轮 formatCheckReport 渲染出的签名返回段（`=> ` 之后、`throws` 之前）。
 * 从已渲染的签名行切已知前缀提取 —— 与 live 渲染同源零逻辑分叉，
 * core 改渲染也不会漂移。行面不符（name/params 前缀对不上）→ undefined，
 * 该签名不落 ret（读回走旧回退，宁可旧口径也不猜）。
 */
function signatureRetsFromReport(r: CheckReport): Array<string | undefined> {
  if (r.signatures.length === 0) return [];
  const lines = formatCheckReport(r, { verbose: false }).split("\n");
  const start = lines.indexOf("signatures");
  if (start < 0) return r.signatures.map(() => undefined);
  let i = start + 1;
  return r.signatures.map((s) => {
    const paramStr =
      s.paramTypes && s.paramTypes.length > 0
        ? s.params.map((p, k) => `${p}: ${s.paramTypes![k] ?? "any"}`).join(", ")
        : s.params.join(", ");
    const prefix = `  ${s.name}(${paramStr}) => `;
    const line = lines[i++];
    if (typeof line !== "string" || !line.startsWith(prefix)) return undefined;
    let ret = line.slice(prefix.length);
    if (s.throws) {
      const suffix = `  throws ${s.throws}`;
      if (ret.endsWith(suffix)) ret = ret.slice(0, ret.length - suffix.length);
    }
    return ret;
  });
}

/** 写盘值：serializeCheckJson + 缓存私有 `ret`（命中轮签名渲染保真） */
export function serializeCheckJsonForCache(r: CheckReport): CheckJson {
  const json = serializeCheckJson(r);
  const rets = signatureRetsFromReport(r);
  if (rets.every((x) => x === undefined)) return json;
  return {
    ...json,
    signatures: json.signatures.map((s, k) => {
      const ret = rets[k];
      return ret === undefined ? s : ({ ...s, ret } satisfies CachedCheckSig);
    }),
  };
}

/**
 * 剥除缓存私有 `ret`（读回消费完 reportFromCachedJson 后立即调用）：
 * `--json` / jsonCollect / mergeJsonIssues 面必须是纯 CheckJson 契约，
 * miss 轮与命中轮的机器面字节一致。无 ret 时原样返回（幂等）。
 */
export function stripCachedSigRets(j: CheckJson): CheckJson {
  if (!j.signatures.some((s) => (s as CachedCheckSig).ret !== undefined)) return j;
  return {
    ...j,
    signatures: j.signatures.map((s) => {
      const { ret, ...rest } = s as CachedCheckSig;
      return ret === undefined
        ? s
        : (rest as CheckJson["signatures"][number]);
    }),
  };
}

/** 诊断 → 文档深链：问题码 → reference/diagnostics.md 锚点 id 列表 */
export function docsDiagnosticCodes(issues: Array<{ code?: string }>): string[] {
  return [
    ...new Set(
      issues
        .map((i) => i.code)
        .filter((c): c is string => !!c && /^nudo[\w:-]+$/.test(c)),
    ),
  ];
}

export function mockFromErrorIssues(
  mockFromErrors: Array<{ name: string; fromPath: string; message: string; code?: string }>,
): CheckIssue[] {
  return mockFromErrors.map((fe) => {
    const isExpr = fe.code === DIAG.mockInvalid;
    return {
      // 表达式认不出（mockInvalid）= **指令被忽略**（mock 不生效），按文档是
      // warning（reference/diagnostics.md#nudo-mock-invalid「Warning」；
      //  guides/check.md 诊断表「nudo:mock-invalid | engine | warning」）；
      // mock 文件缺失 / 加载失败（moduleMissing）才是 error。
      // 旧实现**无条件**提到 error ⇒ 与 service 侧同一分流
      // （analyzer-orchestrate-uncached.ts:311 `isExpr ? "warning" : "error"`）
      // 自相矛盾：同一文件里两条通道一 warning 一 error（#460）。
      severity: isExpr ? ("warning" as const) : ("error" as const),
      code: (fe.code ?? DIAG.moduleMissing) as string,
      message: fe.message,
      suggestion: isExpr
        ? "Fix the @nudo:mock expression (constraint builders, literals, or arrow functions)"
        : `Create the mock file or fix the path in @nudo:mock ${fe.name} from "${fe.fromPath}"`,
    };
  });
}

/** D1: 指令文法诊断（nudo:directive-syntax）→ CheckIssue（warning，不挡 exit） */
export function directiveDiagIssues(
  diags: Array<{ code: string; message: string }>,
): CheckIssue[] {
  return diags.map((d) => ({
    severity: "warning" as const,
    code: d.code,
    message: d.message,
    suggestion: "Fix the directive syntax (see docs/reference/diagnostics.md)",
  }));
}

export type DomainDiagnosticLike = {
  code?: string;
  severity: string;
  message: string;
  range: { start: { line: number; column: number } };
  data?: unknown;
  suggestions?: string[];
};

/**
 * interface 家族诊断 → CheckIssue（check 面消费分析器诊断的唯一入口）。
 *
 * 白名单 = **check 面承诺可见**的 interface 家族码：
 * - `nudo:interface-domain-exceeds`（L1 error/warning）：契约域被调用实参超出。
 * - `nudo:interface-entry-only`（L1 **info**）：导出无契约根且无调用点域
 *   （entry-only）。文档（guides/check.md、reference/diagnostics.md）承诺它
 *   是 check 的 L1 info；此前白名单**只**留 domain-exceeds 一条 ⇒ 分析器
 *   产出的 entry-only 被 CLI 静默丢弃（infos: 0），而 `nudo health` 走另一条
 *   统计路径仍报「N entry-only」⇒ 同一事实两 verb 口径分裂（Bug 461）。
 *   severity 固定 **info**：观察面提示，不挡门禁（ok / exit code 不变）。
 *
 * 函数名保持 `domainIssuesFromDiagnostics`：`commands/check.ts` 按名 import
 * （共享热点文件，不在本分片改动范围），改名会断其 import。
 */
export function domainIssuesFromDiagnostics(
  diagnostics: readonly DomainDiagnosticLike[],
): CheckIssue[] {
  return diagnostics
    .filter(
      (d) => d.code === DIAG.interfaceDomainExceeds || d.code === DIAG.interfaceEntryOnly,
    )
    .map((d) => {
      const data = (d.data ?? {}) as { actual?: unknown; expected?: unknown };
      const isEntryOnly = d.code === DIAG.interfaceEntryOnly;
      return {
        severity: isEntryOnly
          ? ("info" as const)
          : d.severity === "error"
            ? ("error" as const)
            : ("warning" as const),
        code: isEntryOnly ? DIAG.interfaceEntryOnly : DIAG.interfaceDomainExceeds,
        message: d.message,
        line: d.range.start.line,
        column: d.range.start.column,
        actual: typeof data.actual === "string" ? data.actual : undefined,
        expected: typeof data.expected === "string" ? data.expected : undefined,
        suggestion: d.suggestions?.[0],
      };
    });
}

export function dualEntryIssue(dual: {
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}): CheckIssue {
  return {
    severity: "info",
    code: DIAG.dualEntry,
    message: dual.message,
    line: dual.line,
    column: dual.column,
    suggestion: dual.suggestion,
  };
}

type Summarized = {
  issues: CheckIssue[];
  ok: boolean;
  summary: { errors: number; warnings: number; infos: number; functions: number };
};

/** 追加 issues 并同步 summary/ok（有新 error 则 ok=false） */
export function mergeCheckIssues<T extends Summarized>(report: T, issues: CheckIssue[]): T {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;
  return {
    ...report,
    issues: [...report.issues, ...issues],
    ok: report.ok && errors === 0,
    summary: {
      ...report.summary,
      errors: report.summary.errors + errors,
      warnings: report.summary.warnings + warnings,
      infos: report.summary.infos + infos,
    },
  };
}

type JsonSummarized = {
  issues: CheckJson["issues"];
  summary: { errors: number; warnings: number; infos: number; functions: number };
};

/** CheckJson 面上追加 issues 并同步 summary（不改 ok） */
export function mergeJsonIssues<T extends JsonSummarized>(
  json: T,
  issues: CheckJson["issues"],
): T {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;
  return {
    ...json,
    issues: [...json.issues, ...issues],
    summary: {
      ...json.summary,
      errors: json.summary.errors + errors,
      warnings: json.summary.warnings + warnings,
      infos: json.summary.infos + infos,
    },
  };
}

/** path env 加载失败告警码（live 瞬态：每轮 preloadPathEnvs 现场收集） */
export const ENV_UNRESOLVED_CODE = DIAG.envUnresolved;

type StripSummaryLike = {
  issues: Array<{ severity?: string; code?: string }>;
  summary: { errors: number; warnings: number; infos: number; functions: number };
};

/**
 * 剔除 nudo:env-unresolved（live 瞬态告警，不持久化进磁盘缓存）：
 * 写缓存前调用（瞬态不落盘），读回旧缓存条目时也调用（兼容已持久化
 * 条目——命中轮 live merge 会重新注入，不剔除则重复；无需 bump ABI）。
 * summary 计数按剩余 issues 的 severity 重算（与 checkSource 口径一致）。
 */
export function stripEnvUnresolvedIssues<T extends StripSummaryLike>(x: T): T {
  if (!x.issues.some((i) => i.code === ENV_UNRESOLVED_CODE)) return x;
  const issues = x.issues.filter((i) => i.code !== ENV_UNRESOLVED_CODE);
  return {
    ...x,
    issues,
    summary: {
      ...x.summary,
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
      infos: issues.filter((i) => i.severity === "info").length,
    },
  };
}

/**
 * 剔除 package.json#nudo 键形状诊断（468/936）——同 env-unresolved 的
 * live 事实处理：形状问题由本轮现场探针判定（配置可能刚被改好/写坏），
 * 缓存命中轮若不剔除就会与 live merge **重复**（mergeCheckIssues 只追加、
 * 不去重）⇒ 读回时剔除、由本轮 live merge 单一来源注入。
 */
export function stripConfigShapeIssues<T extends StripSummaryLike>(x: T): T {
  if (!x.issues.some((i) => i.code === CONFIG_SHAPE_CODE)) return x;
  const issues = x.issues.filter((i) => i.code !== CONFIG_SHAPE_CODE);
  return {
    ...x,
    issues,
    summary: {
      ...x.summary,
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
      infos: issues.filter((i) => i.severity === "info").length,
    },
  };
}

type PathErrorLike = {
  path: string;
  code: string;
  message: string;
  suggestion?: string;
};

type MultiEnvelope = {
  ok: boolean;
  summary: { errors: number; warnings: number; infos: number; functions: number; files: number; budgetTruncated?: boolean };
  pathErrors?: PathErrorLike[];
  reports: unknown[];
};

/**
 * 路径错误纳入 CheckJsonMulti 信封：ok:false + pathErrors[]。
 *
 * **summary.errors 不含路径错误**（695）：`summary.errors` 的定义是
 * **诊断条数之和** —— core 侧 `serializeCheckJsonMulti` 逐文件求和，core
 * 自己的契约测试断言 `multi.summary.errors === Σ reports[].summary.errors`。
 * 旧实现把路径错误并进 summary.errors ⇒ 信封聚合数 ≠ Σreports[] ≠ 人类面
 * （同一份 JSON 内部自相矛盾：3 条分析 error 被报成 4 条）。
 * 路径错误只落在 `pathErrors[]`（文档口径：非空 pathErrors ⇒ ok:false ⇒
 * exit 1），条数 = `pathErrors.length`。
 * ok↔exit 单一来源：CLI 在 --json 路径只按信封 ok 设 exit。
 */
export function attachPathErrors<T extends MultiEnvelope>(
  envelope: T,
  errors: PathErrorLike[],
): T {
  if (errors.length === 0) return envelope;
  return {
    ...envelope,
    ok: false,
    pathErrors: errors.map((e) => ({
      path: e.path,
      code: e.code,
      message: e.message,
      ...(e.suggestion !== undefined ? { suggestion: e.suggestion } : {}),
    })),
  };
}
