/**
 * Bug 600 —— `@nudo:skip` 的函数被导出入口 filter **静默丢掉**。
 *
 * 根因：`selectExportFunctions` 只放行「有 case 见证」的函数，而 `@nudo:skip`
 * 按设计**不合成** entry@ 见证（零 case）⇒ skip 函数永远进不了导出面 ⇒
 * 导出面少一块，且 dts 生成器专为 skip 建的 `contractOnlySignature` 路径永不可达。
 *
 * 钉：skip 函数（带契约）必须出现在四个产物面里。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/** 带 `@nudo:skip` + 参数契约的导出函数（约束名走 `@nudo:import` 绑定）。 */
function writeSkipFixture(dir: string): void {
  writeFileSync(
    join(dir, "std.nudo.js"),
    `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "skipped.js"),
    `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:skip
 * @nudo:contract a positive
 */
export function skipped(a) {
  throw new Error("unreachable");
}
`,
    "utf-8",
  );
}

describe("export — @nudo:skip 的函数不被静默丢掉（Bug 600）", () => {
  it("skip 函数进导出面（zod / standard / dts / guard 四面都有）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug600-"));
    writeSkipFixture(dir);

    const r = runCli(["export", join(dir, "skipped.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    // zod 面：skip 函数的入参校验器在（契约面 a: number > 0）
    expect(r.stdout).toContain("skippedInput");
    // standard 面：skip 函数的参数位在
    expect(r.stdout).toContain("skipped_a");
    // guard 面：skip 函数的块在（无 case ⇒ 无守卫函数，但块本身不被丢掉）
    expect(r.stdout).toContain("// === skipped Type Guards ===");
    // dts 面：skip 函数的声明在（走 contractOnlySignature 路径）
    expect(r.stdout).toMatch(/export declare function skipped\(/);
  });

  it("skip 函数在 --out 落盘面同样有产物（四个文件都在）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug600-out-"));
    writeSkipFixture(dir);

    const out = join(dir, "out");
    const r = runCli(["export", join(dir, "skipped.js"), "--format", "all", "--out", out]);
    expect(r.status).toBe(0);
    const files = readdirSync(out);
    // schema / standard / guard / dts —— skip 函数不再让任何一面缺席
    expect(files.some((f) => f.includes("schema"))).toBe(true);
    expect(files.some((f) => f.includes("standard"))).toBe(true);
    expect(files.some((f) => f.includes("guard"))).toBe(true);
    expect(files.some((f) => f.endsWith(".d.ts"))).toBe(true);
    const std = files.find((f) => f.includes("standard"));
    expect(std).toBeDefined();
    expect(readFileSync(join(out, std!), "utf-8")).toContain("skipped_a");
  });
});
