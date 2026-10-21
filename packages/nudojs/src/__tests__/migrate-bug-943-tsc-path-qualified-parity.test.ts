/**
 * Bug 943 — `nudo migrate retire` 的 tsc **检测口径与改写口径不一致**
 * ⇒ 路径限定型的 tsc（`./node_modules/.bin/tsc`）被 status 计入、却不被 retire 改写
 * ⇒ `typescript` 依赖被删、tsc 调用却留着（落盘仓库自相矛盾）。
 *
 * 契约：检测与改写**同一个匹配器**——「被计入 ⇒ 必被改写」。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-943-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "b943",
        version: "1.0.0",
        type: "module",
        scripts: {
          typecheck: "tsc --noEmit",
          gate2: "./node_modules/.bin/tsc --noEmit",
        },
        devDependencies: { typescript: "^5.6.0" },
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
      "      - run: npx tsc --noEmit",
      "      - run: ./node_modules/.bin/tsc --noEmit",
      "",
    ].join("\n"),
  );
  return dir;
}

describe("Bug 943 — 路径限定型 tsc 被计入却不被改写", () => {
  it("rewriteTscCommand 认得路径限定型 tsc", () => {
    expect(rewriteTscCommand("./node_modules/.bin/tsc -p .").cmd).toBe("npx nudojs check .");
    expect(rewriteTscCommand("node_modules/.bin/tsc --noEmit").cmd).toBe(
      "npx nudojs check .",
    );
  });

  it("status 计入的脚本 / CI 行数与改写数一致", () => {
    const dir = fixture();
    const rows = migrateStatus(dir);
    expect(rows[0]!.tscScripts).toContain("gate2");
    // 2 条 tsc 行（路径限定那条也算）
    expect(listWorkflowTscLines(dir).length).toBe(2);
  });

  it("retire 后仓库里不再残留任何 tsc 调用（依赖已删，门禁必须同时退役）", () => {
    const dir = fixture();
    migrateRetire(dir);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkg.devDependencies.typescript).toBeUndefined();
    expect(pkg.scripts.typecheck).not.toContain("tsc");
    expect(pkg.scripts.gate2).not.toContain("tsc");
    const wf = readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8");
    expect(wf).not.toContain("tsc");
    expect(wf.match(/npx nudojs check \./g)?.length).toBe(2);
    // 退役后 status 不再报「tsc still in scripts」
    expect(migrateStatus(dir)[0]!.tscScripts).toEqual([]);
  });
});
