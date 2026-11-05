/**
 * Bug 579 — `nudo migrate retire` 把 workflow 里**任何提到 tsc 的行**当命令改写
 * ⇒ 数据损坏（env 变量的值 / 描述性文字被改成门禁命令）。
 *
 * 契约：workflow YAML 里**只有 `run:` 的标量是命令位**；
 * env 值 / 描述文字 / 注释必须逐字保留。
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
import { migrateStatus, migrateRetire, listWorkflowTscLines } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const WF = [
  "name: CI",
  "on: [push]",
  "env:",
  "  TSC: tsc",
  "  NOTE: use tsc for typecheck",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: npx tsc --noEmit",
  "",
].join("\n");

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-579-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "b579",
        version: "1.0.0",
        scripts: { typecheck: "npx tsc --noEmit" },
        devDependencies: { typescript: "^5.0.0" },
      },
      null,
      2,
    )}\n`,
  );
  const wf = join(dir, ".github", "workflows");
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, "ci.yml"), WF);
  return dir;
}

describe("Bug 579 — workflow 里非命令位的 tsc 被当命令改写（数据损坏）", () => {
  it("status 的 tsc 行数只数真正的命令行（1 条，不是 3 条）", () => {
    const dir = fixture();
    expect(listWorkflowTscLines(dir).length).toBe(1);
    expect(listWorkflowTscLines(dir)[0]!.line).toContain("npx tsc --noEmit");
  });

  it("retire 后 env 值 / 描述文字逐字未变，只有 run: 那条被改写", () => {
    const dir = fixture();
    migrateRetire(dir);
    const wf = readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8");
    // 非命令位：逐字未变
    expect(wf).toContain("  TSC: tsc\n");
    expect(wf).toContain("  NOTE: use tsc for typecheck\n");
    // 命令位：被改写
    expect(wf).toContain("- run: npx nudojs check .");
    expect(wf).not.toContain("- run: npx tsc --noEmit");
    // 非命令位不得出现门禁命令
    expect(wf).not.toContain("TSC: nudo check");
    expect(wf).not.toContain("NOTE: use nudo check");
  });

  it("status 的 workflow blocker 计数与改写口径一致", () => {
    const dir = fixture();
    const rows = migrateStatus(dir);
    const blocker = rows[0]!.blockers.find((b) => b.includes("tsc line(s)"));
    expect(blocker).toBe("1 tsc line(s) in .github/workflows");
  });
});
