/**
 * 差分 harness：evaluator（transpile + exec）vs vm.runInNewContext strict native 对照。
 * 每条语料是「隐式 return」的语句体，由 __run 包装执行。
 *
 * 比较规则（diff3 同源）：
 * - eval 产非具体 Abs 且未抛错（concrete() 返回 undefined）→ 值域无法比较，
 *   记入 skipped 台账；其中不在 skip-baseline.json 基线内的新增 skip =
 *   门禁失败（unknown 回归不得静默漏网——Bug 33/38 机制）；
 * - eval 结果 Abs 为 never（引擎证明必抛，NudoThrow 被
 *   callTranspiledExportFull 折进 result=never）→ 按 throws 通道对账：
 *   native 未抛 = FALSE-THROW；native 同抛 = 相等（bug 46/48/60/71 的
 *   掩蔽通道已关）；
 * - eval 抛错（宿主异常）→ 走 FALSE-THROW 对账：native 未抛 → FALSE-THROW
 *   MISMATCH；native 同抛 → 对账相等（THROW 域两侧均钉住，计入 compared）；
 * - native 抛错而 eval 给非 never 抽象值 → MISSED-THROW（值域展示
 *   formatShape 域；engineNoThrow = 引擎声称不可能抛 = 错误定值）。
 *   sound 过近似（throws 域已建模）钉 knownMissedThrows 豁免+告警；
 * - native 抛错而 eval 折具体值 → 假精确 MISMATCH；
 * - 两侧具体值不等 → MISMATCH。
 *
 * concrete() 盲区（open obj / undefined 元素）且 native 未抛的行才是合法
 * skip，逐条钉在 skip-baseline.json（key = `<batch>.<section>`，如
 * "batch1.corpus1"）；基线收缩只 console.warn 不失败（收紧基线是人工
 * 动作）。compared 下限门禁照旧防语料整体退化；skip 基线门禁防单行退化
 * （compared 下限看不见）。
 */
// 直引 src 入口：vitest 下 `@nudojs/core` 经 node_modules → dist（构建产物
// 滞后于工作区源码），差分门禁要对照**当前源码**的引擎行为——引擎修复
// 未重建 dist 时 dist 侧假绿/假红都会掩蔽真实回归
import { runTranspiled, callTranspiledExportFull, litValue, formatShape } from "../../../index.ts";
import { getPropFlags } from "../../builtins.ts";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function ser(x: unknown): string {
  if (x === undefined) return "undefined";
  if (typeof x === "number" && Number.isNaN(x)) return "NaN";
  if (typeof x === "number" && Object.is(x, -0)) return "-0";
  if (typeof x === "number") return String(x);
  if (typeof x === "bigint") return x.toString() + "n";
  if (typeof x === "string") return JSON.stringify(x);
  if (typeof x === "boolean") return String(x);
  if (x === null) return "null";
  if (Array.isArray(x)) return "[" + x.map(ser).join(",") + "]";
  if (typeof x === "object") {
    try {
      const out: Record<string, unknown> = {};
      let hasNonEnum = false;
      for (const k of Object.keys(x)) {
        const d = Object.getOwnPropertyDescriptor(x, k);
        if (d && d.enumerable === false) {
          hasNonEnum = true;
          continue;
        }
        out[k] = (x as never)[k];
      }
      const s = JSON.stringify(out);
      if (s === undefined) return String(x);
      return hasNonEnum ? s + "#(nonenum-hidden)" : s;
    } catch {
      return String(x);
    }
  }
  return String(x);
}

function concrete(a: any): unknown {
  if (!a || typeof a !== "object") return a;
  const lvR = litValue(a);
  if (lvR.ok) return lvR.value;
  const k = a.shape?.k;
  if (k === "tuple") {
    const els = a.shape.elements.map(concrete);
    if (els.some((e: unknown) => e === undefined)) return undefined;
    return els;
  }
  if (k === "obj") {
    const out: Record<string, unknown> = {};
    const flags = getPropFlags(a);
    for (const [key, s] of Object.entries(a.shape.slots as Record<string, never>)) {
      if (flags?.get(key)?.enumerable === false) continue;
      const v = concrete((s as { value: unknown }).value);
      if (v === undefined) return undefined;
      out[key] = v;
    }
    return out;
  }
  return undefined;
}

function native(body: string): string {
  try {
    // URL / URLSearchParams / TextDecoder：引擎侧自由标识符漏入宿主全局
    // （主 realm）而 vm 新 context 不带 Node 宿主全局——补齐对齐比较面
    // （corpus 有 new URL / URLSearchParams / TextDecoder(...) 值语义行）
    // 包裹形：普通函数 IIFE（strict）——与引擎侧 `export function __run()`
    // 包裹同形（函数有自身 arguments/this 绑定面），消除旧箭头 IIFE 的
    // this/arguments 词法不对称（箭头无自有绑定：`arguments` 读会假抛
    // ReferenceError、this 落 vm global 而引擎侧为 undefined）
    return ser(
      vm.runInNewContext(
        `((function(){'use strict';${body}}))()`,
        { URL, URLSearchParams, TextDecoder },
      ),
    );
  } catch (e: unknown) {
    return "THROW:" + ((e as Error)?.message ?? String(e));
  }
}

type EvalSide = {
  res: string | undefined;
  throws: boolean;
  /** concrete() 盲区时的形状域（MISSED-THROW 展示用） */
  domain?: string;
  /** 引擎 throws 域为 never = 引擎声称不可能抛错（MISSED-THROW 时 = 错误定值） */
  engineNoThrow?: boolean;
};

function evalAbs(body: string): EvalSide {
  try {
    const exports = runTranspiled(`export function __run() {\n${body}\n}`, {
      mode: "exec",
      maxLoopIters: 2000,
    });
    const full = callTranspiledExportFull(exports, "__run", []);
    // never 结果 = 引擎证明必抛（NudoThrow 被 callTranspiledExportFull 折进
    // result=never 而非宿主抛出）。此前 concrete()(never)=undefined → 静默 skip，
    // 就是 bug 46/48/60/71 的掩蔽通道——映射到 throws 通道走 FALSE-THROW 对账。
    if (full.result?.shape?.k === "never") return { res: undefined, throws: true };
    const c = concrete(full.result);
    return c === undefined
      ? {
          res: undefined,
          throws: false,
          domain: formatShape(full.result),
          engineNoThrow: full.throws?.shape?.k === "never",
        }
      : { res: ser(c), throws: false };
  } catch {
    return { res: undefined, throws: true };
  }
}

/** 单条对账核心：n = native 串（含 THROW: 前缀域），b = eval 结果。 */
function compareBody(body: string, n: string, b: EvalSide): string | null {
  const label = `[${body.replace(/\n/g, " ").slice(0, 100)}]`;
  if (b.throws) {
    // 引擎实抛 / never 结果（引擎证明必抛）：不再静默跳过——native 未抛 =
    // FALSE-THROW；native 同抛 = 相等
    return n.startsWith("THROW:") ? null : `FALSE-THROW native=${n}  ${label}`;
  }
  if (b.res === undefined) {
    // concrete() 盲区行也要对 throw 域对账：native 抛错而引擎给非 never
    // 抽象值 → MISSED-THROW（此前静默 skip——bug 46/48/60/71 的掩蔽模式）。
    // engineNoThrow = 引擎 throws 域也为 never（声称不可能抛）= 错误定值；
    // 否则值域是过近似但 throws 已建模（sound，钉 knownMissedThrows）。
    if (n.startsWith("THROW:")) {
      return `MISSED-THROW native=${n} eval=${b.domain ?? "abstract"}${b.engineNoThrow ? " engineNoThrow" : ""}  ${label}`;
    }
    return null; // 非具体 Abs 且 native 未抛，无法比较（由 runCorpus 记入 skipped）
  }
  if (n.startsWith("THROW:")) {
    return `MISMATCH native=${n} eval=${b.res}  ${label}`;
  }
  if (n !== b.res) {
    return `MISMATCH native=${n} eval=${b.res}  ${label}`;
  }
  return null;
}

export function diffBody(body: string): string | null {
  return compareBody(body, native(body), evalAbs(body));
}

export function runCorpus(corpus: string[]): {
  compared: number;
  mismatches: string[];
  skipped: string[];
} {
  let compared = 0;
  const mismatches: string[] = [];
  const skipped: string[] = [];
  for (const body of corpus) {
    const b = evalAbs(body);
    const m = compareBody(body, native(body), b);
    if (m) {
      compared++; // 已对账且分歧（FALSE-THROW / MISSED-THROW / MISMATCH）
      mismatches.push(m);
    } else if (b.throws || b.res !== undefined) {
      compared++; // 对账相等（含引擎证明必抛 = native 同抛的 THROW 域相等）
    } else {
      skipped.push(body); // concrete() 盲区且 native 未抛：合法 skip，进基线门禁
    }
  }
  return { compared, mismatches, skipped };
}

// ---- skip 基线门禁 ----------------------------------------------------
// skip-baseline.json：
// - skips：key = `<batch>.<section>` → 该节当前合法 skip 的语料体
//   （concrete() 盲区快照，native 未抛错）。新增 skip（不在基线内）=
//   新增 unknown 回归 = 门禁失败；基线收缩（引擎变精确）只 console.warn，
//   不失败。
// - knownFalseThrows：body → 一行理由。FALSE-THROW 金丝雀（引擎 result=never
//   而 native 返回值）——引擎缺陷未修期间豁免于门禁（DEC-006 同款：带理由
//   响亮告警，绝不静默吞掉），修复后收紧。
// - knownMissedThrows：body → 一行理由。MISSED-THROW 钉：native 抛错而引擎
//   给非 never 抽象值。sound 过近似（引擎 throws 域已建模）可长期钉；
//   engineNoThrow（引擎声称不可能抛）= 错误定值 = bug 金丝雀，钉必须带
//   「reported」理由并在修复后收紧。
// 钉按类别 + 标签（body 前 100 字符）匹配：FALSE-THROW 钉不掩盖同类语料的
// 新 MISMATCH / MISSED-THROW。

interface SkipBaseline {
  skips: Record<string, string[]>;
  knownFalseThrows: Record<string, string>;
  knownMissedThrows: Record<string, string>;
}

const SKIP_BASELINE_URL = new URL("./skip-baseline.json", import.meta.url);
let skipBaselineCache: SkipBaseline | undefined;

function loadSkipBaseline(): SkipBaseline {
  if (skipBaselineCache) return skipBaselineCache;
  try {
    const parsed = JSON.parse(readFileSync(SKIP_BASELINE_URL, "utf8")) as Partial<SkipBaseline>;
    skipBaselineCache = {
      skips: parsed.skips ?? {},
      knownFalseThrows: parsed.knownFalseThrows ?? {},
      knownMissedThrows: parsed.knownMissedThrows ?? {},
    };
  } catch {
    skipBaselineCache = { skips: {}, knownFalseThrows: {}, knownMissedThrows: {} }; // 基线缺失 → fail-closed：任何 skip 都是新增
  }
  return skipBaselineCache;
}

/** mismatch 串尾部的 `[body]` 标签（与 compareBody 的 label 同构）。 */
function labelOf(body: string): string {
  return `[${body.replace(/\n/g, " ").slice(0, 100)}]`;
}

/** 新增 skip 检出：返回不在基线内的 skip 体（= 新 unknown 回归）；基线收缩仅告警。 */
export function newSkippedBodies(key: string, skipped: string[]): string[] {
  const base = loadSkipBaseline().skips[key];
  if (!base) return skipped.slice();
  const known = new Set(base);
  const fresh = skipped.filter((s) => !known.has(s));
  const gone = base.filter((s) => !skipped.includes(s));
  if (gone.length > 0) {
    console.warn(
      `[skip-baseline] ${key}: ${gone.length} baseline line(s) no longer skipped — engine got more precise; consider tightening skip-baseline.json`,
    );
  }
  return fresh;
}

/**
 * 门禁用 mismatch 过滤：剔除金丝雀钉体（DEC-006 同款：带理由响亮告警，
 * 绝不静默吞掉），修复后收紧。
 * - knownFalseThrows：FALSE-THROW 钉（引擎 result=never 而 native 返回值）；
 * - knownMissedThrows：MISSED-THROW 钉（native 抛错而引擎给非 never 抽象值）。
 * 钉按类别 + 标签匹配（FALSE-THROW 钉不掩盖同类语料的新 MISMATCH/MISSED-THROW）。
 * `corpus`（本节语料）用于收紧提示的精确范围：钉体在本节语料内却不再以
 * 钉住的类别复现 → 提示收紧；不在本节语料内的钉不误报（钉是全局的，
 * 节内对账看不见别节的复现）。
 * 返回应让门禁失败的 mismatch。
 */
export function unexpectedMismatches(mismatches: string[], corpus?: string[]): string[] {
  const base = loadSkipBaseline();
  const pinWhy = (pins: Record<string, string>) =>
    new Map<string, string>(Object.entries(pins).map(([b, why]) => [labelOf(b), why] as const));
  const ftPins = pinWhy(base.knownFalseThrows);
  const mtPins = pinWhy(base.knownMissedThrows);
  const stillFt: string[] = [];
  const stillMt: string[] = [];
  const out: string[] = [];
  for (const m of mismatches) {
    const at = m.lastIndexOf("  [");
    const label = at >= 0 ? m.slice(at + 2) : "";
    const why = m.startsWith("FALSE-THROW")
      ? ftPins.get(label)
      : m.startsWith("MISSED-THROW")
        ? mtPins.get(label)
        : undefined;
    if (why !== undefined) {
      (m.startsWith("FALSE-THROW") ? stillFt : stillMt).push(`${m} — ${why}`);
      continue;
    }
    out.push(m);
  }
  if (stillFt.length > 0) {
    console.warn(
      `[known-false-throw canary] ${stillFt.length} pinned FALSE-THROW(s) still reproducing (rationale in skip-baseline.json#knownFalseThrows):\n${stillFt.join("\n")}`,
    );
  }
  if (stillMt.length > 0) {
    console.warn(
      `[known-missed-throw pin] ${stillMt.length} pinned MISSED-THROW(s) still reproducing (rationale in skip-baseline.json#knownMissedThrows):\n${stillMt.join("\n")}`,
    );
  }
  const tighten = (pins: Record<string, string>, kind: string, tag: string) => {
    for (const p of Object.keys(pins)) {
      if (corpus !== undefined && !corpus.includes(p)) continue; // 钉体不在本节语料 → 不误报
      if (!mismatches.some((m) => m.startsWith(kind) && m.endsWith(labelOf(p)))) {
        console.warn(`[${tag}] no longer reproduces — tighten skip-baseline.json: [${p}]`);
      }
    }
  };
  tighten(base.knownFalseThrows, "FALSE-THROW", "known-false-throw canary");
  tighten(base.knownMissedThrows, "MISSED-THROW", "known-missed-throw pin");
  return out;
}

/** 语料模块的命名导出数组 → [label, corpus] 对 */
export function sectionsOf(mod: Record<string, unknown>): Array<[string, string[]]> {
  return Object.entries(mod)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => [k, v as string[]]);
}
