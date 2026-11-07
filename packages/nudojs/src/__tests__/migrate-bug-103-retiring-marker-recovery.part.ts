/**
 * BUG-103 —— 残留的 `migrate-retiring.json`（半完成标记）且已无 tsc/typescript
 * 可退役时 ⇒ 「nothing to retire」直接 exit 0，**半完成标记永不清理**
 * ⇒ `status` 永远报「partial migrate retire — re-run nudo migrate retire」
 * （指引指向的命令是 no-op）。
 *
 * 修复：`planRetirePackage` 的「无活可干」分支区分 in-progress 标记的存在——
 * 存在 ⇒ 走**恢复路径**（清 in-progress + 写已完成标记），而不是抛
 * `nothing to retire`。
 *
 * 反向闸：没有 in-progress 标记且无活可干 ⇒ 仍是 `nothing to retire`（Bug 567）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetire, migrateStatus } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 已无可退役项（门禁已装、无 typescript），但带着故障注入的半完成标记 */
function recoveringPkg(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-103-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "rec",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: { typecheck: "nudo check ." },
    }),
    "utf-8",
  );
  mkdirSync(join(dir, ".nudo"), { recursive: true });
  writeFileSync(
    join(dir, ".nudo", "migrate-retiring.json"),
    JSON.stringify({
      retiringAt: "2020-01-01T00:00:00.000Z",
      error: "simulated",
      note: "partial migrate retire",
    }),
    "utf-8",
  );
  return dir;
}

describe("Bug 103: 半完成标记必须能被重跑 retire 清掉", () => {
  it("status 先报 partial migrate retire（反向闸：前提成立）", () => {
    const dir = recoveringPkg();
    const blocks = migrateStatus(dir)[0]!.blockers;
    expect(blocks.some((b) => b.includes("partial migrate retire"))).toBe(true);
  });

  it("重跑 retire ⇒ 清 in-progress 标记 + 写已完成标记 + status 无 blocker", () => {
    const dir = recoveringPkg();
    const result = migrateRetire(dir, { workflows: false });
    expect(result.root).toBeTruthy();
    expect(existsSync(join(dir, ".nudo", "migrate-retiring.json"))).toBe(false);
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(true);
    const after = migrateStatus(dir)[0]!;
    expect(after.retiring).toBe(false);
    expect(after.blockers).toEqual([]);
  });

  it("反向闸：没有半完成标记且无活可干 ⇒ 仍是 nothing to retire", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-mig-103-plain-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "plain", version: "1.0.0", scripts: { test: "node -e 0" } }),
      "utf-8",
    );
    expect(() => migrateRetire(dir, { workflows: false })).toThrow(/nothing to retire/);
    expect(existsSync(join(dir, ".nudo"))).toBe(false);
  });
});
