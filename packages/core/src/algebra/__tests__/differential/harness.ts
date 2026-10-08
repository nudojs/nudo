/**
 * 差分 harness：evaluator（transpile + exec）vs vm.runInNewContext strict native 对照。
 * 每条语料是「隐式 return」的语句体，由 __run 包装执行。
 *
 * 比较规则（diff3 同源）：
 * - eval 产非具体 Abs 且未抛错（concrete() 返回 undefined）→ 无法比较，
 *   记入 skipped 台账；其中不在 skip-baseline.json 基线内的新增 skip =
 *   门禁失败（unknown 回归不得静默漏网——Bug 33/38 机制）；
 * - eval 抛错 → 走 FALSE-THROW 对账：native 未抛 → FALSE-THROW MISMATCH；
 *   native 同抛 → 对账相等（THROW 域两侧均钉住，计入 compared）；
 * - native 抛错而 eval 折具体值 → 假精确 MISMATCH；
 * - 两侧具体值不等 → MISMATCH。
 *
 * concrete() 盲区（open obj / undefined 元素）是合法 skip，逐条钉在
 * skip-baseline.json（key = `<batch>.<section>`，如 "batch1.corpus1"）；
 * 基线收缩只 console.warn 不失败（收紧基线是人工动作）。compared 下限
 * 门禁照旧防语料整体退化；skip 基线门禁防单行退化（compared 下限看不见）。
 */
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";
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
    // URL：引擎侧自由标识符漏入宿主全局（主 realm）而 vm 新 context 不带
    // Node 宿主全局——补齐对齐比较面（corpus 有 new URL(...) 值语义行）
    return ser(vm.runInNewContext(`(()=>{'use strict';${body}})()`, { URL }));
  } catch (e: unknown) {
    return "THROW:" + ((e as Error)?.message ?? String(e));
  }
}

function evalAbs(body: string): { res: string | undefined; throws: boolean } {
  try {
    const exports = runTranspiled(`export function __run() {\n${body}\n}`, {
      mode: "exec",
      maxLoopIters: 2000,
    });
    const full = callTranspiledExportFull(exports, "__run", []);
    const c = concrete(full.result);
    return { res: c === undefined ? undefined : ser(c), throws: false };
  } catch {
    return { res: undefined, throws: true };
  }
}

/** 单条对账核心：n = native 串（含 THROW: 前缀域），b = eval 结果。 */
function compareBody(body: string, n: string, b: { res: string | undefined; throws: boolean }): string | null {
  const label = `[${body.replace(/\n/g, " ").slice(0, 100)}]`;
  if (b.throws) {
    // 引擎实抛：不再静默跳过——native 未抛 = FALSE-THROW；native 同抛 = 相等
    return n.startsWith("THROW:") ? null : `FALSE-THROW native=${n}  ${label}`;
  }
  if (b.res === undefined) return null; // 非具体 Abs，无法比较（由 runCorpus 记入 skipped）
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
    if (b.throws || b.res !== undefined) {
      compared++;
      const m = compareBody(body, native(body), b); // 引擎抛错行也走 FALSE-THROW 对账
      if (m) mismatches.push(m);
    } else {
      skipped.push(body); // 非具体非抛错：concrete() 盲区，进 skip 台账供基线门禁
    }
  }
  return { compared, mismatches, skipped };
}

// ---- skip 基线门禁 ----------------------------------------------------
// skip-baseline.json：
// - skips：key = `<batch>.<section>` → 该节当前合法 skip 的语料体
//   （concrete() 盲区快照）。新增 skip（不在基线内）= unknown 回归 = 门禁失败；
//   基线收缩（引擎变精确）只 console.warn，不失败。
// - knownFalseThrows：引擎假抛（FALSE-THROW）金丝雀体——引擎缺陷未修期间
//   豁免于门禁（DEC-006 同款：响亮告警，绝不静默吞掉），修复后收紧。

interface SkipBaseline {
  skips: Record<string, string[]>;
  knownFalseThrows: string[];
}

const SKIP_BASELINE_URL = new URL("./skip-baseline.json", import.meta.url);
let skipBaselineCache: SkipBaseline | undefined;

function loadSkipBaseline(): SkipBaseline {
  if (skipBaselineCache) return skipBaselineCache;
  try {
    const parsed = JSON.parse(readFileSync(SKIP_BASELINE_URL, "utf8")) as Partial<SkipBaseline>;
    skipBaselineCache = { skips: parsed.skips ?? {}, knownFalseThrows: parsed.knownFalseThrows ?? [] };
  } catch {
    skipBaselineCache = { skips: {}, knownFalseThrows: [] }; // 基线缺失 → fail-closed：任何 skip 都是新增
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
 * 门禁用 mismatch 过滤：剔除 knownFalseThrows 金丝雀体（引擎假抛缺陷未修，
 * DEC-006 同款记录并放行）。金丝雀仍在复现 → console.warn；不再复现 → 提示
 * 收紧基线。返回应让门禁失败的 mismatch。
 */
export function unexpectedMismatches(mismatches: string[]): string[] {
  const pins = new Set(loadSkipBaseline().knownFalseThrows.map(labelOf));
  const stillPinned: string[] = [];
  const out: string[] = [];
  for (const m of mismatches) {
    const at = m.lastIndexOf("  [");
    const label = at >= 0 ? m.slice(at + 2) : "";
    if (pins.has(label)) stillPinned.push(m);
    else out.push(m);
  }
  if (stillPinned.length > 0) {
    console.warn(
      `[known-false-throw canary] ${stillPinned.length} pinned FALSE-THROW(s) still reproducing (engine bug tracked in bug-report):\n${stillPinned.join("\n")}`,
    );
  }
  for (const p of loadSkipBaseline().knownFalseThrows) {
    if (!mismatches.some((m) => m.endsWith(labelOf(p)))) {
      console.warn(`[known-false-throw canary] no longer reproduces — tighten skip-baseline.json: [${p}]`);
    }
  }
  return out;
}

/** 语料模块的命名导出数组 → [label, corpus] 对 */
export function sectionsOf(mod: Record<string, unknown>): Array<[string, string[]]> {
  return Object.entries(mod)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => [k, v as string[]]);
}
