/**
 * Bug 1050 — `nudo export` 的 stdout `dropped preds` 台账恒称「not projected into
 * zod」⇒ `--format standard`（**根本没产 zod 产物**）也这么写 ⇒ 误导诊断
 * （标题与内容张冠李戴）。
 *
 * 机制：台账**标题**取 `effectiveDialect`（`schemaDialectOf` 不看 `_format` ⇒
 * 恒 `"zod"`），而台账**内容**来自 **standard** 面的 dropped 记录 ⇒ 不同源。
 *
 * 修法（stdout 面，S5）：台账标题按**来源面**取名（standard）——zod 模块自己
 * 的台账（模块内注释）仍由 service 侧按 zod 口径出，两处标题不再同名重复。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 夹具：返回 bigint 的函数（lit bigint 不可投影 ⇒ 有 dropped 记录）。 */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-1050-"));
  dirs.push(dir);
  const file = join(dir, "bigint.js");
  writeFileSync(file, "export function retBigInt() { return 1n; }\n", "utf-8");
  return file;
}

/** 出现次数。 */
function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

describe("Bug 1050 — dropped preds 台账标题与内容同源", () => {
  it("--format standard：台账标题不再宣称 zod（没有 zod 产物）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("// dropped preds (not projected into standard):");
    expect(r.stdout).not.toContain("not projected into zod");
    // 内容仍在（有损投影的披露通道不能丢）
    expect(r.stdout).toContain("retBigInt");
    expect(r.stdout).toContain("not projected");
  }, 30000);

  it("--format all：zod 台账与 standard 台账各一次（标题不再同名重复）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "all"]);
    expect(r.status).toBe(0);
    expect(count(r.stdout, /not projected into zod/g)).toBe(1);
    expect(count(r.stdout, /not projected into standard/g)).toBe(1);
  }, 30000);

  it("--format dts：无台账（dts 面不携带 dropped 记录）", () => {
    const file = fixture();
    const r = runCli(["export", file, "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("dropped preds");
  }, 30000);
});
