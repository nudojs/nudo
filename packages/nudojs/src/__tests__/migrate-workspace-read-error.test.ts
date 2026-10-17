/**
 * migrate 的 pnpm-workspace.yaml 读取失败分类：
 * ENOENT = 无 workspace 文件（单包仓库，合法 miss → []）；
 * EACCES/EIO 等读失败必须上抛——静默 [] 会漏采 monorepo 包根，
 * status/strip/retire 范围悄悄收窄。进程内 vi.mock 条件注入
 * （root 下 chmod 000 不可靠，mock fs 面向 errno 精确分流）。
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const deny = vi.hoisted(() => ({ path: "" }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: ((path: unknown, options: unknown) => {
      if (deny.path && String(path) === deny.path) {
        const err = new Error("EACCES: permission denied, read") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
      return actual.readFileSync(path as Parameters<typeof actual.readFileSync>[0], options as Parameters<typeof actual.readFileSync>[1]);
    }) as typeof actual.readFileSync,
  };
});

import { migrateStatus } from "../migrate.ts";

describe("migrate pnpm-workspace.yaml 读失败分类", () => {
  it("EACCES 读失败上抛（不得静默 [] 漏采包根）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-ws-eacces-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "root", private: true }),
        "utf-8",
      );
      writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf-8");
      deny.path = join(dir, "pnpm-workspace.yaml");
      expect(() => migrateStatus(dir)).toThrow(/EACCES/);
    } finally {
      deny.path = "";
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("对照：无 workspace 文件（真 miss ENOENT）→ status 正常，单包根在列", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-ws-miss-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "solo", private: true }),
        "utf-8",
      );
      deny.path = "";
      const rows = migrateStatus(dir);
      expect(rows.length).toBe(1);
      expect(rows[0]!.retired).toBe(false);
    } finally {
      deny.path = "";
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
