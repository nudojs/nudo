/**
 * Bug 447 —— 类成员的 `x!`（确定赋值断言）与 `y?` / `m?()`（可选成员）未剥
 * ⇒ 产物**不是合法 JS**（`node --check` 报 `SyntaxError: Unexpected token
 * '!'` / `'?'`）。
 *
 * **真源**：`packages/core/src/strip-types.ts`（类成员节点族上的 `definite`
 * 与 `optional` 删除）。本钉是**产物面**的回归钉：产物必须 `node --check`
 * 过，且不得残留 `x!` / `y?` / `m?()`。
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

const FIELDS_TS = `export class A {
  x!: number;
  y?: string;
}
`;
const OPTIONAL_METHOD_TS = `export class A {
  m?(): void {}
}
export const z = 1;
`;

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

describe("Bug 447 —— 类成员的 `x!` / `y?` / `m?()` 必须被剥除（产物是合法 JS）", () => {
  it("字段的 `x!` / `y?` 被剥 ⇒ 产物 `node --check` 过", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-447-"));
    dirs.push(dir);
    writeFileSync(join(dir, "f3.ts"), FIELDS_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "f3.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "f3.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).not.toContain("x!");
    expect(code).not.toContain("y?");
    expect(code).toContain("x;");
    expect(code).toContain("y;");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  });

  it("可选方法 `m?()` 被剥 ⇒ 产物 `node --check` 过", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-447b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "om.ts"), OPTIONAL_METHOD_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "om.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "om.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).not.toContain("m?()");
    expect(code).toContain("m() {}");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  });
});
