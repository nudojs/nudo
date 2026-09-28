import type { Abs } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";
import { safeExportIdent } from "./schema-generator.ts";

/** Abs 指称守卫（设计 §2.7）：保留 pred */
export function generateGuardFunctionFromAbs(name: string, abs: Abs): string {
  const body = denoteGuard(abs, "data");
  return `export function ${safeExportIdent(name)}(data) {\n  return ${body};\n}`;
}

/** 兼容别名：Abs 路径唯一 */
export function generateGuardFunction(name: string, abs: Abs): string {
  return generateGuardFunctionFromAbs(name, abs);
}
