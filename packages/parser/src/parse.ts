import { parse as babelParse } from "@babel/parser";
import type { File } from "@babel/types";

export function parse(source: string): File {
  return babelParse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
    attachComment: true,
  });
}
