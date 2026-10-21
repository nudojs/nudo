/**
 * Bug 580 — `nudo migrate retire` **漏改** YAML 引号包住的 `run:` tsc 命令
 * ⇒ 报「已退役」但 CI 的 tsc 门禁原样保留（假绿）。
 *
 * 契约：YAML 的标量引号 ≠ shell 的引号——处理 `run:` 时按 **YAML 语义**取标量
 * （剥掉 YAML 自己的引号），不得用 shell 词法掩码把引号内容当字符串遮掉。
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
  rewriteWorkflowText,
} from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const WF = [
  "name: CI",
  "on: [push]",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: npx tsc --noEmit",
  '      - run: "npx tsc --noEmit"',
  "      - run: 'npx tsc --noEmit'",
  "",
].join("\n");

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-580-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "b580",
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

describe("Bug 580 — YAML 引号包住的 run: tsc 命令被漏改（假绿）", () => {
  it("rewriteWorkflowText 改写引号标量里的 tsc（保留原引号风格）", () => {
    const { text, changes } = rewriteWorkflowText(WF);
    expect(changes.length).toBe(3);
    expect(text).toContain('- run: "npx nudojs check ."');
    expect(text).toContain("- run: 'npx nudojs check .'");
    expect(text).toContain("- run: npx nudojs check .");
    expect(text).not.toContain("tsc --noEmit");
  });

  it("status 的 tsc 行数与真实条数一致（3 条，不是 1 条）", () => {
    const dir = fixture();
    expect(listWorkflowTscLines(dir).length).toBe(3);
    const blocker = migrateStatus(dir)[0]!.blockers.find((b) => b.includes("tsc line(s)"));
    expect(blocker).toBe("3 tsc line(s) in .github/workflows");
  });

  it("retire 后 CI 里不再残留 tsc 门禁", () => {
    const dir = fixture();
    migrateRetire(dir);
    const wf = readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8");
    expect(wf).not.toContain("tsc --noEmit");
    expect(wf).toContain('- run: "npx nudojs check ."');
    expect(wf).toContain("- run: 'npx nudojs check .'");
  });
});
