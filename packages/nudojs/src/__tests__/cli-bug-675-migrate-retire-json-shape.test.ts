/**
 * Bug 675 — `migrate retire --all --json` 的**顶层 JSON 形状随结果条数变化**
 * （1 个包 = 对象，≥2 个包 = 数组）⇒ 机器可读契约不稳定。
 *
 * 族 16（commit e5b3f388）已在**命令层**修好（顶层恒为数组）⇒ 本文件是
 * **回归钉**（防止回退到「单元素退化为对象」的糖）。
 *
 * 反向闸（断言非永真）：把命令层换回**族 16 之前**的版本 ⇒ 「1 个包时顶层
 * 仍是数组」断言**必红**（旧实现顶层是对象，`Array.isArray` 为 false）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** pnpm workspace：root + n 个可退役包 */
function workspace(pkgCount: number): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-cli-bug-675-"));
  dirs.push(root);
  writeFileSync(join(root, "package.json"), '{ "name": "root", "private": true }\n', "utf-8");
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf-8");
  for (let i = 0; i < pkgCount; i++) {
    const dir = join(root, "packages", `p${i}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: `p${i}`,
        version: "1.0.0",
        devDependencies: { typescript: "^5.0.0" },
        scripts: { typecheck: "tsc --noEmit" },
      }),
      "utf-8",
    );
  }
  return root;
}

describe("Bug 675 — migrate retire --all --json 顶层形状恒定（回归钉）", () => {
  it("1 个可退役包 ⇒ 顶层仍是数组（不得退化为对象）", () => {
    const root = workspace(1);
    const r = runCliTsx(["migrate", "retire", root, "--all", "--dry-run", "--json"]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it("2 个可退役包 ⇒ 顶层同样是数组（形状不随条数漂移）", () => {
    const root = workspace(2);
    const r = runCliTsx(["migrate", "retire", root, "--all", "--dry-run", "--json"]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  it("两个场景的顶层形状一致（都是数组）", () => {
    const one = runCliTsx([
      "migrate",
      "retire",
      workspace(1),
      "--all",
      "--dry-run",
      "--json",
    ]);
    const two = runCliTsx([
      "migrate",
      "retire",
      workspace(2),
      "--all",
      "--dry-run",
      "--json",
    ]);
    expect(one.status, one.stderr).toBe(0);
    expect(two.status, two.stderr).toBe(0);
    expect(Array.isArray(JSON.parse(one.stdout))).toBe(Array.isArray(JSON.parse(two.stdout)));
  });
});
