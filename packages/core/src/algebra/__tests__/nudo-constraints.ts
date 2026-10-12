/**
 * 测试用标准约束库（*.nudo.js 形态）。
 * 金标统一：@nudo:contract <param> <name>
 */
import { checkSource, pTrue } from "../index.ts";

export const STD_NUDO_SRC = `
export const positive = number().gt(0);
export const delay = number().gt(0);
export const nonNeg = number().ge(0);
export const num = number();
export const percent = number().ge(0).le(100);
export const port = number().ge(1).le(65535);
export const small = number().lt(10);
export const atLeast1 = number().ge(1);
export const max100 = number().le(100);
export const intId = number().int().gt(0);
export const intOnly = number().int();
export const shortName = string().min(1).max(20);
export const nonEmpty = string();
export const positives = array(number().gt(0));
export const findings = array(shape({ severity: string() }));
export const userShape = shape({
  id: number().gt(0),
  name: string(),
});
export const configShape = shape({
  retries: number().ge(0).le(5),
  label: string().optional(),
});
export const orderShape = shape({
  user: shape({ id: number().gt(0), name: string() }),
  tags: array(string().min(1)),
});
export const status = union(lit(0), lit(1));
export const numOrStr = union(number(), string());
export const scorecard = shape({ codeBehavior: percent });
export const scorecardFindings = array(shape({ category: string(), severity: string() }));
export const dimensionScores = shape({
  supplyChain: percent,
  codeBehavior: percent,
  dependencyHealth: percent,
  maintainerHistory: percent,
  metadataTrust: percent,
});
export const mapper = fn({ x: number() }, number());
export const maybePositive = nullable(number().gt(0));
export const nullableNum = nullable(number());
export const posOrNull = union(number().gt(0), lit(null));
export const numOrNull = union(number(), lit(null));
`;

/** 给无 import 的测试源补上标准 import 行 */
export function withStdImport(source: string): string {
  if (source.includes("@nudo:import")) return source;
  return `/// @nudo:import { positive, delay, nonNeg, num, percent, port, small, atLeast1, max100, intId, intOnly, shortName, nonEmpty, positives, findings, userShape, configShape, orderShape, status, numOrStr, mapper, maybePositive, nullableNum, posOrNull, numOrNull, scorecard, scorecardFindings, dimensionScores } from "./std.nudo.js"\n${source}`;
}

/** checkSource 用的 loadModule */
export function stdLoadModule(spec: string): string | undefined {
  if (spec.includes("std.nudo") || spec.endsWith(".nudo.js")) return STD_NUDO_SRC;
  return undefined;
}

export const stdOpts = {
  loadModule: stdLoadModule,
  fromFile: "/test/file.js",
};

/** L2 entry-may-throw 的 issue 数（按函数名过滤可选）——去重自 15+ 份文件内私有副本 */
export function l2Count(
  r: { issues: { code: string; fn?: string }[] },
  fn?: string,
): number {
  return r.issues.filter(
    (i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn),
  ).length;
}

/** 按函数名取 checkSource 签名显示串（缺失为 "(missing)"） */
export function sigOf(
  r: { signatures: { name: string; display: string }[] },
  fn: string,
): string {
  return r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
}

/** checkSource + withStdImport + stdOpts 的标准三件套包装（file 参与相对解析，各文件保留原路径） */
export function issuesOf(src: string, file = "/t/std-issues.js") {
  return checkSource(file, withStdImport(src), pTrue, stdOpts);
}

export function errorsOf(src: string, file?: string) {
  return issuesOf(src, file).issues.filter((i) => i.severity === "error");
}

export function warningsOf(src: string, file?: string) {
  return issuesOf(src, file).issues.filter((i) => i.severity === "warning");
}

/** issue 回归文件的侧车 opts：spec 含 marker 时返回 src，其余 undefined */
export function sidecarOpts(marker: string, src: string, fromFile = "/test/file.js") {
  return {
    loadModule: (spec: string): string | undefined =>
      spec.includes(marker) ? src : undefined,
    fromFile,
  };
}

/** 虚拟文件系统 loader：相对 spec 按 fromFile 目录解析（去重自 11 份文件内私有副本） */
export function makeFiles(files: Record<string, string>) {
  const resolve = (from: string, spec: string): string => {
    if (!spec.startsWith(".")) return spec;
    const parts = from.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return parts.join("/");
  };
  const loadModule = (spec: string, from: string): string | undefined =>
    files[resolve(from, spec)];
  return { loadModule, resolve };
}
