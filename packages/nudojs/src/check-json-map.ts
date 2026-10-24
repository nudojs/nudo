/**
 * check 报告/JSON 映射（纯）：缓存重建、诊断码、issue 注入与 summary 聚合。
 */
import { resolve } from "node:path";
import {
  checkSource,
  formatCheckReport,
  pTrue,
  serializeCheckJson,
  type CheckIssue,
  type CheckJson,
  type CheckReport,
  type NudoSig,
} from "@nudojs/core";
import { DIAG } from "@nudojs/core/internal";
import { parse, programBody } from "@nudojs/parser";
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

export type DomainDiagnosticLike = {
  code?: string;
  severity: string;
  message: string;
  range: { start: { line: number; column: number } };
  data?: unknown;
  suggestions?: string[];
};

/**
 * check 面「哪些码上屏」的**定稿清单**（族 18 · 片 3 owner）。
 *
 * 判据（三条同时满足才上屏）：
 * 1. **文档承诺 check 面可见**：guides/check.md 的诊断表 或
 *    reference/diagnostics.md 明确写了该码的 check 面语义；
 * 2. **分析器（service）真实产出**：码出现在 `analyzeFileAsync` 的
 *    `diagnostics` 里（不是 core `checkSource` 独有能力）；
 * 3. **不与 core `checkSource` 的既有诊断重复**：重复 ⇒ 双报。
 *
 * 逐条依据：
 * - `nudo:interface-domain-exceeds`（L1 error/warning）：契约域被调用实参超出。
 *   分析器产出 + 文档承诺 ⇒ 上屏。
 * - `nudo:interface-entry-only`（L1 **info**）：导出无契约根且无调用点域
 *   （entry-only）。文档（guides/check.md、reference/diagnostics.md）承诺它
 *   是 check 的 L1 info；此前白名单**只**留 domain-exceeds 一条 ⇒ 分析器
 *   产出的 entry-only 被 CLI 静默丢弃（infos: 0），而 `nudo health` 走另一条
 *   统计路径仍报「N entry-only」⇒ 同一事实两 verb 口径分裂（Bug 461）。
 *   severity 固定 **info**：观察面提示，不挡门禁（ok / exit code 不变）。
 * - 模块装载问题族（Bug 632）：`nudo:module-missing` / `nudo:missing-export`
 *   （error）、`nudo:module-cycle` / `nudo:module-depth` /
 *   `nudo:exports-unresolved`（warning）、`nudo:json-invalid`（error）。
 *   分析器 `composeEvalModules` 的模块图装载问题（service
 *   `pushBModuleIssues`）**只**走分析器诊断通道；core `checkSource`
 *   不装载依赖模块图 ⇒ 这些事实此前在 check 面**完全不可见** ⇒
 *   依赖解析失败的源文件门禁绿灯、exit 0（文档承诺 module-missing /
 *   missing-export / cycle / depth 是 check 面 error/warning）。
 * - `nudo:env-harvest-conflict`（warning，Bug 1038）：handwritten `@nudo:env`
 *   胜出 / harvest 冲突。reference/diagnostics.md 明确列它是 check 面告警，
 *   分析器已产出（service `pushBModuleIssues`）⇒ 此前被白名单整条丢掉。
 *
 * **刻意排除**（避免与 core `checkSource` 双报，或非 check 面语义）：
 * - `nudo:module-unreadable`：core `checkSource` 已通过
 *   `loadReadFailureIssues` 上报同一事实（依赖存在但读不了）。
 * - `nudo:interface-load`：core `checkSource` 自己上报一份（侧车加载失败）。
 * - `nudo:unknown-inference` / `nudo:opaque-result` / `nudo:no-signature` /
 *   `nudo:missing-slot` / `nudo:builtin-unknown` / `nudo:no-method` /
 *   `nudo:unknown-recv`：core `checkSource`（engine-debt 家族）独有能力。
 * - `nudo:entry-may-throw` / `nudo:assume-*` / `nudo:invariant-*`：L2 家族，
 *   core `checkSource` 独有能力（check 面的 L2 门禁由 `resolveGateForFile`
 *   解析，不能与分析器通道混流）。
 * - `nudo:mock-invalid`：check 面已有 `mockFromErrorIssues` 通道上报。
 * - `nudo:case-*` / `nudo:may-throw`：check 面以 caseMode "none" 调分析器，
 *   永不产出。
 *
 * 导出供下游片（4 / 5）复用同一口径，避免各处各写一份白名单。
 */
export const CHECK_FACE_DIAG_CODES: readonly string[] = [
  // interface 家族
  DIAG.interfaceDomainExceeds,
  DIAG.interfaceEntryOnly,
  // 模块装载问题族（Bug 632）
  DIAG.moduleMissing,
  DIAG.missingExport,
  DIAG.moduleCycle,
  DIAG.moduleDepth,
  DIAG.jsonInvalid,
  DIAG.exportsUnresolved,
  // env 家族（Bug 1038）
  DIAG.envHarvestConflict,
];

const CHECK_FACE_DIAG_CODE_SET: ReadonlySet<string> = new Set(CHECK_FACE_DIAG_CODES);

/**
 * 分析器诊断 → CheckIssue（check 面消费分析器诊断的唯一入口）。
 *
 * 白名单 = {@link CHECK_FACE_DIAG_CODES}（check 面承诺可见的码集合）。
 * severity 口径：entry-only 固定 **info**（观察面提示，不挡门禁）；
 * 其余按分析器给的 severity 走（error ⇒ 挡门禁 / exit 1，warning ⇒ 只可见）。
 *
 * 函数名保持 `domainIssuesFromDiagnostics`：`commands/check.ts` 按名 import
 * （共享热点文件，不在本分片改动范围），改名会断其 import。
 */
export function domainIssuesFromDiagnostics(
  diagnostics: readonly DomainDiagnosticLike[],
): CheckIssue[] {
  return diagnostics
    .filter(
      (d): d is DomainDiagnosticLike & { code: string } =>
        d.code !== undefined && CHECK_FACE_DIAG_CODE_SET.has(d.code),
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
        code: d.code,
        message: d.message,
        line: d.range.start.line,
        column: d.range.start.column,
        actual: typeof data.actual === "string" ? data.actual : undefined,
        expected: typeof data.expected === "string" ? data.expected : undefined,
        suggestion: d.suggestions?.[0],
      };
    });
}

// ---------------------------------------------------------------------------
// Bug 643 —— `--from` 的调用点义务必须与**同文件通道同判据**
// ---------------------------------------------------------------------------

/** `--from` 现场文件（调用点文件） */
export type FromCallsiteFile = {
  /** 现场文件绝对路径 */
  path: string;
  /** 现场文件源码 */
  source: string;
};

export type StaticFromDomainOptions = {
  /** 被调方（被检查文件）绝对路径 */
  targetPath: string;
  /** `--from` 现场文件（调用点文件） */
  callsites: readonly FromCallsiteFile[];
  /** import 说明符解析（相对现场文件）⇒ 解析到被调方的 import 即证据来源 */
  resolveModule?: (specifier: string, fromFile: string) => string | undefined;
  /** 侧车装载器（`*.nudo.js` 契约侧车） */
  loadModule?: (specifier: string, fromFile: string) => string | undefined;
  /** 侧车 ambient 绑定开关 */
  autoBind?: boolean;
  /** 项目根 */
  projectDir?: string;
};

/** 路径归一比较（两侧都先 resolve ⇒ 相对/绝对写法等价） */
function sameModulePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b);
}

/**
 * 现场文件里指向被调方的 import 绑定：本地名 → 被调方导出名
 * （命名空间导入记为 `"*"` ⇒ 成员访问 `ns.f` 归到导出 `f`）。
 */
function targetImportBindings(
  site: FromCallsiteFile,
  opts: StaticFromDomainOptions,
): Map<string, string> {
  const bindings = new Map<string, string>();
  if (!opts.resolveModule) return bindings;
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(site.source);
  } catch {
    return bindings; // 解析失败 ⇒ 无证据（不猜）
  }
  for (const stmt of programBody(ast)) {
    if (stmt.type !== "ImportDeclaration") continue;
    const resolved = opts.resolveModule(stmt.source.value, site.path);
    if (!resolved || !sameModulePath(resolved, opts.targetPath)) continue;
    for (const spec of stmt.specifiers) {
      if (spec.type === "ImportSpecifier") {
        const imported =
          spec.imported.type === "Identifier"
            ? spec.imported.name
            : String(spec.imported.value);
        bindings.set(spec.local.name, imported);
      } else if (spec.type === "ImportNamespaceSpecifier") {
        bindings.set(spec.local.name, "*");
      }
    }
  }
  return bindings;
}

/** 现场文件里的本地名 → 被调方导出名（命名空间成员 `ns.f` → `f`）。 */
function resolveExportName(local: string, bindings: Map<string, string>): string | undefined {
  const direct = bindings.get(local);
  if (direct !== undefined && direct !== "*") return direct;
  const dot = local.lastIndexOf(".");
  if (dot > 0) {
    const obj = local.slice(0, dot);
    const prop = local.slice(dot + 1);
    if (bindings.get(obj) === "*") return prop;
  }
  return undefined;
}

/**
 * `--from` 的**静态**调用点证据（Bug 643）。
 *
 * 背景：调用点义务有两条通道，判据本应一致——
 * - **同文件**：core 的 `scanLiteralCalls` 做**静态全树扫描** ⇒ 无论调用点
 *   是否被执行过都执法；
 * - **跨文件（`--from`）**：此前只有**执行态** `externalCallRecords`（只有
 *   真正跑过的调用才有记录）⇒ 被包在函数 / 箭头 / 方法体里的调用点静默漏过
 *   ⇒ 同一处静态可见的违例，`nudo check <调用方>` 报红、`nudo check <被调方>
 *   --from <调用方>` 报绿（谁被检查谁决定颜色）。
 *
 * 修法：**复用 core 同文件通道的静态扫描**（`checkSource` 对现场文件跑一遍
 * ⇒ `scanLiteralCalls` 静态全树扫描），只取「被调方导出」的
 * `nudo:constraint-violated` 归因到被调方 ⇒ 判据（只认 plain literal 实参、
 * 契约面来源=侧车、归因=import 绑定表）全部沿用 core，不引入第二套判据。
 *
 * 上屏码用 **`nudo:interface-domain-exceeds`**（与既有 `--from` 执行态通道
 * 同码）：core 的 `nudo:constraint-violated` 是**同文件通道**的码（它的报告
 * 面指向调用方文件）；跨文件面归到被调方 ⇒ 用跨文件面的码 ⇒ 两条 `--from`
 * 通道同码、L1 分层一致、文档深链一致。
 *
 * loc（line/column）**不搬**：调用点在**现场文件**里，搬进被调方的报告会
 * 指错文件（与既有 `--from` 执行态通道同款：不带 loc）。
 */
export function staticFromDomainIssues(opts: StaticFromDomainOptions): CheckIssue[] {
  const out: CheckIssue[] = [];
  for (const site of opts.callsites) {
    const bindings = targetImportBindings(site, opts);
    if (bindings.size === 0) continue;
    let report: CheckReport;
    try {
      report = checkSource(site.path, site.source, pTrue, {
        ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
        fromFile: site.path,
        ...(opts.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
        ...(opts.projectDir !== undefined ? { projectDir: opts.projectDir } : {}),
      });
    } catch {
      continue; // 现场文件自身分析失败 ⇒ 不造证据（不造门禁）
    }
    for (const issue of report.issues) {
      if (issue.code !== DIAG.constraintViolated) continue;
      const local = issue.fn;
      if (!local) continue;
      const exportName = resolveExportName(local, bindings);
      if (!exportName) continue;
      // core 的消息形状：`${被调名}[${参数位}]: argument ⊭ precondition`
      const key = callSiteKeyOf(issue.message);
      if (!key) continue;
      const shown = plainEvidence(issue.actual);
      out.push({
        severity: "error",
        code: DIAG.interfaceDomainExceeds,
        message: `${exportName}[${key.param}]: cross-file call-site domain evidence ${shown} exceeds handwritten contract`,
        actual: shown,
        ...(issue.expected !== undefined ? { expected: issue.expected } : {}),
        suggestion: `Loosen the handwritten contract for ${exportName} (${key.param}: ${issue.expected ?? "?"}), or fix the caller's values`,
        fn: exportName,
      });
    }
  }
  return out;
}

/**
 * `--from` 两条通道的**去重**（Bug 643）。
 *
 * 执行态通道（分析器 `nudo:interface-domain-exceeds`）与静态通道（本模块的
 * `staticFromDomainIssues`）判的是**同一处事实**（被调方某参数位被调用实参
 * 超出）⇒ 同（被调名, 参数位）只报一条，执行态优先（既有 `--from` 面口径）。
 */
export function dedupeFromStaticIssues(
  staticIssues: readonly CheckIssue[],
  executionIssues: readonly CheckIssue[],
): CheckIssue[] {
  const seen = new Set<string>();
  for (const e of executionIssues) {
    if (e.code !== DIAG.interfaceDomainExceeds) continue;
    const key = callSiteKeyOf(e.message);
    if (key) seen.add(key.key);
  }
  if (seen.size === 0) return [...staticIssues];
  return staticIssues.filter((s) => {
    const key = callSiteKeyOf(s.message);
    return key === undefined || !seen.has(key.key);
  });
}

/** 消息里的「被调名[参数位]」键（两条 `--from` 通道共用同一形状） */
function callSiteKeyOf(
  message: string,
): { key: string; name: string; param: string } | undefined {
  const m = /^([^(]+)\[([^\]]+)\]/.exec(message);
  if (!m) return undefined;
  return { key: `${m[1]}[${m[2]}]`, name: m[1], param: m[2] };
}

/** 字面量证据的裸值（剥掉 `formatAbs` 的 `  #conf` 后缀） */
function plainEvidence(actual: string | undefined): string {
  return (actual ?? "?").replace(/\s+#\w+$/, "");
}

/**
 * 追加 issues 前先与**已有** issues 去重（Bug 632 的双报收口）。
 *
 * check 面有两条通道会报**同一事实**：
 * - `mockFromErrorIssues`（check 面的 mock 通道：`@nudo:mock fs from "..."`
 *   的文件缺失）；
 * - 分析器通道（模块图装载问题：mock 文件缺失 ⇒ `nudo:module-missing`）。
 *
 * 两条通道的**文案逐字相同** ⇒ 白名单扩容后同一条事实会被报两遍（同码同文）。
 * 去重键 = （code, message）⇒ 只在**追加分析器诊断**时用，不改
 * `mergeCheckIssues` 的语义（core 自身可能合法地产生同文多条，如同一函数里
 * 两次同样的调用 ⇒ 那两条的行号不同，属于既有行为，不能动）。
 */
export function dedupeAgainstIssues(
  existing: readonly CheckIssue[],
  candidates: readonly CheckIssue[],
): CheckIssue[] {
  if (candidates.length === 0) return [];
  const seen = new Set(existing.map((i) => `${i.code}\u0000${i.message}`));
  return candidates.filter((i) => !seen.has(`${i.code}\u0000${i.message}`));
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
