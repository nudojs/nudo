/**
 * Bug 610 —— 侧车（`*.nudo.js`）装载失败时，export 面**静默降级**：契约整条
 * 丢失 ⇒ 产物面把「未申报」当「无约束」发布（zod 面落 `z.unknown()`），而
 * stderr **零提示**、exit 0 ⇒ 消费方拿到一份比「没有契约」更危险的校验器。
 *
 * 根因：export 面不看 check 面的 `nudo:interface-load` 诊断 ⇒ 装载失败无人上屏。
 *
 * 钉：侧车装载失败 ⇒ export 报错退出（exit 1）+ stderr 上屏真实诊断
 * + **不发布产物**。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/** 侧车在装载期抛错 ⇒ `nudo:interface-load`（契约整条丢失）。 */
function writeBrokenSidecarFixture(dir: string): void {
  writeFileSync(
    join(dir, "badload.nudo.js"),
    `import { number } from "@nudojs/core";
export const num = number();
throw new Error("sidecar boom");
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "badload.js"),
    `/// @nudo:import { num } from "./badload.nudo.js"
/**
 * @nudo:contract a num
 */
export function f(a) {
  return a;
}
`,
    "utf-8",
  );
}

describe("export — 侧车装载失败时报错退出（Bug 610）", () => {
  it("stderr 上屏 nudo:interface-load 且 exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug610-"));
    writeBrokenSidecarFixture(dir);

    const r = runCli(["export", join(dir, "badload.js"), "--format", "all"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nudo:interface-load");
    // 真实原因上屏（侧车路径 + 失败原因）
    expect(r.stderr).toContain("badload.nudo.js");
    expect(r.stderr).toContain("sidecar boom");
    // 不发布产物（stdout 面空）
    expect(r.stdout).toBe("");
  });

  it("--out 落盘面同样不落任何产物", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug610-out-"));
    writeBrokenSidecarFixture(dir);

    const out = join(dir, "out");
    const r = runCli(["export", join(dir, "badload.js"), "--format", "all", "--out", out]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nudo:interface-load");
    expect(existsSync(out)).toBe(false);
  });

  it("诊断文案与 check 面同码同因（nudo check 也报 interface-load）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug610-check-"));
    writeBrokenSidecarFixture(dir);

    const check = runCli(["check", join(dir, "badload.js")]);
    expect(check.status).toBe(1);
    expect(check.stdout + check.stderr).toContain("nudo:interface-load");

    const exp = runCli(["export", join(dir, "badload.js"), "--format", "dts"]);
    expect(exp.status).toBe(1);
    expect(exp.stderr).toContain("nudo:interface-load");
  });
});
