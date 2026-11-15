/**
 * Bug 595 — `nudo migrate retire <a> <b>` **只退役 `a`**，`b` 被**静默跳过**且 exit 0。
 *
 * 库面修法：新增 `migrateRetireMany(paths)` —— **全退役或全报错**（原子）。
 * CLI 面（`packages/nudojs/src/commands/migrate.ts`，非本分片所有）仍需接线：
 * `targets[0]!` ⇒ `targets`（见交付报告）。
 * 反向闸：单目标退役照常工作（断言非永真）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetire, migrateRetireMany } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tsPkg(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `nudo-m5-595-${name}-`));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      dependencies: { typescript: "^5.0.0" },
    }),
    "utf-8",
  );
  return dir;
}

function plainPkg(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m5-595-plain-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "plainjs", version: "1.0.0", scripts: { test: "node -e 0" } }),
    "utf-8",
  );
  return dir;
}

describe("Bug 595: 多目标退役必须全退役或全报错", () => {
  it("两个目标都被退役（不得静默只处理第一个）", () => {
    const a = tsPkg("pkg-a");
    const b = tsPkg("pkg-b");
    const results = migrateRetireMany([a, b], { workflows: false });
    expect(results).toHaveLength(2);
    for (const dir of [a, b]) {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
        dependencies: Record<string, string>;
      };
      expect(pkg.dependencies["typescript"]).toBeUndefined();
      expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(true);
    }
  });

  it("其中一个目标无可退役 ⇒ 报错，且整批零写盘（原子）", () => {
    const a = tsPkg("pkg-a");
    const plain = plainPkg();
    const before = readFileSync(join(a, "package.json"), "utf-8");
    expect(() => migrateRetireMany([a, plain], { workflows: false })).toThrow(/nothing to retire/);
    expect(readFileSync(join(a, "package.json"), "utf-8")).toBe(before);
    expect(existsSync(join(a, ".nudo", "migrate-retired.json"))).toBe(false);
  });

  it("反向闸：单目标退役照常工作", () => {
    const a = tsPkg("pkg-a");
    const result = migrateRetire(a, { workflows: false });
    expect(result.removedDeps).toContain("dependencies");
    expect(existsSync(join(a, ".nudo", "migrate-retired.json"))).toBe(true);
  });
});
