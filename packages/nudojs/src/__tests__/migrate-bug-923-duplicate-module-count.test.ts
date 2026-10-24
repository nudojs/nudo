/**
 * Bug 923 — `migrate strip --write` 保留源 `.ts`，门禁把「源 + 产物」当两个模块分析两遍。
 *
 * 根因：`strip` 默认（不加 `--backup`）把源 `.ts` 留在原地，产物 `.js` 落在旁边 ⇒
 * 目录级分析把同一个模块收了两份 ⇒ 机器面 `summary.errors` / `functions` /
 * `files` 恰好翻倍，`--fix` 的逐 issue 编辑也翻倍（改一份、另一份不变）。
 *
 * 期望：门禁按**模块**计数（同一模块只分析一遍）；`--backup` 与默认两条路径
 * 的计数必须相同。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateStrip } from "../migrate.ts";
import { collectNudoFiles } from "../commands/shared.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SRC = `export function setDelay(ms: number): number {\n  return ms.toFixed(2);\n}\n`;

describe("Bug 923 — strip 后的门禁按模块计数（不翻倍）", () => {
  it("strip --write 后：目录级分析只收一份（源 .ts 与产物 .js 是同一模块）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-923-"));
    dirs.push(dir);
    const src = join(dir, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(dir, "package.json"), `{ "name": "dup-pkg", "version": "0.0.0" }\n`, "utf-8");
    writeFileSync(join(src, "index.ts"), SRC, "utf-8");

    await migrateStrip([src], { write: true, draft: false });

    // 源与产物都在（strip 默认保留源）⇒ 门禁不得把两者算成两个模块
    //
    // **Bug 1053（主 agent 追认，2026-10-23）**：同 stem 冲突时**代表文件由
    // 「取源 `.ts`」改为「取产物 `.js`」—— 因为 `migrate strip --write` 之后
    // 源 `.ts` 是**退役后不再被编译的死源**，门禁必须查**发布出去的产物**
    // （否则发布的产物零覆盖 ⇒ 假绿，且与 `migrate verify` 给出相反结论）。
    // ⇒ 本用例的**计数不变式**（同一模块只分析一遍 ⇒ `toHaveLength(1)`）**不变**，
    // 只更新「被选中的那一份是哪个」。
    const collected = collectNudoFiles(dir);
    expect(collected.filter((f) => f.endsWith("index.ts"))).toHaveLength(0);
    expect(collected.filter((f) => f.endsWith("index.js"))).toHaveLength(1);
    expect(collected).toHaveLength(1);
  });

  it("check --json 的计数：默认路径与 --backup 路径相同（都等于模块数）", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-923a-"));
    const dirB = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-923b-"));
    dirs.push(dirA, dirB);
    for (const d of [dirA, dirB]) {
      mkdirSync(join(d, "src"), { recursive: true });
      writeFileSync(join(d, "package.json"), `{ "name": "dup-pkg", "version": "0.0.0" }\n`, "utf-8");
      writeFileSync(join(d, "src", "index.ts"), SRC, "utf-8");
    }
    await migrateStrip([join(dirA, "src")], { write: true, draft: false });
    await migrateStrip([join(dirB, "src")], { write: true, draft: false, backup: true });

    const count = (dir: string): { files: number; functions: number } => {
      const r = runCliTsx(["check", dir, "--json"], { cwd: dir });
      expect(r.status).toBeGreaterThanOrEqual(0);
      const data = JSON.parse(r.stdout) as {
        kind?: string;
        summary: { files?: number; functions: number };
        reports?: unknown[];
      };
      const files = data.kind === "multi" ? (data.summary.files ?? 0) : 1;
      return { files, functions: data.summary.functions };
    };

    const a = count(dirA);
    const b = count(dirB);
    // 改前：a.files = 2（index.ts + index.js 各一份），b.files = 1 ⇒ 两条路径不一致
    expect(a.files).toBe(1);
    expect(b.files).toBe(1);
    expect(a.functions).toBe(b.functions);
  }, 120_000);
});
