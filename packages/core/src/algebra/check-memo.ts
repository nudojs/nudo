/**
 * 整文件 CheckReport memo（LSP/CI 重复 check → O(1)）。
 *
 * 从 check.ts 拆出的缓存基建：键指纹 / 依赖索引 / 定向逐出 / LRU。
 * check.ts 通过 re-export 保持 resetCheckSourceMemo /
 * evictCheckSourceMemoForPaths 对外形状不变。
 */

import type { CheckReport } from "./check-report.ts";
import type { Abs } from "./abs.ts";
import { formatAbs } from "./format.ts";
import { hashSource, resetHashSourceCache } from "./hash-source.ts";
import {
  loadModuleDepsFingerprint,
  normPath,
  type LoadDepsFingerprint,
} from "./load-deps-fp.ts";
import { runTranspiledOptionsMemoKey } from "./exec/run.ts";
import type { CheckOptions } from "./check.ts";

const checkReportMemo = new Map<string, CheckReport>();
const checkKeyDeps = new Map<string, string[]>();
const checkDepIndex = new Map<string, Set<string>>();
const loadModuleIds = new WeakMap<object, number>();
let nextLoadModuleId = 1;
export const MAX_CHECK_MEMO = 256;

export function resetCheckSourceMemo(): void {
  checkReportMemo.clear();
  checkKeyDeps.clear();
  checkDepIndex.clear();
  resetHashSourceCache();
}

function loadModuleId(fn?: (spec: string, fromFile: string) => string | undefined): number {
  if (!fn) return 0;
  let id = loadModuleIds.get(fn);
  if (id === undefined) {
    id = nextLoadModuleId++;
    loadModuleIds.set(fn, id);
  }
  return id;
}

export function checkDepsFingerprint(
  source: string,
  opts: CheckOptions,
): LoadDepsFingerprint {
  if (!opts.loadModule || !opts.fromFile) {
    return { fp: "-", paths: [], contents: [], truncated: false };
  }
  return loadModuleDepsFingerprint(source, opts.loadModule, opts.fromFile);
}

function unindexCheckKey(key: string): void {
  const deps = checkKeyDeps.get(key);
  if (!deps) return;
  for (const p of deps) {
    const set = checkDepIndex.get(p);
    if (!set) continue;
    set.delete(key);
    if (set.size === 0) checkDepIndex.delete(p);
  }
  checkKeyDeps.delete(key);
}

/** `*.nudo.js` 变更后定向逐出依赖它的整文件 check 缓存 */
export function evictCheckSourceMemoForPaths(paths: string[]): number {
  let n = 0;
  for (const raw of paths) {
    const p = normPath(raw);
    const keys = checkDepIndex.get(p);
    if (!keys) continue;
    for (const key of [...keys]) {
      checkReportMemo.delete(key);
      unindexCheckKey(key);
      n++;
    }
  }
  return n;
}

export function cloneCheckReport(r: CheckReport): CheckReport {
  return {
    file: r.file,
    issues: r.issues.map((i) => ({ ...i })),
    ok: r.ok,
    signatures: r.signatures.map((s) => ({
      ...s,
      params: [...s.params],
      ...(s.paramTypes ? { paramTypes: [...s.paramTypes] } : {}),
    })),
    summary: { ...r.summary },
    ...(r.budget ? { budget: { ...r.budget } } : {}),
  };
}

/** 模块表身份（与 loadModuleId 同信任模型） */
const moduleMapIds = new WeakMap<object, number>();
let moduleMapIdSeq = 0;
function moduleMapId(m: object | undefined): string {
  if (!m) return "-";
  let id = moduleMapIds.get(m);
  if (id === undefined) {
    id = ++moduleMapIdSeq;
    moduleMapIds.set(m, id);
  }
  return `m${id}`;
}

export function checkMemoKey(
  filePath: string,
  source: string,
  identityOpts: CheckOptions,
  deps: LoadDepsFingerprint,
  sidecarFp?: string,
): string {
  // identity must stay the caller's raw loadModule or every checkSource
  // allocates a new loadModuleId and memo never hits.
  // autoBind 必须进键：执法档翻转后不得回放另一档报告（disk 键已含）。
  return [
    hashSource(source),
    filePath,
    `${loadModuleId(identityOpts.loadModule)}:${identityOpts.fromFile ?? ""}`,
    deps.fp,
    sidecarFp ?? "-",
    identityOpts.autoBind === false ? "ab0" : "ab1",
    identityOpts.projectDir ?? "-",
    identityOpts.entryThrows ?? "error",
    (identityOpts.ignoreThrows ?? []).join(",") || "-",
    moduleMapId(identityOpts.modules),
    // inject 用内容指纹（CLI 每次新建同内容对象时身份键会 miss）
    runTranspiledOptionsMemoKey(identityOpts.inject),
    // skips 必须进键：同 source 不同 skip 表（host 解析差异 / 测试注入）
    // 不得回放另一档报告。
    skipsKey(identityOpts.skips),
  ].join("|");
}

/** skip 表稳定键：名字 + 声明返回（null = 未声明）；排序保证与插入序无关 */
function skipsKey(skips: ReadonlyMap<string, Abs | null> | undefined): string {
  if (!skips || skips.size === 0) return "-";
  return [...skips.entries()]
    .map(([name, abs]) => `${name}:${abs ? formatAbs(abs) : "-"}`)
    .sort()
    .join(",");
}

export function checkMemoGet(key: string): CheckReport | null {
  if (!checkReportMemo.has(key)) return null;
  const v = checkReportMemo.get(key)!;
  checkReportMemo.delete(key);
  checkReportMemo.set(key, v);
  return v;
}

export function checkMemoSet(key: string, value: CheckReport, depPaths: string[]): void {
  if (checkReportMemo.size >= MAX_CHECK_MEMO) {
    const oldest = checkReportMemo.keys().next().value;
    if (oldest !== undefined) {
      checkReportMemo.delete(oldest);
      unindexCheckKey(oldest);
    }
  }
  checkReportMemo.set(key, value);
  if (depPaths.length > 0) {
    checkKeyDeps.set(key, depPaths);
    for (const p of depPaths) {
      let set = checkDepIndex.get(p);
      if (!set) {
        set = new Set();
        checkDepIndex.set(p, set);
      }
      set.add(key);
    }
  }
}
