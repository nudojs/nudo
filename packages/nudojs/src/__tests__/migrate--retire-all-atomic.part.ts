/**
 * Bug 1006 — `nudo migrate retire --all` **包间非原子**：第 N 个包失败时前 N−1 个包
 * 已落盘退役，而错误消息既不点名已提交的包、也不留任何「本批被中断」的痕迹。
 *
 * 期望：**全批原子** —— 任一包失败 ⇒ 整批零写盘（前 N−1 个包也不落盘），
 *       错误消息点名本批涉及的包。
 * 反向闸：全批成功时每个包都退役（断言非永真）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetireAll } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) {
    try {
      chmodSync(join(d, "packages", "b"), 0o755);
    } catch {
      /* 目录可能没建 */
    }
    rmSync(d, { recursive: true, force: true });
  }
});

function batchRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-m5-1006-"));
  dirs.push(root);
  mkdirSync(join(root, "packages", "a"), { recursive: true });
  mkdirSync(join(root, "packages", "b"), { recursive: true });
  mkdirSync(join(root, "packages", "c"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "root", version: "1.0.0", private: true, devDependencies: {} }),
    "utf-8",
  );
  writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n', "utf-8");
  for (const p of ["a", "b", "c"]) {
    writeFileSync(
      join(root, "packages", p, "package.json"),
      JSON.stringify({
        name: `pkg-${p}`,
        version: "1.0.0",
        devDependencies: { typescript: "^5.0.0" },
        scripts: { typecheck: "npx tsc --noEmit" },
      }),
      "utf-8",
    );
  }
  return root;
}

describe("Bug 1006: retire --all 必须包间原子", () => {
  it("第 2 个包不可写 ⇒ 整批零写盘（前面的包也不落盘）", () => {
    const root = batchRepo();
    chmodSync(join(root, "packages", "b"), 0o555);
    try {
      expect(() => migrateRetireAll(root, { workflows: false })).toThrow();
    } finally {
      chmodSync(join(root, "packages", "b"), 0o755);
    }
    for (const p of ["a", "b", "c"]) {
      const pkg = JSON.parse(
        readFileSync(join(root, "packages", p, "package.json"), "utf-8"),
      ) as { devDependencies: Record<string, string>; scripts: Record<string, string> };
      // 前序包不得已被退役
      expect(pkg.devDependencies["typescript"]).toBe("^5.0.0");
      expect(pkg.scripts["typecheck"]).toBe("npx tsc --noEmit");
      expect(existsSync(join(root, "packages", p, ".nudo", "migrate-retired.json"))).toBe(false);
    }
  });

  it("CLI 面：失败时点名本批涉及的包", () => {
    const root = batchRepo();
    chmodSync(join(root, "packages", "b"), 0o555);
    const r = runCliTsx(["migrate", "retire", root, "--all"]);
    chmodSync(join(root, "packages", "b"), 0o755);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("packages/a");
    expect(r.stderr).toContain("packages/b");
    const pkgA = JSON.parse(
      readFileSync(join(root, "packages", "a", "package.json"), "utf-8"),
    ) as { devDependencies: Record<string, string> };
    expect(pkgA.devDependencies["typescript"]).toBe("^5.0.0");
  });

  it("反向闸：全批成功时每个包都退役", () => {
    const root = batchRepo();
    const results = migrateRetireAll(root, { workflows: false });
    expect(results).toHaveLength(3);
    for (const p of ["a", "b", "c"]) {
      const pkg = JSON.parse(
        readFileSync(join(root, "packages", p, "package.json"), "utf-8"),
      ) as { devDependencies: Record<string, string> };
      expect(pkg.devDependencies["typescript"]).toBeUndefined();
      expect(existsSync(join(root, "packages", p, ".nudo", "migrate-retired.json"))).toBe(true);
    }
  });
});
