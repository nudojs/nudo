/**
 * @nudo:env 全局/模块表 + 手写 env 与 harvest/graph 模块的合并（eval-run 拆叶，
 * ServiceReviewer S2）。
 *
 * 职责：collectEnvGlobals / collectEnvModules（env 模块 Abs 原生）→
 * mergeHarvestUnderEnv（手写 env wins，B8）及其冲突 collector。
 * 运行时叶子：只依赖 core 与 evaluator-api（loadEnvs），不环入 eval-run /
 * analyzer——eval-run 转出以保持既有导入面（`eval-run.ts` 是公开入口）。
 */
import { createEnvironment, noteEvalFallback, namespaceAbsOf, type Abs, type AbsModuleExports } from "@nudojs/core";
import { createScopedSlot, registerCollectorScopeParticipant } from "@nudojs/core/internal";
import { loadEnvs } from "./evaluator/evaluator-api.ts";

/** @nudo:env → Abs 全局表（env 模块 Abs 原生） */
export function collectEnvGlobals(envNames: string[]): Record<string, Abs> {
  if (envNames.length === 0) return {};
  const env = createEnvironment();
  try {
    return { ...loadEnvs(envNames, env).globals };
  } catch (e) {
    noteEvalFallback(e);
    return {};
  }
}

/**
 * @nudo:env modules（path / node:path / fs…）→ AbsModuleExports
 *
 * Bug 282：env 模块是 **CJS 互操作**模块——Node 的 `node:fs` 的默认导出就是
 * 模块对象本身（具名导出挂在它上面）⇒ ESM **默认导入**
 * （`import fs from "node:fs"`）必须绑到**命名空间**。
 *
 * 此前 env 表**只有 named、没有 default 槽** ⇒ core 的 `bindImport` 在
 * `name === "default"` 分支取不到值 ⇒ 折 `unknown` ⇒ 该文件的导出函数
 * 全量降级 `unknown` + 追加一条**误导性**的 `nudo:unknown-inference`
 * （真实原因是绑定没接上，不是推断失败）+ 门禁**假绿**（exit 0）；
 * 而**同一模块**的命名空间导入（`import * as fs`）却正常执法
 * （`nudo:entry-may-throw` 判红）⇒ 同一种导入语义两种门禁结论。
 *
 * 口径：default 槽 = 该模块的**命名空间 Abs**（全部具名导出），
 * 与 `mock-module.ts` 的「仅有 named 时合成 default 命名空间」同惯例；
 * 同时打 `interopDefault` 标记（CJS 互操作模块 ⇒ default = 模块对象本身）
 * ——core 的默认导入绑定（`defaultImportBindingOf`）据此回退，两条口径同源。
 * 只装在 **env 表**上——用户模块表不动 ⇒ 用户模块缺 default 仍是
 * `unknown`（Bug 990 口径：模块表有该 mod 但没有 default ⇒ 就是没有
 * default，不得回退到命名空间）。
 */
export function collectEnvModules(envNames: string[]): Record<string, AbsModuleExports> {
  if (envNames.length === 0) return {};
  const env = createEnvironment();
  let mods: Record<string, Record<string, Abs>> = {};
  try {
    mods = loadEnvs(envNames, env).modules;
  } catch (e) {
    noteEvalFallback(e);
    return {};
  }
  const out: Record<string, AbsModuleExports> = {};
  for (const [spec, named] of Object.entries(mods)) {
    const namedTable = { ...named };
    out[spec] = {
      named: namedTable,
      // CJS 互操作：default = 模块对象本身（= 命名空间）
      default: namespaceAbsOf({ named: namedTable }),
      interopDefault: true,
    };
  }
  return out;
}

/** Conflict when handwritten env overwrote a harvest module/export (B8). */
export type EnvHarvestConflict = {
  module: string;
  /** export names where env replaced a harvest binding (empty + defaulted = default only) */
  exports: string[];
  defaultOverwritten: boolean;
};

/** 冲突 collector（作用域化：runWithCollectorScope 内各分析互不串台；
 *  无作用域 = fallback 模块级单变量，行为同今日） */
const envHarvestConflictCollectorSlot = createScopedSlot<
  ((c: EnvHarvestConflict) => void) | null
>(() => null);
registerCollectorScopeParticipant((body) => envHarvestConflictCollectorSlot.runScoped(body));

/**
 * Install conflict collector; returns the previous one so nested/concurrent
 * analyzeFile callers can save/restore (scoped fallback: inside
 * runWithCollectorScope each analysis gets its own slot, no cross-talk).
 */
export function setEnvHarvestConflictCollector(
  collector: ((c: EnvHarvestConflict) => void) | null,
): ((c: EnvHarvestConflict) => void) | null {
  const prev = envHarvestConflictCollectorSlot.get();
  envHarvestConflictCollectorSlot.set(collector);
  return prev;
}

/** Read-only peek for tests / nested restore. */
export function getEnvHarvestConflictCollector():
  | ((c: EnvHarvestConflict) => void)
  | null {
  return envHarvestConflictCollectorSlot.get();
}

export type MergeHarvestOptions = {
  /**
   * Per-call conflict sink. Takes precedence over the module-global collector
   * installed via `setEnvHarvestConflictCollector`.
   */
  onConflict?: (c: EnvHarvestConflict) => void;
};

/**
 * 保活导出表合并（Bug 476）：ESM 的 import 绑定是指向依赖模块作用域的
 * **间接引用**——依赖模块的内部变异必须对导入方可见。
 * 旧口径用对象展开搬运导出表（`{ ...exports.named }`）→ **求值**活 getter
 * → 冻结成快照 ⇒ 依赖内部变异对导入方不可见（原生 "hello"，引擎 0）。
 * 这里改为 defineProperty 委派：named 槽与 default 槽都保持 getter。
 *
 * 优先级：靠前的表先占位（同名槽取先到者）。
 */
function liveNamedTable(tables: Array<Record<string, Abs>>): Record<string, Abs> {
  const out: Record<string, Abs> = {};
  for (const table of tables) {
    for (const k of Object.keys(table)) {
      // 自有属性判定：`in` 走原型链（toString/constructor 等继承名会被当导出）
      if (Object.hasOwn(out, k)) continue;
      const d = Object.getOwnPropertyDescriptor(table, k);
      if (d?.get) {
        Object.defineProperty(out, k, {
          enumerable: true,
          configurable: true,
          get: () => (table as Record<string, Abs>)[k],
        });
      } else {
        out[k] = table[k];
      }
    }
  }
  return out;
}

/**
 * 复制模块导出表（保活 default 槽）。
 * `named` 由调用方给定；`defaultSrc` 决定 default 槽取自谁（env 优先）。
 * `keepFlags` = 是否保留 evaluated / cjsMain 等标记位（合并覆盖场景与
 * 旧口径一致：env 覆盖后只留 named + default）。
 */
function copyModuleExports(
  src: AbsModuleExports,
  named: Record<string, Abs>,
  defaultSrc: AbsModuleExports = src,
  keepFlags = true,
): AbsModuleExports {
  const out = { named } as AbsModuleExports;
  if (keepFlags) {
    for (const k of Object.keys(src)) {
      if (k === "named" || k === "default") continue;
      const d = Object.getOwnPropertyDescriptor(src, k);
      if (!d) continue;
      if (d.get) {
        Object.defineProperty(out, k, {
          enumerable: true,
          configurable: true,
          get: () => (src as unknown as Record<string, unknown>)[k],
        });
      } else {
        (out as unknown as Record<string, unknown>)[k] = d.value;
      }
    }
  }
  const dd = Object.getOwnPropertyDescriptor(defaultSrc, "default");
  if (dd?.get) {
    Object.defineProperty(out, "default", {
      enumerable: true,
      configurable: true,
      get: () => defaultSrc.default,
    });
  } else if (dd) {
    out.default = dd.value as Abs;
  }
  return out;
}

/**
 * Handwritten `@nudojs/env` wins over harvest / graph modules on overlapping
 * module keys and overlapping export names (docs/versioning.md B8 + website
 * harvester API). Harvest-only modules/exports are kept as fill-in.
 * Overwrites notify `opts.onConflict` or the global collector.
 *
 * **导出表保活**（Bug 476）：named / default 槽都是活绑定（getter 委派），
 * 合并不得按值快照——否则依赖模块的内部变异对导入方不可见。
 */
export function mergeHarvestUnderEnv(
  harvestModules: Record<string, AbsModuleExports>,
  envModules: Record<string, AbsModuleExports>,
  opts?: MergeHarvestOptions,
): Record<string, AbsModuleExports> {
  const out: Record<string, AbsModuleExports> = {};
  for (const [mod, exports] of Object.entries(harvestModules)) {
    // 保留 cjsMain / evaluated 等标记位（Bug 10 回归：require 对 CJS 单函数
    // 导出需返回 default 本身，丢标记会回落 namespace obj → obj-callee 定抛）
    out[mod] = copyModuleExports(exports, liveNamedTable([exports.named]));
  }
  const notify = opts?.onConflict ?? envHarvestConflictCollectorSlot.get();
  for (const [mod, envExports] of Object.entries(envModules)) {
    const existing = out[mod];
    if (!existing) {
      out[mod] = copyModuleExports(envExports, liveNamedTable([envExports.named]));
      continue;
    }
    const overwritten: string[] = [];
    for (const key of Object.keys(envExports.named)) {
      if (existing.named[key] !== undefined) overwritten.push(key);
    }
    const defaultOverwritten =
      envExports.default !== undefined && existing.default !== undefined;
    if (notify && (overwritten.length > 0 || defaultOverwritten)) {
      try {
        notify({
          module: mod,
          exports: overwritten,
          defaultOverwritten,
        });
      } catch {
        /* collector must not break analysis */
      }
    }
    // env wins：同名槽取 env（保活），其余填 harvest
    const named = liveNamedTable([envExports.named, existing.named]);
    const defaultSrc = envExports.default !== undefined ? envExports : existing;
    out[mod] = copyModuleExports(existing, named, defaultSrc, false);
    // Bug 282：互操作标记随 env 侧走（keepFlags=false 会丢标记位 ⇒ env 模块的
    // 「default = 模块对象本身」语义在合并后丢失）。default 槽本身已由
    // defaultSrc 带上（env 侧 default 优先），此处只补标记。
    if (envExports.interopDefault) out[mod].interopDefault = true;
  }
  return out;
}
