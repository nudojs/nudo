/**
 * ABS-14 PR3：函数级带界摘要的快路径（不重跑 body）。
 *
 * sound 口径（2026-11-13 修订：门禁收紧为「完整前置 + 位置对齐 + 实参同构」）：
 * - 摘要来自一次**真实 body 求值**（`summaryScope` 已限定纯上下文：无
 *   refine / inject / 自定义 budget、依赖指纹可信），不是从 AST 发明；
 * - 形成时按**实参位置**记录形参占位符（`formals[j]` = 第 j 个实参的顶层
 *   var id）与每个实参的 α-归一结构键（`argKeys`，含 conf）。任一实参不是
 *   顶层 var term、或出现同名实参 ⇒ 该条目不可复用（fail-closed）；
 * - 命中前必须全部满足：形参个数 = 当前实参个数、每个实参都是顶层 var term、
 *   逐位 `argKeys` 相等（同构：shape × term × pred × conf）、post 的自由变元
 *   都属于 formals、形成时的**完整 Φ**（`pre`）经位置重命名后被当前 Φ 蕴含。
 *   任一不满足 => 回退 body（fail-closed）；
 * - `bounds` 是 `pre` 的简单投影（可观测 / 展示用），**不参与判定**：只查简单
 *   合取支会漏掉含 `app` term 的支，把强 Φ 下的结论放到弱 Φ 上复用
 *   （2026-11-13 修复的缺陷类，见 `abs14-fastpath.test.ts` 的对抗样本）；
 * - 命中用 `substAbs(post, map)` 把 formals 整 Abs 换成当前实参，而不是
 *   改名了事；结果必须 ≡ body 路径逐字节一致（等价性门禁）。
 *
 * 三条保守通道（2026-11-10 续：全部启用）：
 * - `crossModule`：新 PolyFn 实例首次实例化时复用函数级摘要；
 * - `bodyUnavailable` / `budgetTruncated`：body 路径 fail-closed 出
 *   `unknown #opaque` 时，用同函数**之前真实 body 求值**写下的摘要补上结论。
 *   独立验证见 `abs14-degraded-channels.test.ts`：替换结果 ≡ 同函数 body
 *   可用时的真实结论，且无摘要 / 形状不符 / 界不成立 / 变元未映射时一律
 *   保持 `unknown #opaque`（fail-closed），绝不静默放宽。
 *
 * 门禁口径（计划 §5 决策第 3 条的细化）：
 * - `crossModule`：快路径 ≡ **当前** body 路径（`diffAgainstBodyBaseline`）；
 * - 降级通道：当前 body 路径本就没有结论，等价对象改为「同函数 body 可用
 *   时的真实结论」。两者都不得一侧更宽。
 *
 * 当前引擎把两类降级都归一成 `unknown #opaque`，因此两开关共用同一触发点，
 * 独立保留以便 body 失败原因可观测后按原因细分。
 */
import type { Abs } from "../abs.ts";
import { substAbs } from "../hof.ts";
import { implies, type Phi, type Pred } from "../pred.ts";
import { absKeyWithConf } from "./abs-key.ts";
import {
  collectAbsFreeVars,
  renamePred,
  type VarRename,
} from "./generalize-key.ts";
import type { FnSummaryEntry, FnSummaryFields } from "./fn-summary.ts";
import { collectSimpleBounds } from "./summary-bounds.ts";

export type FastPathChannels = {
  crossModule: boolean;
  bodyUnavailable: boolean;
  budgetTruncated: boolean;
};

/** 出厂默认：三条保守通道全部启用（降级通道经独立验证后默认开启）。 */
export const ABS14_DEFAULT_CHANNELS: Readonly<FastPathChannels> = Object.freeze({
  crossModule: true,
  bodyUnavailable: true,
  budgetTruncated: true,
});

const channels: FastPathChannels = { ...ABS14_DEFAULT_CHANNELS };

export function setAbs14FastPathChannels(next: Partial<FastPathChannels>): void {
  Object.assign(channels, next);
}

/** 返回内部状态本身（只读视图）：`run()` 每次都会查，常驻分配不必要。 */
export function getAbs14FastPathChannels(): Readonly<FastPathChannels> {
  return channels;
}

/**
 * 按**位置**取形参占位符 id：第 j 个实参必须是顶层 var term。
 *
 * 任一位不是 var（字面量 / 复合 Abs）⇒ 无法把摘要表达成「formals 的函数」；
 * 出现同名实参（`f(x, x)`）⇒ 位置↔名字多义 ⇒ 一律返回 undefined（不可复用）。
 * 零实参返回 `[]`：摘要退化成常量结论，仍要求 post 无自由变元、`pre` 被蕴含。
 * 字典序 / 声明序混用曾导致实参置换（2026-11-13 修复）。
 */
function positionalFormals(args: readonly Abs[]): string[] | undefined {
  const out: string[] = [];
  for (const a of args) {
    const t = a.term;
    if (t?.op !== "var") return undefined;
    out.push(t.id);
  }
  if (new Set(out).size !== out.length) return undefined;
  return out;
}

/**
 * 位置对齐的 α-归一键：`formals[j] → αj`，再取含 conf 的结构键。
 *
 * 所有调用各自归一 ⇒ 键只反映「第 j 个实参的结构」，与变元名无关；
 * shape / term / pred / conf 任一不同即不同构（同 kind 异形不再误命中）。
 */
function positionalArgKeys(args: readonly Abs[], formals: readonly string[]): string[] {
  const rename: VarRename = new Map(formals.map((id, i) => [id, `α${i}`] as const));
  return args.map((a) => absKeyWithConf(a, new Set(), rename));
}

/** 形成函数级摘要时登记的可选字段（界只保留简单条件，且不参与命中判定）。 */
export function fnLevelFields(
  args: readonly Abs[],
  phi: Phi,
  varOrder: readonly string[],
): FnSummaryFields {
  const formals = positionalFormals(args);
  const bounds: Pred[] =
    varOrder.length > 0
      ? collectSimpleBounds(phi, varOrder, varOrder.length - 1).filter(
          (p) => p.op !== "true",
        )
      : [];
  return {
    ...(formals !== undefined
      ? { formals, argKeys: positionalArgKeys(args, formals) }
      : {}),
    bounds,
    pre: phi,
    eff: [],
  };
}

export type FastPathResult = { post: Abs } | { miss: string };

/**
 * 尝试命中函数级摘要；返回 miss 原因（可观测）而不是悄悄放宽。
 *
 * 检查顺序按「便宜 → 昂贵」：结构计数 / 自由变元先过，谓词蕴含与实参键
 * （遍历 Abs 全树）在后。任何一条不过都 fail-closed 回退 body。
 */
export function tryFnLevelFastPath(
  entry: FnSummaryEntry,
  args: readonly Abs[],
  phi: Phi,
): FastPathResult {
  const formals = entry.formals;
  if (formals === undefined) return { miss: "no-formals" };
  if (formals.length !== args.length) return { miss: "formal-arity" };
  const current = positionalFormals(args);
  if (current === undefined) return { miss: "unmapped" };
  for (const id of collectAbsFreeVars(entry.post)) {
    if (!formals.includes(id)) return { miss: "free-var" };
  }
  // 完整前置：形成时的 Φ 必须被当前 Φ 蕴含。只查简单界会漏掉 app term 等
  // 合取支（强 Φ 的结论被放到弱 Φ 上复用）。
  const pre = entry.pre;
  if (pre === undefined) return { miss: "no-pre" };
  const rename: VarRename = new Map(
    formals.map((id, i) => [id, current[i]!] as const),
  );
  if (!implies(phi, renamePred(pre, rename))) return { miss: "pre" };
  // 实参同构：逐位结构键相等（shape × term × pred × conf）。
  const argKeys = entry.argKeys;
  if (argKeys === undefined || argKeys.length !== args.length) {
    return { miss: "no-arg-keys" };
  }
  const curKeys = positionalArgKeys(args, current);
  for (let i = 0; i < argKeys.length; i++) {
    if (argKeys[i] !== curKeys[i]) return { miss: "args" };
  }
  const map = new Map<string, Abs>();
  for (let i = 0; i < formals.length; i++) map.set(formals[i]!, args[i]!);
  return { post: substAbs(entry.post, map) };
}

/**
 * 降级通道（body 不可用 / 预算截断）：只把 fail-closed 的
 * `unknown #opaque` 换成同函数真实 body 求值写下的摘要结论。
 *
 * 与 `tryFnLevelFastPath` 共用全部 sound 检查；额外两条前置：
 * - 当前结果不是 `unknown #opaque` ⇒ 不碰（已有结论不许被覆盖）；
 * - 摘要不存在 ⇒ 保持无信息（绝不编造或放宽）。
 * 返回 miss 原因可观测，便于夹具逐条钉住。
 */
export function tryDegradedChannel(
  current: Abs,
  entry: FnSummaryEntry | undefined,
  args: readonly Abs[],
  phi: Phi,
): FastPathResult {
  if (current.shape.k !== "unknown" || current.conf !== "opaque") {
    return { miss: "not-degraded" };
  }
  if (entry === undefined) return { miss: "no-summary" };
  return tryFnLevelFastPath(entry, args, phi);
}
