/**
 * 差分 harness：B-path（transpile + exec）vs vm.runInNewContext strict native 对照。
 * 每条语料是「隐式 return」的语句体，由 __run 包装执行。
 *
 * 比较规则（diff3 同源）：
 * - bpath 产非具体 Abs（concrete() 返回 undefined）→ 无法比较，跳过；
 * - native 抛错而 bpath 折具体值 → 假精确 MISMATCH；
 * - bpath 抛错而 native 不抛 → FALSE-THROW；
 * - 两侧具体值不等 → MISMATCH。
 *
 * concrete() 盲区（open obj / undefined 元素 / 非具体值被跳过）由
 * corpus/batch18-readprobes.ts 的读层折叠探针与各 bpath-*.test.ts 的
 * parity describe 互补覆盖——门禁统计 total compared 下限防语料整体退化。
 */
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";
import { getPropFlags } from "../../builtins.ts";
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
  const lv = litValue(a);
  if (lv !== undefined) return lv;
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
    return ser(vm.runInNewContext(`(()=>{'use strict';${body}})()`, {}));
  } catch (e: unknown) {
    return "THROW:" + ((e as Error)?.message ?? String(e));
  }
}

function bpath(body: string): { res: string | undefined; throws: boolean } {
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

export function diffBody(body: string): string | null {
  const n = native(body);
  const b = bpath(body);
  if (b.throws && !n.startsWith("THROW:")) {
    return `FALSE-THROW native=${n}  [${body.replace(/\n/g, " ").slice(0, 100)}]`;
  }
  if (b.res === undefined) return null; // 非具体 Abs，无法比较
  if (n.startsWith("THROW:")) {
    return `MISMATCH native=${n} bpath=${b.res}  [${body.replace(/\n/g, " ").slice(0, 100)}]`;
  }
  if (n !== b.res) {
    return `MISMATCH native=${n} bpath=${b.res}  [${body.replace(/\n/g, " ").slice(0, 100)}]`;
  }
  return null;
}

export function runCorpus(corpus: string[]): { compared: number; mismatches: string[] } {
  let compared = 0;
  const mismatches: string[] = [];
  for (const body of corpus) {
    const b = bpath(body);
    if (b.res === undefined) continue;
    compared++;
    const m = diffBody(body); // 内含 native 对照
    if (m) mismatches.push(m);
  }
  return { compared, mismatches };
}

/** 语料模块的命名导出数组 → [label, corpus] 对 */
export function sectionsOf(mod: Record<string, unknown>): Array<[string, string[]]> {
  return Object.entries(mod)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => [k, v as string[]]);
}
