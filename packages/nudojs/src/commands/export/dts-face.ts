/**
 * export — dts 产物面：导出面裁剪 + 逐函数投影 + 模块面合成。
 *
 * dts 只发射**导出面**（export / export default / CJS exports —— 与 check entry
 * 表同源 `localNamedExports`；导出 class 的实例方法按 Class 前缀放行）。
 */
import { abs as makeAbs, localNamedExports, type Abs, type EffectiveInterface } from "@nudojs/core";
import {
  dtsModuleSurface,
  projectFunctionDts,
  projectModuleDts,
  type DtsContractFace,
  type DtsFunctionProjection,
  type DtsModuleSurface,
} from "@nudojs/service/emit";
import { tryEvalCall, type FunctionAnalysis } from "@nudojs/service";
import { contractParamFace, contractReturnFace, type ParamFace } from "./contract-face.ts";

/** dts 面的逐函数条目（模块面合成用：类声明一次一类 + 再导出 + brand 类）。 */
export type DtsFaceEntry = {
  fn: FunctionAnalysis;
  projection: DtsFunctionProjection;
  contract?: DtsContractFace;
};

/**
 * 导出面裁剪谓词：名字在导出面（导出名 / `default` / `Class.member` 的 Class
 * 前缀在导出面）⇒ 进 .d.ts。
 */
export function exportFacePredicate(entryNames: ReadonlySet<string>): (name: string) => boolean {
  return (name: string): boolean => {
    if (entryNames.has(name) || name === "default") return true;
    const m = /^([A-Za-z_$][\w$]*)\.[A-Za-z_$][\w$]*$/.exec(name);
    return m !== null && entryNames.has(m[1]!);
  };
}

/** dts 面的模块面（导出名 / 类 / 再导出）。 */
export function dtsModuleSurfaceOf(source: string): DtsModuleSurface {
  return dtsModuleSurface(source);
}

/** dts 面的导出名集合（与 check entry 表同源）。 */
export function dtsEntryNames(source: string): ReadonlySet<string> {
  return localNamedExports(source);
}

/**
 * dts 面的逐函数投影：契约面优先（手写契约参数/返回投影）；无返回契约但有参数
 * 契约时用**契约种子求值**折返回（与 check 的 refine 种子同向：u: { name:
 * string } ⇒ u.name: string）。
 *
 * 返回 undefined = 该函数不在导出面（不进 .d.ts）。
 */
export function dtsFaceEntry(
  fn: FunctionAnalysis,
  baseName: string,
  eff: EffectiveInterface | undefined,
  source: string,
  filePath: string,
  evalMocks: Record<string, Abs> | undefined,
  surface: DtsModuleSurface | undefined,
): DtsFaceEntry {
  const contractParams: ParamFace[] = contractParamFace(eff);
  let contractReturn: Abs | undefined = contractReturnFace(eff);
  if (contractReturn === undefined && contractParams.length > 0) {
    const byName = new Map(contractParams.map((p) => [p.name, p.abs]));
    const seedArgs = fn.paramNames.map(
      (n) =>
        byName.get(n.startsWith("...") ? n.slice(3) : n) ??
        makeAbs({ k: "any" }, undefined, undefined, "path"),
    );
    // fail-closed：求值失败/不可求值 → undefined，返回位落 case 观察
    contractReturn =
      tryEvalCall(source, filePath, fn.name, seedArgs, evalMocks ? { mocks: evalMocks } : {}) ??
      undefined;
  }
  const contractFace: DtsContractFace | undefined =
    contractParams.length > 0 || contractReturn !== undefined
      ? {
          params: contractParams,
          ...(contractReturn !== undefined ? { return: contractReturn } : {}),
        }
      : undefined;
  const projection = projectFunctionDts(fn, contractFace, surface);
  return {
    fn,
    projection,
    ...(contractFace !== undefined ? { contract: contractFace } : {}),
  };
}

/**
 * dts 面的模块面合成：类声明（一次一类）+ 再导出面 + brand 类声明。
 *
 * 函数声明行由**模块面**统一合成 ⇒ 这里只出模块块，不单独出函数声明（否则同
 * 一条声明出两遍）。
 */
export function dtsModuleChunk(
  surface: DtsModuleSurface | undefined,
  entries: readonly DtsFaceEntry[],
): string | undefined {
  const mod = projectModuleDts(surface, entries);
  if (mod.lines.length === 0) return undefined;
  return mod.lines.join("\n");
}

/**
 * dts 面的无证据参数位（`unknown` = 推理失败）：`<fn>.<param>` 列表。
 *
 * 无证据（无契约 / 无 case / 无调用点）而落 unknown 的参数位（stderr 提示用）。
 */
export function dtsUnevidencedParams(
  entry: DtsFaceEntry,
  baseName: string,
): string[] {
  const out: string[] = [];
  for (const p of entry.projection.params) {
    if (p.type === "unknown") out.push(`${baseName}.${p.name}`);
  }
  return out;
}
