/**
 * `nudo contract` 的打印数据源（design-refine-derivation §11 第 0 步）：
 * 逐顶层函数展示有效契约分层——effectiveInterface 命中（手写契约 / 侧车
 * 生成段）时 params/returns 用 formatConstraint 组合式显示；未命中走
 * implicit：优先 CaseResult.argAbs / FunctionAnalysis.combinedAbs（无损
 * Abs 源），展示用 formatShape（外延口径，不强求约束式、不带 conf）。
 *
 * autoBind 沿 package.json#nudo.contract（findProjectConfig → interfaceConfig）
 * 下传，可用 opts 覆盖（测试 / CLI 显式开关）；读盘用 defaultLoadModule
 * （与 check 的 refine 解析同一扩展名表）。
 *
 * B3 Phase B：`nudo.cache` / NUDO_CACHE_DIR 打开时，整文件 effectiveInterface
 * 表（含 implicit 负缓存 null）落盘；二次冷启动跳过侧车 exec / 契约合并。
 * 缓存只服务打印/表面，不加速 B-path 分析（design-persistent-cache §0）。
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  effectiveInterface,
  formatConstraint,
  formatShape,
  interfaceDiagCount,
  localNamedExports,
  refineDiagCount,
  sidecarPathOf,
  takeInterfaceDiagsSince,
  takeRefineDiagsSince,
  type Abs,
  type EffectiveInterface,
  type NudoConstraint,
} from "@nudojs/core";
import { analyzeFileAsync } from "../analyzer.ts";
import { type CallRecord } from "../evaluator/call-record.ts";
import { defaultLoadModule, type LoadModule } from "../load-module.ts";
import { findProjectConfig, interfaceConfig, diskCacheRoot } from "../evaluator/config.ts";
import { DiskCache, ifaceCacheKey } from "../disk-cache.ts";
import { collectLoadDepContents } from "../dep-contents.ts";

/** loadModule 闭包依赖内容：iface 缓存键维度（含 ambient 侧车 / ESM import）。
 *  truncated → 禁用磁盘复用（未入键 dep 变更不会 miss）。 */
function collectDepContents(
  filePath: string,
  source: string,
  loadModule?: LoadModule,
): { depContents: Array<{ path: string; content: string | null }>; truncated: boolean } {
  return collectLoadDepContents(filePath, source, loadModule ?? defaultLoadModule);
}

export type InterfaceSurfaceEntry = {
  fn: string;
  /** 本文件 named export（自动绑定边界口径：localNamedExports） */
  kind: "export" | "local";
  source: "handwritten" | "generated" | "implicit";
  params: Array<{ name: string; display: string }>;
  returns?: string;
};

export type InterfaceSurfaceOpts = {
  /** 覆盖项目配置的 autoBind（默认 findProjectConfig → interfaceConfig） */
  autoBind?: boolean;
  /** 模块源码装载器（测试注入）；默认 defaultLoadModule 真实读盘 */
  loadModule?: LoadModule;
  /** 跨文件调用记录（--from 采集）：implicit 展示的实参域原料 */
  records?: CallRecord[];
  /** 打开 buffer 覆盖磁盘源码（E5：agent/LSP 与 hover 同口径） */
  source?: string;
};

/** 单条 interface 打印行（CLI runInterface 与 LSP agent 面共用） */
export function formatInterfaceSurfaceLine(e: InterfaceSurfaceEntry): string {
  const params = `(${e.params.map((p) => `${p.name}: ${p.display}`).join(", ")})`;
  let line = `  ${e.fn}  [${e.source}]  ${params}`;
  if (e.returns !== undefined) line += ` → ${e.returns}`;
  if (e.kind === "local") line += "  (local)";
  return line;
}

/** Abs → implicit 展示串（外延口径，不带 conf） */
function absToImplicitDisplay(a: Abs): string {
  try {
    return formatShape(a);
  } catch {
    return "unknown";
  }
}

/** 磁盘投影：约束剥 builder 方法后 JSON 化（只存可再执行纯数据） */
type CachedConstraintJson = {
  __nudoConstraint: true;
  prim?: string;
  preds: unknown[];
  fields?: Record<string, unknown>;
  element?: unknown;
  int?: boolean;
  isOptional?: boolean;
  members?: unknown[];
  fn?: unknown;
};

type CachedEffectiveInterface = {
  fnName: string;
  params: Array<{ param: string; constraint: CachedConstraintJson }>;
  returns?: { constraint: CachedConstraintJson };
  source: "handwritten" | "generated" | "implicit";
  conflict?: { params: string[]; returns?: boolean };
};

/** null = implicit 负缓存 */
type IfaceTableJson = {
  fns: Record<string, CachedEffectiveInterface | null>;
};

function constraintToJson(c: NudoConstraint): CachedConstraintJson {
  return JSON.parse(JSON.stringify(c)) as CachedConstraintJson;
}

function cachedToEffective(e: CachedEffectiveInterface): EffectiveInterface {
  return {
    fnName: e.fnName,
    params: e.params.map((p) => ({
      param: p.param,
      constraint: p.constraint as unknown as NudoConstraint,
    })),
    ...(e.returns
      ? { returns: { constraint: e.returns.constraint as unknown as NudoConstraint } }
      : {}),
    source: e.source,
    ...(e.conflict ? { conflict: e.conflict } : {}),
  };
}

/**
 * 单文件 interface 表面：analyzer 推断结果给出函数清单与 implicit 展示，
 * effectiveInterface 给出契约命中（手写 > 生成段）。诊断 side-channel
 * 在收尾时取走丢弃——打印命令不执法，interface-load 等错误留给 check 路径。
 */
export async function interfaceSurface(
  filePath: string,
  opts: InterfaceSurfaceOpts = {},
): Promise<InterfaceSurfaceEntry[]> {
  const abs = resolve(filePath);
  const source = opts.source ?? readFileSync(abs, "utf-8");
  const fromBuffer = opts.source !== undefined;
  // since 锚：收尾只排干本次打印自身产生的诊断——全量 take 会在 LSP 长驻
  // 进程的 await 窗口窃取在途 validateText 待消费诊断（接口/精化两通道同防）
  const ifaceSince = interfaceDiagCount();
  const refineSince = refineDiagCount();
  const proj = findProjectConfig(dirname(abs));
  const autoBind = opts.autoBind ?? interfaceConfig(proj?.config).autoBind;
  const loadModule = opts.loadModule ?? defaultLoadModule;
  const exported = localNamedExports(source);
  const kindOf = (fnName: string): "export" | "local" => (exported.has(fnName) ? "export" : "local");

  const analysis = await analyzeFileAsync(abs, source, undefined, opts.records, loadModule);

  // B3：整文件 effectiveInterface 表磁盘缓存（打印路径；不加速 analyze）
  // buffer 源 / 注入 loadModule / callsites 时禁用磁盘缓存（键不含 buffer）
  let disk: DiskCache | undefined;
  let ifaceKey: string | undefined;
  let cachedTable: IfaceTableJson | undefined;
  if (!opts.loadModule && !opts.records && !fromBuffer) {
    const cacheRoot = diskCacheRoot(proj?.config, proj?.projectDir);
    disk = new DiskCache({ root: cacheRoot, namespace: "iface" });
    if (disk.enabled) {
      let sidecarSource: string | undefined;
      try {
        const sc = sidecarPathOf(abs);
        if (autoBind !== false) {
          // buffer-aware 侧车优先
          const openSc = loadModule(`./${sc.slice(sc.lastIndexOf("/") + 1)}`, abs);
          if (openSc !== undefined) sidecarSource = openSc;
          else if (existsSync(sc)) sidecarSource = readFileSync(sc, "utf-8");
        }
      } catch {
        sidecarSource = undefined;
      }
      const dep = collectDepContents(abs, source, loadModule);
      // 闭包截断 / bare-spec miss → 键不全，禁用磁盘复用
      const hasBareMiss = (dep.depContents ?? []).some((d) => d.content == null);
      if (dep.truncated || hasBareMiss) {
        ifaceKey = undefined;
        cachedTable = undefined;
      } else {
        ifaceKey = ifaceCacheKey(abs, source, {
          autoBind: autoBind !== false,
          projectDir: proj?.projectDir,
          sidecarSource,
          depContents: dep.depContents,
          projectEnvNames: proj?.config.env ?? [],
        });
        cachedTable = disk.get<IfaceTableJson>(ifaceKey);
      }
    }
  }

  const entries: InterfaceSurfaceEntry[] = [];
  const freshTable: IfaceTableJson = { fns: {} };
  const useCache = cachedTable !== undefined;

  for (const fn of analysis.functions) {
    let eff: EffectiveInterface | undefined;
    if (useCache) {
      const hit = cachedTable!.fns[fn.name];
      eff = hit === null ? undefined : hit ? cachedToEffective(hit) : undefined;
    } else {
      eff = effectiveInterface(source, fn.name, {
        loadModule,
        fromFile: abs,
        autoBind,
        ...(proj?.projectDir ? { projectDir: proj.projectDir } : {}),
      });
      if (freshTable) {
        freshTable.fns[fn.name] = eff
          ? {
              fnName: eff.fnName,
              params: eff.params.map((p) => ({
                param: p.param,
                constraint: constraintToJson(p.constraint),
              })),
              ...(eff.returns
                ? { returns: { constraint: constraintToJson(eff.returns.constraint) } }
                : {}),
              // 磁盘表保留真实分档；implicit 也可序列化（展示层用）
              source: eff.source,
              ...(eff.conflict ? { conflict: eff.conflict } : {}),
            }
          : null;
      }
    }
    if (eff) {
      entries.push({
        fn: fn.name,
        kind: kindOf(fn.name),
        source: eff.source,
        params: eff.params.map((p) => ({ name: p.param, display: formatConstraint(p.constraint) })),
        returns: eff.returns ? formatConstraint(eff.returns.constraint) : undefined,
      });
      continue;
    }
    // implicit：argAbs / combinedAbs（无损 Abs 源）；展示仍外延串。
    const params = fn.paramNames.map((name, i) => {
      const seen: string[] = [];
      for (const c of fn.cases) {
        const absArg = c.argAbs[i];
        if (absArg) {
          const s = absToImplicitDisplay(absArg);
          if (!seen.includes(s)) seen.push(s);
        }
      }
      return { name, display: seen.length > 0 ? seen.join(" | ") : "unknown" };
    });
    let ret: string | undefined;
    if (fn.combinedAbs) {
      ret = absToImplicitDisplay(fn.combinedAbs);
    } else if (fn.cases.length > 0) {
      const last = fn.cases[fn.cases.length - 1]!;
      ret = absToImplicitDisplay(last.abs);
    }
    entries.push({ fn: fn.name, kind: kindOf(fn.name), source: "implicit", params, returns: ret });
  }

  if (disk?.enabled && ifaceKey && !useCache && analysis.functions.length > 0) {
    try {
      disk.set(ifaceKey, freshTable);
    } catch {
      /* fail-open */
    }
  }

  takeInterfaceDiagsSince(ifaceSince); // 清空本次增量，防跨命令/在途验证互窃
  takeRefineDiagsSince(refineSince);
  return entries;
}
