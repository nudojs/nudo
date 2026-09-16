/**
 * `nudo interface` 的打印数据源（design-refine-derivation §11 第 0 步）：
 * 逐顶层函数展示有效契约分层——effectiveInterface 命中（手写契约 / 侧车
 * 生成段）时 params/returns 用 formatConstraint 组合式显示；未命中走
 * implicit：直接展示 analyzer 的现成推断结果（case 实参与 Combined 的
 * TypeValue 串，不强求约束式）。
 *
 * autoBind 沿 package.json#nudo.interface（findProjectConfig → interfaceConfig）
 * 下传，可用 opts 覆盖（测试 / CLI 显式开关）；读盘用 defaultLoadModule
 * （与 check 的 refine 解析同一扩展名表）。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  effectiveInterface,
  formatConstraint,
  interfaceDiagCount,
  localNamedExports,
  refineDiagCount,
  takeInterfaceDiagsSince,
  takeRefineDiagsSince,
  typeValueToString,
} from "@nudojs/core";
import { analyzeFileAsync } from "./analyzer.ts";
import type { CallRecord } from "./evaluator/evaluator.ts";
import { defaultLoadModule, type LoadModule } from "./load-module.ts";
import { findProjectConfig, interfaceConfig } from "./evaluator/config.ts";

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
  /** 跨文件调用记录（--callsites 采集）：implicit 展示的实参域原料 */
  records?: CallRecord[];
};

/** 单条 interface 打印行（CLI runInterface 与 LSP agent 面共用） */
export function formatInterfaceSurfaceLine(e: InterfaceSurfaceEntry): string {
  const params = `(${e.params.map((p) => `${p.name}: ${p.display}`).join(", ")})`;
  let line = `  ${e.fn}  [${e.source}]  ${params}`;
  if (e.returns !== undefined) line += ` → ${e.returns}`;
  if (e.kind === "local") line += "  (local)";
  return line;
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
  const source = readFileSync(abs, "utf-8");
  // since 锚：收尾只排干本次打印自身产生的诊断——全量 take 会在 LSP 长驻
  // 进程的 await 窗口窃取在途 validateText 待消费诊断（接口/精化两通道同防）
  const ifaceSince = interfaceDiagCount();
  const refineSince = refineDiagCount();
  const autoBind =
    opts.autoBind ?? interfaceConfig(findProjectConfig(dirname(abs))?.config).autoBind;
  const loadModule = opts.loadModule ?? defaultLoadModule;
  const exported = localNamedExports(source);
  const kindOf = (fnName: string): "export" | "local" => (exported.has(fnName) ? "export" : "local");

  const analysis = await analyzeFileAsync(abs, source, undefined, opts.records);
  const entries: InterfaceSurfaceEntry[] = [];

  for (const fn of analysis.functions) {
    const eff = effectiveInterface(source, fn.name, { loadModule, fromFile: abs, autoBind });
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
    // implicit：analyzer 现成推断结果直接展示——参数位取各 case 实参类型的
    // 去重并（保留首次出现序），返回位优先 Combined（跨 case join）
    const params = fn.paramNames.map((name, i) => {
      const seen: string[] = [];
      for (const c of fn.cases) {
        const arg = c.args[i];
        if (!arg) continue;
        const s = typeValueToString(arg);
        if (!seen.includes(s)) seen.push(s);
      }
      return { name, display: seen.length > 0 ? seen.join(" | ") : "unknown" };
    });
    const ret =
      fn.combined !== undefined
        ? typeValueToString(fn.combined)
        : fn.cases.length > 0
          ? typeValueToString(fn.cases[fn.cases.length - 1]!.result)
          : undefined;
    entries.push({ fn: fn.name, kind: kindOf(fn.name), source: "implicit", params, returns: ret });
  }

  takeInterfaceDiagsSince(ifaceSince); // 清空本次增量，防跨命令/在途验证互窃
  takeRefineDiagsSince(refineSince);
  return entries;
}
