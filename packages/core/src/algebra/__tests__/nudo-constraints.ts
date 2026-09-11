/**
 * 测试用标准约束库（*.nudo.js 形态）。
 * 金标统一：@nudo:refine <param> <name>
 */
export const STD_NUDO_SRC = `
export const positive = number().gt(0);
export const delay = number().gt(0);
export const nonNeg = number().ge(0);
export const percent = number().ge(0).le(100);
export const port = number().ge(1).le(65535);
export const small = number().lt(10);
export const atLeast1 = number().ge(1);
export const max100 = number().le(100);
export const intId = number().int().gt(0);
export const shortName = string().min(1).max(20);
export const positives = array(number().gt(0));
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
`;

/** 给无 import 的测试源补上标准 import 行 */
export function withStdImport(source: string): string {
  if (source.includes("@nudo:import")) return source;
  return `/// @nudo:import { positive, delay, nonNeg, percent, port, small, atLeast1, max100, intId, shortName, positives, userShape, configShape, orderShape } from "./std.nudo.js"\n${source}`;
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
