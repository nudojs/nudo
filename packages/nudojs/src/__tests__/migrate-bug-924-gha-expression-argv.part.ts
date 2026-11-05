/**
 * Bug 924 — `nudo migrate retire` 改写 CI 步骤时**按空白切词解析 tsc argv**
 * ⇒ GitHub Actions 的 `${{ … }}` 表达式被截断并单引号封死
 * ⇒ 写下**一条必然红**的 CI 命令（`npx nudojs check 'packages/${{'`）。
 *
 * 契约：`${{ … }}`（以及 shell 变量 / glob）是**不可分割的 token**；
 * 改写后要么仍指向存在的路径，要么被明确拒绝——不得产出「指向不存在目录的字面量」。
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
import { migrateRetire, rewriteTscCommand } from "../migrate.ts";

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
  "    strategy:",
  "      matrix:",
  "        pkg: [a, b]",
  "        tsconfig: [tsconfig.a.json, tsconfig.b.json]",
  "    steps:",
  "      - run: npx tsc -p packages/${{ matrix.pkg }}/tsconfig.json",
  "      - run: npx tsc --project ${{ matrix.tsconfig }}",
  "      - run: npx tsc -p packages/a/tsconfig.json",
  "      - run: npx tsc --noEmit",
  "",
].join("\n");

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-924-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "b924",
        version: "1.0.0",
        scripts: { typecheck: "tsc --noEmit" },
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

describe("Bug 924 — CI 表达式 ${{ … }} 被截断成字面量路径", () => {
  it("rewriteTscCommand 不把 ${{ … }} 切开", () => {
    const out = rewriteTscCommand("npx tsc -p packages/${{ matrix.pkg }}/tsconfig.json").cmd;
    // 表达式整体保留（不得被截成 `packages/${{`）
    expect(out).not.toContain("packages/${{'");
    expect(out).not.toContain("'${{'");
    expect(out).toContain("${{ matrix.pkg }}");
  });

  it("shell 变量 / glob 不被单引号封死（展开仍由 shell / CI 负责）", () => {
    const v = rewriteTscCommand("tsc -p $TSCONFIG").cmd;
    expect(v).not.toContain("'$TSCONFIG'");
    const g = rewriteTscCommand("tsc -p packages/*/tsconfig.json").cmd;
    expect(g).not.toContain("'packages/*'");
    expect(g).toContain("packages/*");
  });

  it("retire 后 CI 步骤里不再有被截断的表达式路径", () => {
    const dir = fixture();
    migrateRetire(dir);
    const wf = readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8");
    expect(wf).not.toContain("packages/${{'");
    expect(wf).not.toContain("'${{'");
    // 表达式整体保留 ⇒ CI 展开后仍指向 packages/<pkg>
    expect(wf).toContain("packages/${{ matrix.pkg }}");
    // 落盘的每条命令都以 npx nudojs check 开头（不是坏路径）
    for (const line of wf.split("\n")) {
      if (line.includes("run:") && line.includes("check")) {
        expect(line).toMatch(/run: npx nudojs check /);
      }
    }
  });
});
