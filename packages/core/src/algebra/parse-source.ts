/**
 * AST 源码解析入口（core 层）。
 * 不依赖 @nudojs/parser，避免 core ↔ parser 包环。
 * 与 parser.parse 同插件集 + 统一 TS 剥除。
 */
import { parse as babelParse } from "@babel/parser";
import type { File } from "@babel/types";
import { stripTypes } from "../strip-types.ts";

export function parseSource(
  source: string,
  opts?: { errorRecovery?: boolean },
): File {
  const ast = babelParse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
    attachComment: true,
    errorRecovery: opts?.errorRecovery === true,
  });
  return stripTypes(ast);
}
