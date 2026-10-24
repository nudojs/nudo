/**
 * Bug 625 —— 契约**合取不可满足**（源码 `@nudo:contract` 与同名侧车约束互相
 * 矛盾）时，export 面照样发布产物：zod 面只编码了**一半**契约（源码侧那条
 * 约束被丢掉），消费方拿到一个**永远校验不过**的输入校验器；stderr 零提示。
 *
 * 根因：export 面不看契约冲突（`nudo:interface-conflict` 只在 check 面产出）。
 *
 * 钉：契约冲突 ⇒ export 报错退出（exit 1）+ stderr 上屏真实诊断
 * + **不发布产物**。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/** 源码契约（正数）与同名侧车（非正数）矛盾 ⇒ 合取不可满足。 */
function writeConflictFixture(dir: string): void {
  writeFileSync(
    join(dir, "shapes.nudo.js"),
    `import { string } from "@nudojs/core";
export const txt = string();
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "conflict.nudo.js"),
    `import { fn, number } from "@nudojs/core";
export const f = fn({ x: number() });
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "conflict.js"),
    `/// @nudo:import { txt } from "./shapes.nudo.js"
/**
 * @nudo:contract x txt
 */
export function f(x) {
  return x;
}
`,
    "utf-8",
  );
}

describe("export — 契约合取不可满足时报错退出（Bug 625）", () => {
  it("stderr 上屏 nudo:interface-conflict 且 exit 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug625-"));
    writeConflictFixture(dir);

    const r = runCli(["export", join(dir, "conflict.js"), "--format", "all"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nudo:interface-conflict");
    // 真实诊断带上函数名与冲突的参数位
    expect(r.stderr).toContain("f");
    expect(r.stderr).toContain("x");
    // 不发布产物（stdout 面空）
    expect(r.stdout).toBe("");
  });

  it("--out 落盘面同样不落任何产物", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug625-out-"));
    writeConflictFixture(dir);

    const out = join(dir, "out");
    const r = runCli(["export", join(dir, "conflict.js"), "--format", "all", "--out", out]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nudo:interface-conflict");
    expect(existsSync(out)).toBe(false);
  });

  it("诊断码与 check 面同码", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug625-check-"));
    writeConflictFixture(dir);

    const check = runCli(["check", join(dir, "conflict.js")]);
    expect(check.status).toBe(1);
    expect(check.stdout + check.stderr).toContain("nudo:interface-conflict");

    const exp = runCli(["export", join(dir, "conflict.js"), "--format", "dts"]);
    expect(exp.status).toBe(1);
    expect(exp.stderr).toContain("nudo:interface-conflict");
  });
});
