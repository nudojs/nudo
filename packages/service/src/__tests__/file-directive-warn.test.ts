/**
 * e2e：JSDoc 块内错位的文件级指令族标签（@nudo:env / @nudo:mock-module）
 * 必须以 nudo:directive-syntax 警告流到 analyzeFile 诊断面——此前静默忽略，
 * 用户照抄 @nudo:case 的 JSDoc 写法即踩坑（check 落 unknown 且零警告）。
 * repro 形态对照：/tmp/dx-review/dep2.js（错误写法）vs dep7.js（正确写法）。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "../analyzer.ts";

const DEP2_SRC = `/**
 * @nudo:env node
 */
import { join } from "node:path";

export function safeJoin(base, rel) {
  return join(base, rel);
}
`;

const DEP7_SRC = `/// @nudo:env node
import { join } from "node:path";

export function safeJoin(base, rel) {
  return join(base, rel);
}
`;

const MOCK_MODULE_BLOCK_SRC = `/**
 * @nudo:mock-module "fs" { readFileSync } from "./mock-fs.js"
 */
import { readFileSync } from "node:fs";

export function readAll(p) {
  return readFileSync(p, "utf-8");
}
`;

describe("misplaced file-level directive tags surface as diagnostics", () => {
  it("dep2 form (JSDoc block @nudo:env) → nudo:directive-syntax warning", () => {
    const result = analyzeFile("/t/dep2-warn.js", DEP2_SRC);
    const warn = result.diagnostics.find(
      (d) =>
        d.code === "nudo:directive-syntax" &&
        d.message.includes("@nudo:env is a file-level directive"),
    );
    expect(warn).toBeDefined();
    expect(warn!.severity).toBe("warning");
    expect(warn!.message).toBe(
      `@nudo:env is a file-level directive — use '/// @nudo:env node' at the top of the file (JSDoc block form is ignored)`,
    );
    // 函数本身仍被分析（警告不挡分析面）
    expect(result.functions.some((f) => f.name === "safeJoin")).toBe(true);
  });

  it("dep7 form (/// @nudo:env node) → no directive-syntax warning", () => {
    const result = analyzeFile("/t/dep7-warn.js", DEP7_SRC);
    expect(
      result.diagnostics.filter((d) => d.code === "nudo:directive-syntax"),
    ).toEqual([]);
  });

  it("JSDoc block @nudo:mock-module → nudo:directive-syntax warning", () => {
    const result = analyzeFile("/t/mock-mod-warn.js", MOCK_MODULE_BLOCK_SRC);
    const warn = result.diagnostics.find(
      (d) =>
        d.code === "nudo:directive-syntax" &&
        d.message.includes("@nudo:mock-module is a file-level directive"),
    );
    expect(warn).toBeDefined();
    expect(warn!.message).toBe(
      `@nudo:mock-module is a file-level directive — use '/// @nudo:mock-module "fs" from "./mock-fs.js"' at the top of the file (JSDoc block form is ignored)`,
    );
  });

  it("/// @nudo:mock-module correct form → no directive-syntax warning", () => {
    const src = `/// @nudo:mock-module "fs" { readFileSync } from "./mock-fs.js"\nimport { readFileSync } from "node:fs";\nexport function readAll(p) { return readFileSync(p, "utf-8"); }\n`;
    const result = analyzeFile("/t/mock-mod-ok.js", src);
    expect(
      result.diagnostics.filter((d) => d.code === "nudo:directive-syntax"),
    ).toEqual([]);
  });
});
