/**
 * Bug 573 — `migrate status` 根行的 `tsFiles` 把**所有嵌套 workspace 包**的 .ts
 * 重复计入（listFiles 是目录递归，不按包边界裁剪）⇒ 根行 = 全仓库面，
 * 且与各包行重复计数（审计面「表面积」数字错）。
 *
 * 期望：status 按包分行 ⇒ 每行只统计**该包自己**的 .ts/.tsx。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateStatus } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m2-573-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "migws-root", version: "1.0.0", private: true }),
    "utf-8",
  );
  writeFileSync(join(dir, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n', "utf-8");
  for (const name of ["hasTsc", "peerOnly"]) {
    const p = join(dir, "packages", name);
    mkdirSync(join(p, "src"), { recursive: true });
    writeFileSync(
      join(p, "package.json"),
      JSON.stringify({ name, version: "1.0.0" }),
      "utf-8",
    );
    writeFileSync(join(p, "src", "x.ts"), "export const x = 1;\n", "utf-8");
  }
  return dir;
}

describe("Bug 573: migrate status 的 tsFiles 按 workspace 包边界统计", () => {
  it("根包自己 0 个 .ts ⇒ 根行 tsFiles 为 0（不重复计入子包）", () => {
    const dir = workspace();
    const rows = migrateStatus(dir);
    const base = dir.split("/").pop()!;
    const root = rows.find((r) => r.root.endsWith(base))!;
    expect(root).toBeDefined();
    expect(root.tsFiles).toBe(0);
    // 子包各自 1 个 .ts（计数不被吞掉）
    const subs = rows.filter((r) => r.root !== root.root);
    expect(subs).toHaveLength(2);
    for (const s of subs) expect(s.tsFiles).toBe(1);
  });

  it("反向闸：根包自己有 .ts 时，根行仍要数到自己的文件", () => {
    const dir = workspace();
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "root.ts"), "export const r = 1;\n", "utf-8");
    const rows = migrateStatus(dir);
    const base = dir.split("/").pop()!;
    const root = rows.find((r) => r.root.endsWith(base))!;
    expect(root.tsFiles).toBe(1);
  });

  it("子包的 .tsx 也只算在子包行", () => {
    const dir = workspace();
    writeFileSync(
      join(dir, "packages", "hasTsc", "src", "c.tsx"),
      "export const C = () => null;\n",
      "utf-8",
    );
    const rows = migrateStatus(dir);
    const base = dir.split("/").pop()!;
    const root = rows.find((r) => r.root.endsWith(base))!;
    expect(root.tsxFiles).toBe(0);
    const sub = rows.find((r) => r.root.includes("hasTsc"))!;
    expect(sub.tsxFiles).toBe(1);
  });
});
