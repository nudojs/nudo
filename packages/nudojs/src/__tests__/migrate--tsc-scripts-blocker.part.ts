/**
 * Bug 577 — `nudo migrate status` 的「tsc still in scripts」阻塞被 `tsFiles > 0` 包住：
 * 有 tsc 脚本、**0 个 .ts** 的包（恰恰是最该退役的场景）blockers 为空。
 *
 * 期望：tsc 脚本阻塞与 .ts 数量无关（tscScripts.length > 0 即阻塞）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateStatus, formatStatusTable } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkg(name: string, scripts: Record<string, string>, withTs: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m2-577-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", scripts }),
    "utf-8",
  );
  if (withTs) writeFileSync(join(dir, "a.ts"), "export const x = 1;\n", "utf-8");
  return dir;
}

describe("Bug 577: tsc 脚本阻塞不依赖 tsFiles > 0", () => {
  it("0 个 .ts + tsc 脚本 ⇒ 必须报「tsc still in scripts」", () => {
    const dir = pkg("r16-lc-m2", { typecheck: "tsc --noEmit", build: "tsc -p ." }, false);
    const rows = migrateStatus(dir);
    expect(rows[0]!.tsFiles).toBe(0);
    expect(rows[0]!.tscScripts).toEqual(["typecheck", "build"]);
    expect(rows[0]!.blockers).toContain("tsc still in scripts");
  });

  it("文本面同样出现该阻塞", () => {
    const dir = pkg("r16-lc-m2-text", { typecheck: "tsc --noEmit" }, false);
    const text = formatStatusTable(migrateStatus(dir));
    expect(text).toContain("blockers: tsc still in scripts");
  });

  it("有 .ts + tsc 脚本 ⇒ 仍然报（口径不回退）", () => {
    const dir = pkg("with-ts", { typecheck: "tsc --noEmit" }, true);
    expect(migrateStatus(dir)[0]!.blockers).toContain("tsc still in scripts");
  });

  it("反向闸：没有 tsc 脚本 ⇒ 不得报该阻塞", () => {
    const dir = pkg("no-tsc", { build: "node build.js" }, true);
    expect(migrateStatus(dir)[0]!.blockers).not.toContain("tsc still in scripts");
  });
});
