/**
 * BUG-118 —— `nudo migrate retire --all` 与显式多目标列表对**同一批坏包**给出
 * **不同的失败清单**；`--all` 的 `--json` 失败信封**缺 `failedTargets`**。
 *
 * 根因：`migrateRetireAll` 在第一个 `package.json` 解析失败的包上**立刻 throw**
 * （fail-fast，裸 `Error`，不带 `retireFailures`）⇒ 其余坏包完全消失，且命令层
 * 的 `failedTargets` 永不装配；而显式多目标入口是**收集式**（报全 + 带明细）。
 *
 * 修复：`--all` 改为收集式，统一走 `retireBatchError`（带 `retireFailures`）。
 *
 * 反向闸：合法 workspace 的 `--all` 照常退役（不得因为收集式而漏报成功项）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetireAll } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Failures = Array<{ target: string; message: string }>;

function batch(): { root: string; a: string; b: string; c: string } {
  const root = mkdtempSync(join(tmpdir(), "nudo-mig-118-"));
  dirs.push(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "root", private: true, workspaces: ["pkgA", "pkgB", "pkgC"] }),
    "utf-8",
  );
  const a = join(root, "pkgA");
  const b = join(root, "pkgB");
  const c = join(root, "pkgC");
  for (const d of [a, b, c]) mkdirSync(d, { recursive: true });
  writeFileSync(
    join(a, "package.json"),
    JSON.stringify({
      name: "pkgA",
      devDependencies: { typescript: "^5.4.0" },
      scripts: { typecheck: "tsc --noEmit" },
    }),
    "utf-8",
  );
  writeFileSync(join(b, "package.json"), '{"name":"pkgB", broken json}', "utf-8");
  writeFileSync(join(c, "package.json"), '{"name":"pkgC", broken json}', "utf-8");
  return { root, a, b, c };
}

describe("Bug 118: --all 必须一次报全坏包，且 --json 信封带 failedTargets", () => {
  it("库面：一次报全两个坏包（不再 fail-fast 只报第一个）", () => {
    const { root, b, c } = batch();
    let failures: Failures | undefined;
    try {
      migrateRetireAll(root, { workflows: false });
    } catch (err) {
      failures = (err as { retireFailures?: Failures }).retireFailures;
    }
    expect(failures, "必须抛带 retireFailures 的批次错误").toBeDefined();
    expect(failures!.map((f) => f.target).sort()).toEqual([b, c].sort());
  });

  it("原子性不变：整批零写盘（pkgA 未被改动）", () => {
    const { root, a } = batch();
    expect(() => migrateRetireAll(root, { workflows: false })).toThrow();
    expect(readFileSync(join(a, "package.json"), "utf-8")).toContain('"tsc --noEmit"');
  });

  it("CLI 面：--all --json 的信封带 failedTargets（与显式入口同形）", () => {
    const { root, b, c } = batch();
    const all = runCliTsx(["migrate", "retire", root, "--all", "--json"]);
    expect(all.status).toBe(1);
    // BUG-017：`--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(all.stdout) as Array<{
      ok: boolean;
      failedTargets?: Failures;
    }>;
    const parsed = __env[0]!;
    expect(parsed.ok).toBe(false);
    expect(parsed.failedTargets?.map((f) => f.target).sort()).toEqual([b, c].sort());
  });

  it("反向闸：合法 workspace 的 --all 照常退役全部包", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-mig-118-ok-"));
    dirs.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["pkgA", "pkgB"] }),
      "utf-8",
    );
    const dirsOut: string[] = [];
    for (const name of ["pkgA", "pkgB"]) {
      const d = join(root, name);
      mkdirSync(d, { recursive: true });
      dirsOut.push(d);
      writeFileSync(
        join(d, "package.json"),
        JSON.stringify({
          name,
          devDependencies: { typescript: "^5.4.0" },
          scripts: { typecheck: "tsc --noEmit" },
        }),
        "utf-8",
      );
    }
    const results = migrateRetireAll(root, { workflows: false });
    expect(results).toHaveLength(2);
    for (const d of dirsOut) {
      expect(
        (JSON.parse(readFileSync(join(d, "package.json"), "utf-8")) as {
          devDependencies: Record<string, string>;
        }).devDependencies["typescript"],
      ).toBeUndefined();
    }
  });
});
