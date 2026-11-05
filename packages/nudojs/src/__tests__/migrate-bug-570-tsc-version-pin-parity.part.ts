/**
 * Bug 570 — `migrate` 的 tsc 调用形态「检测口径与改写口径分裂」：
 * 版本钉住的 `npx tsc@5.4.5` 被 status 计入、却不被 retire 改写
 * ⇒ 假绿（tsc 门禁原样留在 CI 里，工具却报「已退役」）。
 *
 * 契约：**检测口径 = 改写口径**（同一个匹配器）——「被计入 ⇒ 必被改写」。
 */
import { describe, it, expect, afterAll } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  migrateStatus,
  migrateRetire,
  listWorkflowTscLines,
  rewriteTscCommand,
} from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-570-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "b570",
        version: "1.0.0",
        scripts: {
          typecheck: "npx tsc@5.4.5 --noEmit",
          typecheck2: "npx tsc --noEmit",
        },
        devDependencies: { typescript: "^5.0.0" },
      },
      null,
      2,
    )}\n`,
  );
  const wf = join(dir, ".github", "workflows");
  mkdirSync(wf, { recursive: true });
  writeFileSync(
    join(wf, "ci.yml"),
    [
      "name: CI",
      "on: [push]",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: npx tsc@5.4.5 --noEmit",
      "      - run: npx tsc --noEmit",
      "      - run: pnpm exec tsc --noEmit",
      "      - run: npx tsc -p tsconfig.json --noEmit",
      "",
    ].join("\n"),
  );
  return dir;
}

describe("Bug 570 — 版本钉住的 tsc 逃过退役（检测口径 ≠ 改写口径）", () => {
  it("rewriteTscCommand 认得版本钉住形态 npx tsc@5.4.5", () => {
    expect(rewriteTscCommand("npx tsc@5.4.5 --noEmit").cmd).toBe("npx nudojs check .");
    expect(rewriteTscCommand("npx tsc@5.4.5 --noEmit").changed).toBe(true);
  });

  it("status 计入的每个 tsc 脚本都被 retire 改写（脚本面）", () => {
    const dir = fixture();
    const rows = migrateStatus(dir);
    // 检测口径：版本钉住那条也算 tsc
    expect(rows[0]!.tscScripts).toContain("typecheck");
    expect(rows[0]!.tscScripts).toContain("typecheck2");

    migrateRetire(dir);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    // 改写口径：两个脚本都被改写，仓库里不再残留 tsc 调用
    expect(pkg.scripts.typecheck).not.toContain("tsc");
    expect(pkg.scripts.typecheck2).not.toContain("tsc");
    expect(pkg.scripts.typecheck).toContain("nudo check");
    expect(pkg.scripts.typecheck2).toContain("nudo check");
    // 退役后 status 不再自相矛盾地报「tsc still in scripts」
    expect(migrateStatus(dir)[0]!.tscScripts).toEqual([]);
  });

  it("workflow 面的版本钉住行同样被计入并改写（CI 行数不多计）", () => {
    const dir = fixture();
    // 4 条 tsc 行（含版本钉住那条）
    expect(listWorkflowTscLines(dir).length).toBe(4);

    migrateRetire(dir);
    const wf = readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8");
    expect(wf).not.toContain("tsc@5.4.5");
    expect(wf).not.toContain("tsc --noEmit");
    expect(wf).not.toContain("tsc -p");
    expect(wf.match(/npx nudojs check \./g)?.length).toBe(4);
  });
});
