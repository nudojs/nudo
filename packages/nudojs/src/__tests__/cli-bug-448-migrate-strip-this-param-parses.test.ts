/**
 * Bug 448 —— TS 的 `this` 形参未剥 ⇒ 产物 `function f(this, a)` **Node 根本
 * 加载不了**（strict 与 sloppy 都不允许 `this` 作形参名），而 `migrate strip`
 * 报「wrote」/ exit 0。
 *
 * **真源**：`packages/core/src/strip-types.ts`（把 `this` 形参从**形参数组**
 * 里删掉，与 tsc 的 emitter 同口径）。本钉是**产物面**的回归钉：产物必须
 * `node --check` 过，且形参表里不得再有 `this`。
 *
 * ⚠ 验收口径是「**strip 不产出坏产物**」——`migrate verify` 的契约是「跑
 * `nudo check`」，**不在**族 12 的改动范围（跨族增强须先改文档）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const THIS_PARAM_TS = `export function f(this: { x: number }, a: number): number {
  return a + 1;
}
`;

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

describe("Bug 448 —— TS 的 `this` 形参必须被剥除（产物可加载）", () => {
  it("`this` 形参被剥 ⇒ 产物 `node --check` 过且形参表只剩 `a`", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-448-"));
    dirs.push(dir);
    writeFileSync(join(dir, "thisparam.ts"), THIS_PARAM_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "thisparam.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "thisparam.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).toContain("export function f(a)");
    expect(code).not.toContain("f(this");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  });

  it("函数体里的 `this` **表达式**必须保留（只有形参位被删）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-448b-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "body.ts"),
      `export function g(this: { x: number }) { return this.x; }\n`,
      "utf-8",
    );

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "body.ts")]);
    expect(r.status, r.stderr).toBe(0);
    const product = join(dir, "body.js");
    const code = readFileSync(product, "utf-8");
    expect(code).toContain("this.x");
    expect(code).not.toContain("g(this");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  });
});
