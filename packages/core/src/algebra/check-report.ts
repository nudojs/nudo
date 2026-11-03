/**
 * check 报告面：数据模型 + 渲染/序列化。
 *
 * 分析在 check.ts（Abs 优先的 Nudo 原生诊断），这里只投影：
 * - formatCheckReport → 人类可读文本
 * - serializeCheckJson → `nudo check --json` 稳定契约（CI / Agent，v1）
 * - formatGithubAnnotations → PR 行内 `::error` / `::warning`（GHA）
 * - formatGitlabCodeQuality → GitLab Code Quality JSON 数组
 */

import type { Diagnostic } from "./diagnostics.ts";
import type { Abs, Confidence } from "./abs.ts";
import type { Term } from "./term.ts";
import type { Pred } from "./pred.ts";
import { formatAbs, formatShape } from "./format.ts";
import { CHECK_FACE_DIAG_CODES, DIAG } from "./diag-codes.ts";

/**
 * 引擎内部**进程级计数器**变量 id（Bug 413）。
 *
 * `len#N`（`exec/runtime/containers/arr-index.ts` 的 `lenVarSeq`）、
 * `fromIdx#N`、`inv#N`、`#N` 一族的编号来自**模块级自增计数器** ⇒ 编号是
 * **进程历史**的函数，不是**被分析文件**的函数 ⇒ 同一个文件在同一次调用里
 * 换个参数位置就换号（`len#0` / `len#2` / `len#4`）⇒ 机器面载荷不是文件内容
 * 的函数（CI diff / 快照 / 按文件比对都拿不到稳定内容）。
 *
 * 形参 α 名（`A1` / `A2`）**不带** `#` ⇒ 不命中（它们每文件重置、跨文件稳定）。
 */
const INTERNAL_TERM_ID_RE = /^(.*)#\d+$/;

/**
 * 内部计数器 id ⇒ **稳定可读**名（`len#2` → `len`）。
 *
 * 与 S3 的 412 同口径（内部 id 不得当用户面文本），但这里**保留** id 的
 * 词根（`len` / `fromIdx` / `inv`）⇒ Abs 的谓词证据（`len ≥ 0`）不丢。
 */
function stableTermId(id: string): string {
  const m = INTERNAL_TERM_ID_RE.exec(id);
  if (!m) return id;
  return m[1] === "" ? "internal" : m[1];
}

/** term 树：把内部计数器 id 换成稳定名 */
function stableTerm(t: Term): Term {
  if (t.op === "var") return { ...t, id: stableTermId(t.id) };
  if (t.op === "app") return { ...t, args: t.args.map(stableTerm) };
  return t;
}

/** pred 树：把内部计数器 id 换成稳定名 */
function stablePred(p: Pred): Pred {
  switch (p.op) {
    case "eq":
      return { ...p, a: stableTerm(p.a), b: stableTerm(p.b) };
    case "ne":
      return { ...p, a: stableTerm(p.a), b: stableTerm(p.b) };
    case "lt":
      return { ...p, a: stableTerm(p.a), b: stableTerm(p.b) };
    case "le":
      return { ...p, a: stableTerm(p.a), b: stableTerm(p.b) };
    case "gt":
      return { ...p, a: stableTerm(p.a), b: stableTerm(p.b) };
    case "ge":
      return { ...p, a: stableTerm(p.a), b: stableTerm(p.b) };
    case "and":
      return { ...p, args: p.args.map(stablePred) };
    case "or":
      return { ...p, args: p.args.map(stablePred) };
    case "not":
      return { ...p, arg: stablePred(p.arg) };
    case "typeof":
      return { ...p, t: stableTerm(p.t) };
    case "assumeFinite":
      return { ...p, t: stableTerm(p.t) };
    default:
      return p;
  }
}

/**
 * Abs 的**对外渲染副本**：内部计数器 id 换成稳定名。
 *
 * 只影响**展示**（`formatAbs` / `formatAbsMultiline` 读它）⇒ 谓词证据
 * （`len ≥ 0`）与形状 / 置信度 / pathNote 全部保留，只有那个会随进程漂移的
 * 编号被抹平（Bug 413）。
 *
 * ⚠ **模块级导出，不进公开面**：`algebra/index.ts` / `internal.ts` 对本模块
 * 都是**显式列举**导出，本函数不在名单里 ⇒ 公共 API 冻结面零变更。
 */
export function absWithStableTermIds(absVal: Abs): Abs {
  return {
    ...absVal,
    term: absVal.term ? stableTerm(absVal.term) : absVal.term,
    pred: absVal.pred ? stablePred(absVal.pred) : absVal.pred,
  };
}

/** 无损函数签名（类型即计算） */
export type NudoSig = {
  name: string;
  params: string[];
  /** 形参类型展示（入口无约束 = any） */
  paramTypes?: string[];
  /** 符号 Abs 本体 */
  abs: Abs;
  /**
   * 签名展示（**人类面口径**：shape 渲染）——与 `formatCheckReport` 的签名行
   * **逐字同源**（Bug 413：机器面此前用 `formatAbs`，把 term / pred 段渲进
   * 对外载荷，其中混着引擎内部计数器 id `len#N` ⇒ 载荷随参数列表位置漂移）。
   */
  display: string;
  /**
   * 签名明细（多行；首行 = 函数名）——与人类面 `--verbose` 同源。
   * term / pred 里的引擎内部计数器 id 换成**稳定名**（`len#2` → `len`）
   * （Bug 413）。
   */
  detail: string;
  conf: Confidence;
  /** throws 域展示（如 TypeError）；省略 = 无 may-throw */
  throws?: string;
  /** 模块边界入口（export / default / CJS exports） */
  entry?: boolean;
};

export type CheckIssue = Diagnostic & {
  fn?: string;
  line?: number;
  column?: number;
  /** 实参 / 实际值的 Abs 展示 */
  actual?: string;
  /** 期望约束（Pred 或 Abs 展示） */
  expected?: string;
  /**
   * 截断归因（`nudo:recursion-truncated`，issue #158）：
   * `cycle`=同抽象实参调用环（抬预算无效）；`depth`/`calls`=真预算超限；
   * `budget`=混合（cycle+预算或 depth+calls 同报）。
   */
  reason?: "cycle" | "depth" | "calls" | "budget";
  /**
   * AI1：结构化下一步（additive）。agent 优先消费 `actions`，
   * 不必解析 `suggestion` 散文；`command` 可直接执行。
   */
  actions?: CheckAction[];
};

/** 结构化修复动作（AI1；稳定枚举，只增不改语义） */
export type CheckAction = {
  /** draft=生成侧车草稿 · relax=放宽契约 · callsite=改实参 · assume/mock/emit/ignore=辅助 */
  kind: "draft" | "relax" | "callsite" | "assume" | "mock" | "emit" | "ignore-throws" | "info";
  /** agent 可执行命令（无则只读 label/hint） */
  command?: string;
  /** 一行说明（与 suggestion 同源或更短） */
  label: string;
  /** 可选：目标 Pred / 字段名等，供程序化改写 */
  hint?: string;
};

/**
 * 分析器（service）诊断的最小结构面（check 面消费所需的字段子集）。
 * service `Diagnostic` 与 nudojs `DomainDiagnosticLike` 都结构兼容于此。
 */
export type AnalyzerDiagnosticLike = {
  code?: string;
  severity: string;
  message: string;
  range: { start: { line: number; column: number } };
  data?: unknown;
  suggestions?: string[];
};

/**
 * 分析器诊断 → CheckIssue（check 面消费分析器诊断的唯一入口；此前
 * nudojs `check-json-map` 与 lsp `agent-tools` 各手抄一份——Bug 632 / 1038
 * 都是这张面漏抄/吞码的事故）。
 *
 * 白名单 = `CHECK_FACE_DIAG_CODES`（diag-codes.ts，check 面承诺可见的码
 * 集合单一真源）。severity 口径：entry-only 固定 **info**（观察面提示，
 * 不挡门禁）；其余按分析器给的 severity 走（error ⇒ 挡门禁 / exit 1，
 * warning ⇒ 只可见）。`actual`/`expected` 仅 string 才带（data 面可能是
 * Abs 结构）；`suggestion` 取首条。
 */
export function checkIssuesFromDiagnostics(
  diagnostics: readonly AnalyzerDiagnosticLike[],
): CheckIssue[] {
  const allowed = new Set<string>(CHECK_FACE_DIAG_CODES);
  return diagnostics
    .filter(
      (d): d is AnalyzerDiagnosticLike & { code: string } =>
        d.code !== undefined && allowed.has(d.code),
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

export type CheckReport = {
  file: string;
  issues: CheckIssue[];
  /** 有 error 则 CI 应失败 */
  ok: boolean;
  /** Abs 优先的签名表（替代 TS 式 display-only） */
  signatures: NudoSig[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    functions: number;
  };
  /**
   * A2 预算/截断可观测（additive）。`truncated=true` 时部分结果可能已
   * widen 成 unknown——不是契约失败，是引擎预算。
   * evalCalls/evalCallTruncated = B 命名调用（$callNamed）路径；
   * cycleTruncated/reasons = 归因（#158）：cycle 抬 @nudo:budget 无效。
   */
  budget?: {
    truncated: boolean;
    callTruncated: boolean;
    forkTruncated: boolean;
    calls: number;
    maxCalls: number;
    forks: number;
    maxForks: number;
    evalCalls: number;
    maxEvalCalls: number;
    evalCallTruncated: boolean;
    cycleTruncated: boolean;
    /** 循环迭代预算截断（#loop-iterations；maxIters/硬上限，非调用预算） */
    loopTruncated: boolean;
    reasons: string[];
    /** A 路径（enterCall）截断原因——归因到具体预算/路径（depth≠calls 预算） */
    callReasons: string[];
    /** A 路径最大进入深度；depth 截断时 = 触发时深度（== 触发时生效上限） */
    depth: number;
    /** A 路径 depth 上限；depth 截断时 = 触发时生效上限 */
    maxDepth: number;
    /** B 路径（$callNamed）截断原因 */
    evalReasons: string[];
    /** B 路径最大进入深度；depth 截断时 = 触发时深度（== 触发时生效上限） */
    evalDepth: number;
    /** B 路径 depth 上限；depth 截断时 = 触发时生效上限 */
    maxEvalDepth: number;
  };
};

// ---------------------------------------------------------------------------
// 截断/宿主拦截 suggestion 的具体修值与可粘贴骨架（DX：suggestion 不止指
// 「抬预算」，还给可直接落盘的数值/片段）。单源在此，check.ts 的 issue 文案
// 与本文件 actionsForIssue 共用——两面不得各自手写漂移。
// ---------------------------------------------------------------------------

/** 向上取整到 step 的倍数（建议值取整用） */
function ceilTo(n: number, step: number): number {
  return Math.ceil(n / step) * step;
}

/**
 * fork 截断建议上限：`max(20000, 观测 fork 次数 × 1.5 向上取整到千)`。
 * 观测不可得（0 / 非数——理论路径）→ 默认 20000（与 calls 建议 40000 同一
 * 「默认 ×2 起」口径，fork 因单次极廉价再留 2 倍冗余）。
 */
export function suggestedForkCeiling(observedForks: number): number {
  if (!(observedForks > 0)) return 20_000;
  return Math.max(20_000, ceilTo(observedForks * 1.5, 1_000));
}

/** depth 截断建议上限：默认 64×2=128 起，或观测深度 ×2 向上取整到 16 */
export function suggestedDepthCeiling(observedDepth: number): number {
  if (!(observedDepth > 0)) return 128;
  return Math.max(128, ceilTo(observedDepth * 2, 16));
}

/** calls 截断建议上限：默认 20000×2=40000 起，或观测调用数 ×2 向上取整到千 */
export function suggestedCallsCeiling(observedCalls: number): number {
  if (!(observedCalls > 0)) return 40_000;
  return Math.max(40_000, ceilTo(observedCalls * 2, 1_000));
}

/**
 * `nudo:host-effect-blocked` 的可粘贴 `@nudo:mock` 骨架：按宿主全局分族给
 * 最小可用示例。**单行纪律**——`@nudo:mock` 载荷只读到行尾，多行会被截断成
 * `nudo:mock-invalid`，骨架必须一行放得下。
 *
 * 家族选型均实跑验证过：骨架原样粘贴进被分析函数的 JSDoc 后，host-effect-
 * blocked 消失、结果恢复精确——
 * - `fetch`（箭头返回 Response 形状，await res.json() 面）：`=> promise<{ id: 1 }>`
 * - 定时器/调度族（`stub().returns(0)` 即 timer id）：`=> 0`
 * - 构造器族（`new` 只认 stub——箭头 mock 不可构造，`new` 会翻成
 *   `throws TypeError` 假红）：`=> { … }` 精确形状
 *
 * 未知名（拦截面之外的将来成员）返回 undefined，调用方回退通用文案。
 */
export function hostEffectMockSkeleton(hostName: string): string | undefined {
  if (hostName === "fetch") {
    return "@nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })";
  }
  if (
    hostName === "setTimeout" ||
    hostName === "setInterval" ||
    hostName === "setImmediate" ||
    hostName === "queueMicrotask" ||
    hostName === "requestAnimationFrame" ||
    hostName === "requestIdleCallback"
  ) {
    return `@nudo:mock ${hostName} = stub().returns(0)`;
  }
  if (hostName === "WebSocket" || hostName === "EventSource") {
    return `@nudo:mock ${hostName} = stub().returns({ send: () => 1, close: () => 1 })`;
  }
  if (hostName === "XMLHttpRequest") {
    return "@nudo:mock XMLHttpRequest = stub().returns({ open: () => 1, send: () => 1 })";
  }
  return undefined;
}

/**
 * `nudo check --json` 稳定契约（供 CI / Agent）。
 * 字段只增不改语义；Abs 以 formatAbs 字符串给出，不序列化内部 shape 图。
 *
 * ⚠ **Bug 413 的载荷语义变更**（v1 契约内的字段**取值口径**收紧）：
 * - `signatures[].display` 改为**人类面口径**（`formatShape`）⇒ 与 `nudo check`
 *   的 signatures 行**逐字同源**（此前是 `formatAbs` 单行，两面不一致）；
 * - `signatures[].detail` / `signatures[].abs` 里的**引擎内部计数器 id**
 *   （`len#N` 一族）换成**稳定名**（`len#2` → `len`）⇒ 形状 / 谓词证据 /
 *   `#conf` / pathNote 全部保留，只有那个会随进程漂移的编号被抹平。
 *
 * 动机：内部计数器 id 的编号是**进程历史**的函数 ⇒ 同一个文件的载荷曾随
 * 它在命令行参数列表中的位置漂移（`len#0` / `len#2` / `len#4`）⇒ 机器消费
 * 方（CI diff / 快照 / 按文件比对）拿到的不是文件内容的函数。
 */
export type CheckJson = {
  version: 1;
  file: string;
  ok: boolean;
  summary: CheckReport["summary"];
  signatures: Array<{
    name: string;
    params: string[];
    paramTypes?: string[];
    display: string;
    detail: string;
    conf: string;
    abs: string;
    throws?: string;
    entry?: boolean;
  }>;
  issues: Array<{
    severity: string;
    code: string;
    message: string;
    fn?: string;
    line?: number;
    column?: number;
    actual?: string;
    expected?: string;
    suggestion?: string;
    /** 截断归因（nudo:recursion-truncated；issue #158，additive） */
    reason?: CheckIssue["reason"];
    /** AI1：结构化 next-action（只增字段） */
    actions?: CheckAction[];
  }>;
  /** A2：预算用量 / 是否截断（additive） */
  budget?: CheckReport["budget"];
};

/** 诊断码 → 结构化动作（AI1）；未知码给 info 提示 */
export function actionsForIssue(i: {
  code: string;
  expected?: string;
  suggestion?: string;
  fn?: string;
  reason?: string;
}): CheckAction[] {
  const draft: CheckAction = {
    kind: "draft",
    command: "nudo contract --draft",
    label: "emit a sidecar draft you can edit",
  };
  switch (i.code) {
    case DIAG.constraintViolated:
      return [
        {
          kind: "callsite",
          label: "use a value satisfying the constraint",
          ...(i.expected ? { hint: i.expected } : {}),
        },
        {
          kind: "relax",
          label: "relax the precondition (edit *.nudo.js / @nudo:contract)",
          ...(i.expected ? { hint: i.expected } : {}),
        },
        draft,
      ];
    case DIAG.assignMismatch:
      return [
        {
          kind: "callsite",
          label: "align the assigned value with the existing shape",
          ...(i.expected ? { hint: i.expected } : {}),
        },
        draft,
      ];
    case DIAG.entryMayThrow:
      return [
        {
          kind: "draft",
          command: "nudo contract --draft",
          label:
            "narrow the entry with a sidecar fn({ … }) param contract — most honest fix for helpers (also tightens the signature)",
          ...(i.fn ? { hint: i.fn } : {}),
        },
        {
          kind: "relax",
          label: "declare intentional fail-fast: @nudo:throws Error (or case `!! throws`)",
          ...(i.fn ? { hint: i.fn } : {}),
        },
        {
          kind: "info",
          label: "or refine / guard / try-catch the entry so it is total",
        },
        {
          kind: "ignore-throws",
          command: "nudo check --ignore-throws TypeError",
          label: "migration switch: ignore this throw class on L2",
        },
      ];
    case DIAG.unprovenReturn:
      return [
        {
          kind: "relax",
          label: `relax the return contract${i.fn ? ` of ${i.fn}` : ""} to the inferred surface (review the diff — not a silent green)`,
          ...(i.expected ? { hint: i.expected } : {}),
        },
        draft,
        {
          kind: "info",
          label:
            "or narrow the return expression / add a precondition so the bound is implied",
        },
      ];
    case DIAG.unknownInference:
    case DIAG.opaqueResult:
      return [
        { kind: "mock", label: "pin the native/unknown face with @nudo:mock" },
        { kind: "assume", command: "nudo check --assume", label: "state preconditions via --assume" },
        { kind: "info", label: "or add a call site / @nudo:case for evidence" },
      ];
    case DIAG.argOpaque:
    case DIAG.constraintUnproven:
      return [
        { kind: "assume", command: "nudo check --assume", label: "state preconditions via --assume" },
        { kind: "info", label: "add a call site or @nudo:case" },
      ];
    case DIAG.forkTruncated:
    case DIAG.promiseMicroTruncated:
    case DIAG.promiseMicroError:
      return [
        {
          kind: "info",
          label:
            "results widened to unknown — raise budget (@nudo:budget forks/calls/depth on the function) or narrow control flow",
        },
      ];
    case DIAG.loopTruncated:
      // 循环迭代预算 ≠ 调用预算：@nudo:budget calls=/depth= 抬不动
      return [
        {
          kind: "info",
          label:
            "loop state widened — the exit condition stayed concrete-true past the iteration cap; make the bound data-dependent (abstract) or pin the result with @nudo:case / @nudo:contract",
        },
      ];
    case DIAG.recursionTruncated:
      // #158 归因：cycle 不是预算——不得把 agent 引向抬 @nudo:budget
      return [
        {
          kind: "info",
          label:
            i.reason === "cycle"
              ? "call cycle: same abstract arguments already on the stack — raising @nudo:budget cannot lift it; make the arguments vary per recursion level or declare @nudo:contract"
              : i.reason === "depth" || i.reason === "calls" || i.reason === "budget"
                ? `results widened to unknown — raise budget (@nudo:budget ${i.reason === "depth" ? "depth" : i.reason === "calls" ? "calls" : "calls/depth"} on the function) or narrow the recursion`
                : "results widened to unknown — raise budget (@nudo:budget calls/depth on the function) or narrow control flow",
        },
      ];
    case DIAG.hostEffectBlocked: {
      // DX：mock 动作带可直接粘贴的单行骨架（与 check.ts 的 issue suggestion
      // 同源自 hostEffectMockSkeleton）；未知名回退通用指针
      const skeleton = i.fn ? hostEffectMockSkeleton(i.fn) : undefined;
      return [
        {
          kind: "mock",
          label: skeleton
            ? `pin the host API — paste above the calling fn's JSDoc (single line): ${skeleton}`
            : "pin the host API with @nudo:mock / @nudo:env",
        },
        { kind: "info", label: "results widened to unknown — or feed the value in from a call site" },
      ];
    }
    case DIAG.interfaceDrift:
      return [
        {
          kind: "emit",
          command: "nudo contract --emit",
          label: "refresh the @generated segment",
        },
      ];
    case DIAG.dualEntry:
      return [
        {
          kind: "info",
          label:
            "browser/node records do not cross files — analyze the entry you ship; mock or skip the other variant",
        },
      ];
    default:
      return i.suggestion
        ? [{ kind: "info", label: i.suggestion }]
        : [];
  }
}

/** 多文件 `check --json` 信封（CI / monorepo）。单文件仍输出裸 CheckJson。 */
export type CheckJsonMulti = {
  version: 1;
  kind: "multi";
  ok: boolean;
  summary: CheckReport["summary"] & { files: number; budgetTruncated?: boolean };
  budget?: CheckReport["budget"];
  /**
   * 路径/IO 错误（additive）。`pathErrors` 非空 ⇒ `ok: false` ⇒ CLI exit 1。
   * ok↔exit 单一来源：CLI 在 --json 路径只按信封 ok 设 exit。
   */
  pathErrors?: Array<{
    path: string;
    code: string;
    message: string;
    suggestion?: string;
  }>;
  reports: CheckJson[];
};

/**
 * CheckJson issue 的**可选字段**单一真源（顺序即序列化键序）。
 *
 * 序列化（本文件 `serializeCheckJson`）与磁盘缓存反序列化
 * （nudojs `check-json-map.ts` 的 `issueFromCachedJson`）此前互为手抄
 * 镜像——core 加字段后反序列化侧静默不回传（缓存 round-trip 丢字段）。
 * 两侧现都消费本元组。
 */
export const CHECK_ISSUE_OPTIONAL_KEYS = [
  "fn",
  "line",
  "column",
  "actual",
  "expected",
  "suggestion",
  "reason",
] as const;

export function serializeCheckJson(r: CheckReport): CheckJson {
  return {
    version: 1,
    file: r.file,
    ok: r.ok,
    summary: { ...r.summary },
    signatures: r.signatures.map((s) => ({
      name: s.name,
      params: s.params,
      ...(s.paramTypes !== undefined ? { paramTypes: s.paramTypes } : {}),
      display: s.display,
      detail: s.detail,
      conf: s.conf,
      // Bug 413：机器面不得渲出引擎内部计数器 id（`len#N` 一族 —— 编号是
      // **进程历史**的函数 ⇒ 载荷不得是它的函数）⇒ term / pred 里的内部 id
      // 换成**稳定名**（`len#2` → `len`）；形状 / 置信度 / pathNote 不变。
      abs: formatAbs(absWithStableTermIds(s.abs)),
      ...(s.throws ? { throws: s.throws } : {}),
      ...(s.entry ? { entry: true } : {}),
    })),
    issues: r.issues.map((i) => {
      const acts = i.actions ?? actionsForIssue(i);
      // 可选字段经 CHECK_ISSUE_OPTIONAL_KEYS 单源拷贝（键序=元组序）；
      // 独立 sink 消解「联合键写入收敛成 undefined」的 tsc 限制。
      const out: CheckJson["issues"][number] = {
        severity: i.severity,
        code: i.code,
        message: i.message,
      };
      const sink = out as Record<string, unknown>;
      for (const k of CHECK_ISSUE_OPTIONAL_KEYS) {
        const v: unknown = i[k];
        if (v !== undefined) sink[k] = v;
      }
      if (acts.length > 0) out.actions = acts;
      return out;
    }),
    ...(r.budget ? { budget: { ...r.budget } } : {}),
  };
}

/** 多文件信封：汇总 summary，`ok` = 全部文件 ok。 */
export function serializeCheckJsonMulti(reports: CheckJson[]): CheckJsonMulti {
  const summary = {
    errors: 0,
    warnings: 0,
    infos: 0,
    functions: 0,
    files: reports.length,
  };
  let calls = 0;
  let forks = 0;
  let maxCalls = 0;
  let maxForks = 0;
  let callTruncated = false;
  let forkTruncated = false;
  let evalCalls = 0;
  let maxEvalCalls = 0;
  let evalCallTruncated = false;
  let cycleTruncated = false;
  let loopTruncated = false;
  // 归因字段（#health-budget）：reasons 取并集、depth 取各文件观测最大值
  const callReasons = new Set<string>();
  const evalReasons = new Set<string>();
  let depth = 0;
  let maxDepth = 0;
  let evalDepth = 0;
  let maxEvalDepth = 0;
  const reasons = new Set<string>();
  for (const r of reports) {
    summary.errors += r.summary.errors;
    summary.warnings += r.summary.warnings;
    summary.infos += r.summary.infos;
    summary.functions += r.summary.functions;
    if (r.budget) {
      calls += r.budget.calls;
      forks += r.budget.forks;
      maxCalls = Math.max(maxCalls, r.budget.maxCalls);
      maxForks = Math.max(maxForks, r.budget.maxForks);
      callTruncated = callTruncated || r.budget.callTruncated;
      forkTruncated = forkTruncated || r.budget.forkTruncated;
      evalCalls += r.budget.evalCalls ?? 0;
      maxEvalCalls = Math.max(maxEvalCalls, r.budget.maxEvalCalls ?? 0);
      evalCallTruncated = evalCallTruncated || (r.budget.evalCallTruncated ?? false);
      cycleTruncated = cycleTruncated || (r.budget.cycleTruncated ?? false);
      loopTruncated = loopTruncated || (r.budget.loopTruncated ?? false);
      for (const x of r.budget.callReasons ?? []) callReasons.add(x);
      for (const x of r.budget.evalReasons ?? []) evalReasons.add(x);
      depth = Math.max(depth, r.budget.depth ?? 0);
      maxDepth = Math.max(maxDepth, r.budget.maxDepth ?? 0);
      evalDepth = Math.max(evalDepth, r.budget.evalDepth ?? 0);
      maxEvalDepth = Math.max(maxEvalDepth, r.budget.maxEvalDepth ?? 0);
      for (const x of r.budget.reasons ?? []) reasons.add(x);
    }
  }
  const budgetTruncated = callTruncated || evalCallTruncated || forkTruncated || loopTruncated;
  return {
    version: 1,
    kind: "multi",
    ok: reports.every((r) => r.ok),
    summary: {
      ...summary,
      ...(budgetTruncated ? { budgetTruncated: true } : {}),
    },
    ...(budgetTruncated || reports.some((r) => r.budget)
      ? {
          budget: {
            truncated: budgetTruncated,
            callTruncated,
            forkTruncated,
            calls,
            maxCalls,
            forks,
            maxForks,
            evalCalls,
            maxEvalCalls,
            evalCallTruncated,
            cycleTruncated,
            loopTruncated,
            callReasons: [...callReasons].sort(),
            depth,
            maxDepth,
            evalReasons: [...evalReasons].sort(),
            evalDepth,
            maxEvalDepth,
            reasons: [...reasons].sort(),
          },
        }
      : {}),
    reports,
  };
}

/** 契约/门禁类诊断：终端应给出可执行修复路径（draft 侧车 / refine）。 */
const CONTRACT_FIX_CODES = new Set<string>([
  DIAG.constraintViolated,
  DIAG.assignMismatch,
  DIAG.argStructure,
  DIAG.interfaceDomainExceeds,
  DIAG.entryMayThrow,
  DIAG.missingSlot,
]);

/**
 * budget 归因段构建器——check 面（formatCheckReport）与 health 面
 * （nudojs commands/health）单一实现（#health-budget，两处曾各自维护
 * 同一映射而漂移出回归）：只打触发截断的那条预算自己的计数段——
 * depth 截断打 depth/limit 对、calls 截断打计数/上限（必到顶）、
 * cycle 不是预算（无可打的计数）——杜绝「71/20000 却标 truncated」。
 * 参数是 CheckReport.budget 内联对象与 AbsBudgetStats 的结构公共子集
 * （reasons 按 `?? []` 防御，两个来源都必填但防御面保持一致）。
 */
export function budgetAttributionSegs(b: {
  calls: number;
  maxCalls: number;
  /** A 路径（enterCall）截断原因 */
  callReasons?: readonly string[];
  depth: number;
  maxDepth: number;
  evalCalls: number;
  maxEvalCalls: number;
  /** B 路径（$callNamed）截断原因 */
  evalReasons?: readonly string[];
  evalDepth: number;
  maxEvalDepth: number;
  forks: number;
  maxForks: number;
  forkTruncated: boolean;
  loopTruncated: boolean;
}): { segs: string[]; cycleOnly: boolean } {
  const segs: string[] = [];
  if ((b.callReasons ?? []).includes("calls")) segs.push(`calls ${b.calls}/${b.maxCalls}`);
  if ((b.callReasons ?? []).includes("depth")) segs.push(`call depth ${b.depth}/${b.maxDepth}`);
  if ((b.evalReasons ?? []).includes("calls")) {
    segs.push(`eval calls ${b.evalCalls}/${b.maxEvalCalls}`);
  }
  if ((b.evalReasons ?? []).includes("depth")) {
    segs.push(`eval depth ${b.evalDepth}/${b.maxEvalDepth}`);
  }
  if (b.forkTruncated) segs.push(`forks ${b.forks}/${b.maxForks}`);
  if (b.loopTruncated) segs.push("loop iterations");
  // 空段 ⇔ 只有 cycle 触发（cycle 也会置 callTruncated/evalCallTruncated，
  // 但 cycle/depth/calls 三种 reason 里只有 cycle 不产计数段）——归因必须
  // 非空：纯 cycle 截断打「非预算」标签，杜绝「truncated」后空白
  const cycleOnly = segs.length === 0;
  if (cycleOnly) segs.push("call cycle — not a budget limit");
  return { segs, cycleOnly };
}

/**
 * Nudo 原生报告：Abs 签名表 + actual ⊭ expected。
 * 不是 tsc 输出的换皮。
 */
export function formatCheckReport(r: CheckReport, opts: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  lines.push(`nudo check  ${r.file}`);
  lines.push(r.ok ? "OK" : "FAILED");
  lines.push(
    `  ${r.summary.errors} error · ${r.summary.warnings} warning · ${r.summary.infos} info · ${r.summary.functions} fn`,
  );

  // A2：预算截断必须上屏——用户要能知道结果何时被 widen。
  // 归因段与 health 面同一实现（budgetAttributionSegs，#health-budget）；
  // 空段 ⇔ 纯 cycle 触发的兜底段由共享构建器负责。
  if (r.budget?.truncated) {
    const b = r.budget;
    const onlyLoop =
      b.loopTruncated &&
      !b.callTruncated &&
      !b.evalCallTruncated &&
      !b.forkTruncated;
    const { segs } = budgetAttributionSegs(b);
    lines.push("");
    lines.push("budget");
    lines.push(`  truncated  ${segs.join(" · ")}`);
    lines.push(
      r.budget.cycleTruncated
        ? `  → some results widened to unknown (not a contract failure) — includes call cycles (same abstract args; a budget cannot lift them)`
        : onlyLoop
          ? `  → loop state widened (iteration budget, not a contract failure) — @nudo:budget does not apply; make the bound data-dependent or pin with @nudo:case / @nudo:contract`
          : `  → some results widened to unknown (not a contract failure) — raise @nudo:budget / nudo.analysis.maxForks or simplify recursion`,
    );
  }

  // 签名始终上屏（成功也不静默）；入口 any 不得打成 unknown（design §1.1）
  if (r.signatures.length > 0) {
    lines.push("");
    lines.push("signatures");
    for (const s of r.signatures) {
      const paramStr =
        s.paramTypes && s.paramTypes.length > 0
          ? s.params.map((p, i) => `${p}: ${s.paramTypes![i] ?? "any"}`).join(", ")
          : s.params.join(", ");
      const throwsStr = s.throws ? `  throws ${s.throws}` : "";
      // display 是**人类面口径**的 shape 渲染（Bug 413 起与机器面同源），
      // 可含嵌套 `=>`；禁止用 `=>` regex 抠返回（HOF 会误截成 `? }`）。
      const displayBase = s.display.replace(/\s+throws\s+[\s\S]+$/, "").trim();
      const shapeK = s.abs?.shape?.k;
      const looksLikeFakeAny =
        shapeK === "any" && displayBase.length > 0 && !/^any(\b|$)/.test(displayBase);
      const retStr =
        !looksLikeFakeAny && shapeK
          ? formatShape(s.abs) || displayBase.replace(/\s+#\w+$/, "").trim()
          : displayBase.replace(/\s+#\w+$/, "").trim();
      lines.push(`  ${s.name}(${paramStr}) => ${retStr}${throwsStr}`);
      if (opts.verbose) {
        for (const ln of s.detail.split("\n").slice(1)) {
          lines.push(`  ${ln}`);
        }
      }
    }
  }

  if (r.issues.length === 0) {
    lines.push("");
    lines.push("(no issues)");
  } else {
    lines.push("");
    lines.push("issues");
    for (const i of r.issues) {
      const loc = i.line != null ? `L${i.line}` : "";
      const head = [i.severity.toUpperCase(), loc, i.fn].filter(Boolean).join(" ");
      lines.push(`  [${head}] ${i.message}  (${i.code})`);
      // slim 默认：error 保 actual/expected 产品面；warning/info 单行（细节走 --json）
      const showDetail = i.severity === "error" || opts.verbose;
      if (showDetail && i.actual) lines.push(`      actual:   ${i.actual}`);
      if (showDetail && i.expected) lines.push(`      expected: ${i.expected}`);
      if (i.suggestion) {
        lines.push(`      → ${i.suggestion}`);
      } else if (CONTRACT_FIX_CODES.has(i.code)) {
        lines.push(`      → add a refine / sidecar contract, or fix the call-site value`);
      }
      if (CONTRACT_FIX_CODES.has(i.code)) {
        lines.push(`      fix:  nudo contract --draft  (emit a sidecar draft you can edit)`);
      }
    }
  }
  return lines.join("\n");
}

/** GHA workflow command 转义：% → %25，\r → %0D，\n → %0A */
function escapeGhaData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeGhaProp(s: string): string {
  return escapeGhaData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/**
 * 工作区根裁剪（Bug 373）：`startsWith` 是**纯字符串前缀**判定，没有路径
 * 边界 ⇒ 兄弟目录（`…/app` vs `…/app2`）被裁成 `2/src/x.js`（指向**不存在**
 * 的文件）⇒ GHA `file=` / GitLab `location.path` / `fingerprint` 全错。
 *
 * 口径：前缀命中后，余下部分必须是**空**或以**路径分隔符**开头 ⇒ 才是
 * 「同一棵树下的子路径」；否则（`app2` vs `app`）原样保留完整路径。
 */
function stripWorkspaceRoot(file: string, workspaceRoot?: string): string {
  if (!workspaceRoot) return file;
  if (!file.startsWith(workspaceRoot)) return file;
  const rest = file.slice(workspaceRoot.length);
  // 前缀不是路径边界（`…/app2` 命中 `…/app`）⇒ 不裁
  if (rest !== "" && !/^[/\\]/.test(rest)) return file;
  return rest.replace(/^[/\\]/, "");
}

/**
 * GitHub Actions 行内注解（PR Files changed 红/黄标）。
 * 协议：`::error file=…,line=…,col=…,title=…::message`
 * 详见 https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions
 */
export function formatGithubAnnotations(
  r: CheckReport,
  opts: { workspaceRoot?: string } = {},
): string {
  const lines: string[] = [];
  const file = stripWorkspaceRoot(r.file, opts.workspaceRoot);
  for (const i of r.issues) {
    const level =
      i.severity === "error" ? "error" : i.severity === "warning" ? "warning" : "notice";
    const line = i.line ?? 1;
    const col = (i.column ?? 0) + 1;
    const title = escapeGhaProp(i.code);
    const msgBits = [i.message];
    if (i.actual && i.expected) msgBits.push(`${i.actual} ⊭ ${i.expected}`);
    else if (i.suggestion) msgBits.push(i.suggestion);
    if (CONTRACT_FIX_CODES.has(i.code)) {
      msgBits.push(`fix: nudo contract --draft`);
    }
    const msg = escapeGhaData(msgBits.join(" · "));
    const props = [
      `file=${escapeGhaProp(file)}`,
      `line=${line}`,
      `col=${col}`,
      `title=${title}`,
    ].join(",");
    lines.push(`::${level} ${props}::${msg}`);
  }
  return lines.join("\n");
}

export type GitlabCodeQualityIssue = {
  description: string;
  check_name: string;
  fingerprint: string;
  severity: "major" | "minor" | "info" | "blocker" | "critical";
  location: { path: string; lines: { begin: number } };
};

/** GitLab Code Quality 报告数组（`--gitlab`；可写 gl-code-quality-report.json） */
export function formatGitlabCodeQuality(
  r: CheckReport,
  opts: { workspaceRoot?: string } = {},
): GitlabCodeQualityIssue[] {
  const file = stripWorkspaceRoot(r.file, opts.workspaceRoot);
  return r.issues.map((i) => {
    const begin = i.line ?? 1;
    const severity =
      i.severity === "error"
        ? "major"
        : i.severity === "warning"
          ? "minor"
          : "info";
    const description =
      i.actual && i.expected
        ? `${i.message} (${i.actual} ⊭ ${i.expected})`
        : i.message;
    // 稳定指纹：file + code + line + message（GitLab 用于去重/趋势）
    const fingerprint = `${file}:${i.code}:${begin}:${i.message}`;
    return {
      description,
      check_name: i.code,
      fingerprint,
      severity,
      location: { path: file, lines: { begin } },
    };
  });
}
