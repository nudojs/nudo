/**
 * Bug 1005 — `nudo migrate retire` 改写 CI workflow 时**按行**处理 YAML，
 * 把**跨行的 shell 命令**拆开 ⇒ 原本可用的 CI 门禁被改坏
 * （续行标记被吃 ⇒ 命令裂成两条；折叠标量 ⇒ 旗标被并进命令）。
 *
 * 契约：块标量（`run: |` / `run: >`）在 YAML 层面是**一条标量**——
 * 改写器必须整体取出、在命令层面改写、再按原形态写回。
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
import { migrateRetire, rewriteWorkflowText } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const WF = [
  "name: CI",
  "on: [push]",
  "jobs:",
  "  gate:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: A literal block with backslash continuation",
  "        run: |",
  "          npx tsc --noEmit \\",
  "            --project tsconfig.json",
  "      - name: B folded scalar",
  "        run: >",
  "          npx tsc",
  "          --noEmit",
  "      - name: C single line control",
  "        run: npx tsc --noEmit",
  "",
].join("\n");

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-1005-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "b1005",
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

describe("Bug 1005 — 跨行的 shell 命令被按行拆坏", () => {
  it("rewriteWorkflowText 把块标量当成一条命令改写", () => {
    const { text } = rewriteWorkflowText(WF);
    // A：续行标记与续行内容一起被改写，不得留下落单的残段
    expect(text).not.toContain("--project tsconfig.json");
    expect(text).toContain("run: |");
    expect(text).toContain("          npx nudojs check .");
    // B：折叠标量的旗标不得被并进命令
    expect(text).toContain("run: >");
    expect(text).not.toContain("npx nudojs check . --noEmit");
    // C：单行对照（step 的 `run:` 是 `name:` 的同级键）
    expect(text).toContain("        run: npx nudojs check .");
    expect(text.match(/npx nudojs check \./g)?.length).toBe(3);
  });

  it("retire 后落盘的 workflow 仍是合法 YAML 形态且命令语义正确", () => {
    const dir = fixture();
    migrateRetire(dir);
    const wf = readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8");
    // 落单的命令（原本的续行残段）不得残留
    expect(wf).not.toContain("--project tsconfig.json");
    expect(wf).not.toContain("npx nudojs check . --noEmit");
    // 块标量的样式保留
    expect(wf).toContain("run: |");
    expect(wf).toContain("run: >");
    // 每个 step 恰好一条 npx nudojs check 命令
    expect(wf.match(/npx nudojs check \./g)?.length).toBe(3);
    // 缩进保持（块标量内容仍比 key 深）
    expect(wf).toContain("\n          npx nudojs check .\n");
  });
});
