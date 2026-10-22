/**
 * export — 入口选择面：哪些函数参与导出、契约/观测两条证据路径的选择口径。
 *
 * 两条证据路径（choice 面）：
 * - 契约面（contract）：手写契约（sidecar `*.nudo.js` ∪ inline `@nudo:contract`）——
 *   参数位与返回位由契约声明，权威。
 * - 观测面（observation）：case 见证（call@/entry@）—— 无契约时的兜底。
 *
 * 本模块只做**选择**（纯口径，不产出产物面）；产物面由 zod / standard / guard / dts
 * 各面模块承担。
 */
import { dirname } from "node:path";
import {
  defaultLoadModule,
  findProjectConfig,
  interfaceConfig,
  mockDirectivesToAbsSeeds,
  mockSeedsToAbsMocks,
  type AnalysisResult,
  type FunctionAnalysis,
} from "@nudojs/service";
import { extractDirectives, parse } from "@nudojs/parser";
import type { Abs, EffectiveInterfaceOpts } from "@nudojs/core";

/** 证据路径：契约面（手写契约）或观测面（case 见证 / 调用点证据）。 */
export type EvidencePath = "contract" | "observation";

/** 路径判定：命中契约位 ⇒ contract；否则 observation。 */
export function evidencePathOf(hasContract: boolean): EvidencePath {
  return hasContract ? "contract" : "observation";
}

/**
 * 入口 filter：导出**分析面**的函数。
 *
 * - 有 case 见证（call@ / entry@ 合成 + `@nudo:case`）⇒ 有观测面；
 * - `@nudo:skip` 函数按设计**不合成** entry@ 见证（零 case）⇒ 必须**显式**
 *   放行：否则这条 filter 把它静默丢掉 ⇒ 导出面少一块，且 dts 生成器专为 skip
 *   建的 `contractOnlySignature` 路径**永不可达**（Bug 600）。
 *
 * case 档 "all"：@nudo:case 见证参与投影面（无指令文件不受影响——call@/entry@
 * 合成与档位无关）。
 */
export function selectExportFunctions(result: AnalysisResult): FunctionAnalysis[] {
  return result.functions.filter((f) => f.cases.length > 0 || f.skipped === true);
}

/**
 * 导出面裁剪（模块**公开面**）：四个产物面**同一个**判据。
 *
 * dts 面按导出面裁剪（导出名 / `default` / `Class.member` 的 Class 前缀在导出
 * 面），而 zod / standard / guard 三面此前**不裁剪** ⇒ 同一次导出里「哪些函数
 * 算公开」有**四套口径**：源模块一个导出都没有时，三面照样产出内部实现的
 * 运行时校验器，`.d.ts` 却静默缺席（Bug 621）。
 *
 * 本函数是那道闸门的**唯一安装点**：四个面共用一份过滤结果（判据由调用方从
 * dts 面同源的 `localNamedExports` 口径给出）。
 */
export function selectPublicFunctions(
  functions: readonly FunctionAnalysis[],
  onExportFace: (name: string) => boolean,
): FunctionAnalysis[] {
  return functions.filter((f) => onExportFace(f.name));
}

/**
 * 契约面装载口径（与 check 签名面同数据源 effectiveInterface：sidecar ∪ inline
 * `@nudo:contract`）：autoBind / projectDir 与 check / iface 面同口径——项目关
 * autoBind 时侧车不做 ambient 加载。
 */
export function buildEffectiveInterfaceOptions(filePath: string): EffectiveInterfaceOpts {
  const proj = findProjectConfig(dirname(filePath));
  const autoBindCfg = interfaceConfig(proj?.config).autoBind;
  return {
    loadModule: defaultLoadModule,
    fromFile: filePath,
    ...(autoBindCfg !== undefined ? { autoBind: autoBindCfg } : {}),
    ...(proj?.projectDir ? { projectDir: proj.projectDir } : {}),
  };
}

/**
 * 契约种子求值用的 `@nudo:mock` 种子（与 analyzer 文件级种子同口径；env 面不在
 * 此装配——env 依赖体 fail-closed 落 unknown，不伪造精度）。
 *
 * 种子求值失败**不得静默降级**：导出面会无告警变 unknown ⇒ 返回 `warning` 交给
 * 调用方上屏（含原因），随后仍降级为无 mock（不炸导出）。
 */
export function resolveEvalMocks(
  source: string,
  filePath: string,
): { mocks?: Record<string, Abs>; warning?: string } {
  try {
    const seeds = mockDirectivesToAbsSeeds(extractDirectives(parse(source)), {
      fromFile: filePath,
      loadModule: defaultLoadModule,
    });
    const mocks = mockSeedsToAbsMocks(seeds);
    return Object.keys(mocks).length > 0 ? { mocks } : {};
  } catch (err) {
    return { warning: (err as Error).message };
  }
}
