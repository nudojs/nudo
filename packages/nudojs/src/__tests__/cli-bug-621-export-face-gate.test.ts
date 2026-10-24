/**
 * Bug 621 —— 四个产物面「哪些函数算公开」有**四套口径**：dts 面按模块导出面
 * 裁剪，zod / standard / guard 三面**不裁剪** ⇒ 源模块**一个导出都没有**时，
 * 三个运行时校验器产物照样产出（内部实现被当成公开契约），`.d.ts` 却静默缺席。
 *
 * 根因：`onExportFace` 这道**模块公开面**闸门只装在 dts 分支上。
 *
 * 钉：导出面过滤下沉到循环入口 ⇒ 四个面共用一道闸门（内部函数不进任何一面）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/** 只有一个**非导出**函数的模块（Bug 621 的原始夹具形状）。 */
function writeInternalOnlyFixture(dir: string): void {
  writeFileSync(
    join(dir, "lib.js"),
    `/** @nudo:case "c1" (1) => 2 */
function internal(x) {
  return x + 1;
}
`,
    "utf-8",
  );
}

describe("export — 四个产物面共用导出面闸门（Bug 621）", () => {
  it("非导出函数不进 zod / standard / guard 三面（stdout 面）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug621-"));
    writeInternalOnlyFixture(dir);

    const r = runCli(["export", join(dir, "lib.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    // 内部函数不得出现在任何产物面
    expect(r.stdout).not.toContain("internalInput");
    expect(r.stdout).not.toContain("internalOutput");
    expect(r.stdout).not.toContain("internal_x");
    expect(r.stdout).not.toContain("isinternalOutput");
    // 零产物如实说明（不是静默零产物）
    expect(r.stdout).toContain("No exported declarations found");
  });

  it("非导出函数不进任何落盘产物（--out 面）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug621-out-"));
    writeInternalOnlyFixture(dir);

    const out = join(dir, "out");
    const r = runCli(["export", join(dir, "lib.js"), "--format", "all", "--out", out]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("No exported declarations found");
    // 目录里没有任何产物文件（四个面一致缺席）
    expect(existsSync(out) ? readdirSync(out) : []).toEqual([]);
  });

  it("导出面函数照常进四（闸门不误伤公开面）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug621-keep-"));
    writeFileSync(
      join(dir, "pub.js"),
      `/** @nudo:case "c1" (1) => 2 */
export function public1(x) {
  return x + 1;
}
`,
      "utf-8",
    );

    const r = runCli(["export", join(dir, "pub.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("public1Input");
    expect(r.stdout).toContain("public1_x");
    expect(r.stdout).toContain("ispublic1Output");
    expect(r.stdout).toContain("export declare function public1");
  });
});
