/**
 * findModuleImportLoc 只认 import/require 的 specifier 位置。
 * 字符串/注释里的 `"fs"` 不是依赖声明——误定位会把诊断行号指到无关文本。
 */
import { describe, it, expect } from "vitest";
import { findModuleImportLoc } from "../analyzer-diagnose.ts";

describe("findModuleImportLoc is string/comment-aware", () => {
  it("comment-quoted module name is not an import", () => {
    const src = `// resolve "fs" later\nexport const x = 1;\n`;
    expect(findModuleImportLoc(src, "fs")).toBeNull();
  });

  it("string literal used as a value is not an import", () => {
    const src = `const note = "fs";\nexport const x = 1;\n`;
    expect(findModuleImportLoc(src, "fs")).toBeNull();
  });

  it("require() specifier is found", () => {
    const src = `const fs = require("fs");\nexport const x = 1;\n`;
    const loc = findModuleImportLoc(src, "fs")!;
    expect(loc.line).toBe(0);
    expect(loc.column).toBe(src.indexOf('"fs"'));
  });

  it("import from specifier is found", () => {
    const src = `import fs from "fs";\nexport const x = 1;\n`;
    const loc = findModuleImportLoc(src, "fs")!;
    expect(loc.line).toBe(0);
    expect(loc.column).toBe(src.indexOf('"fs"'));
  });

  it("node: alias resolves to the bare name", () => {
    const src = `const f = require("node:fs");\n`;
    const loc = findModuleImportLoc(src, "fs")!;
    expect(loc).not.toBeNull();
    expect(findModuleImportLoc(src, "node:fs")).not.toBeNull();
  });

  it("dynamic import() specifier is found", () => {
    const src = `export async function load() {\n  return import("path");\n}\n`;
    const loc = findModuleImportLoc(src, "path")!;
    expect(loc.line).toBe(1);
  });

  it("template-only mention in a comment is not an import", () => {
    const src = `const doc = \`uses "path"\`;\nexport const x = 1;\n`;
    expect(findModuleImportLoc(src, "path")).toBeNull();
  });
});
