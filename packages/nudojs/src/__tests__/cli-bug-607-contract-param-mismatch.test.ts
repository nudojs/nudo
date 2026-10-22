/**
 * Bug 607 —— 契约形参名与声明形参表**对不上**时，export 面照样发布产物
 * （zod 面把契约位的名字原样搬进 `<fn>Input` ⇒ 消费方拿到一个**参数名与函数
 * 签名不一致**的校验器），且 stderr **一个字都没有**。
 *
 * 根因：export 面不看 check 面的契约一致性诊断（`nudo:interface-param-mismatch`
 * 只在 check 面产出）⇒ 契约与产物面对不上时无人上屏。
 *
 * 钉：契约形参名不在形参表 ⇒ export 报错退出（exit 1）+ stderr 上屏真实诊断
 * + **不发布产物**。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

describe("export — 契约形参名与形参表不匹配时报错退出（Bug 607）", () => {
  it("stderr 上屏 nudo:interface-param-mismatch 且 exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug607-"));
    writeFileSync(
      join(dir, "std.nudo.js"),
      `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`,
      "utf-8",
    );
    // 契约说 a，函数签名是 y ⇒ 形参名对不上
    writeFileSync(
      join(dir, "mismatch.js"),
      `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract x positive
 */
export function g(y) {
  return y;
}
`,
      "utf-8",
    );

    const r = runCli(["export", join(dir, "mismatch.js"), "--format", "all"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nudo:interface-param-mismatch");
    // 真实诊断带上函数名与错位的形参名
    expect(r.stderr).toContain("g");
    expect(r.stderr).toContain("x");
    // 不发布产物（stdout 面空）
    expect(r.stdout).toBe("");
  });

  it("--out 落盘面同样不落任何产物", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug607-out-"));
    writeFileSync(
      join(dir, "std.nudo.js"),
      `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "mismatch.js"),
      `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract x positive
 */
export function g(y) {
  return y;
}
`,
      "utf-8",
    );

    const out = join(dir, "out");
    const r = runCli(["export", join(dir, "mismatch.js"), "--format", "all", "--out", out]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nudo:interface-param-mismatch");
    expect(existsSync(out)).toBe(false);
  });
});
