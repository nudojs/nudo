/**
 * Bug 1143 —— `nudo:migrate-strip-failed` 必须走**稳定诊断码注册表**
 * （`@nudojs/core/internal` 的 `DIAG`），不得在 CLI 层直写字面量。
 *
 * 旧行为：`packages/nudojs/src/commands/migrate.ts` 的 `--json` 信封里直接写
 * `code: "nudo:migrate-strip-failed"` 字面量 ⇒ 绕过 `DIAG` 注册表 ⇒
 * - 码的**拼写**在生产面有两处真理源（注册表外的字面量 + 术语表）；
 * - 术语表反向对账（website docs-coverage rule 19）只能靠「src 字面量扫描」
 *   兜底，一旦 CLI 层改写法（变量 / 拼接）该码就会变成**永久幻影**
 *   （文档里有、实现里扫不到 ⇒ rule 19 误报 phantom）。
 *
 * 新行为：码进 `DIAG` 注册表（键 `migrateStripFailed`），CLI 层引用常量。
 *
 * 断言口径：
 * - 产出的 `pathErrors[].code` **等于注册表常量**（不是另写的字面量）；
 * - 该码**在注册表里存在**（`Object.values(DIAG)` 含它）；
 * - 生产 src 里**不再残留**该码的裸字面量赋值（`code: "nudo:…"` 形态）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { DIAG } from "@nudojs/core/internal";
import { runCliTsx, repoRoot } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GOOD = `export function ok(a: number): number {\n  return a + 1;\n}\n`;
const BAD = `export function oops(a: number): number {\n  return a +;\n}\n`;

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1143-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

type StripEnvelope = {
  ok?: boolean;
  pathErrors?: Array<{ path: string; code: string; message: string }>;
};

describe("Bug 1143 —— migrate strip 的失败码走 DIAG 注册表", () => {
  it("注册表里存在该码（键名 migrateStripFailed）", () => {
    expect(DIAG.migrateStripFailed).toBe("nudo:migrate-strip-failed");
    expect(Object.values(DIAG)).toContain("nudo:migrate-strip-failed");
  });

  it("产出的 pathErrors[].code 等于注册表常量（不是另写的字面量）", () => {
    const dir = dirWith({ "a-good.ts": GOOD, "z-bad.ts": BAD });
    const r = runCliTsx(["migrate", "strip", "--json", "."], { cwd: dir });
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as StripEnvelope;
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
    // 非空字符串（防「两边都是 undefined ⇒ 断言空过」）
    expect(typeof parsed.pathErrors![0]!.code).toBe("string");
    expect(parsed.pathErrors![0]!.code).toBe(DIAG.migrateStripFailed);
    expect(parsed.pathErrors![0]!.code).toBe("nudo:migrate-strip-failed");
  });

  it("生产 src 不再残留该码的裸字面量赋值（`code: \"nudo:…\"` 形态）", () => {
    const src = readFileSync(
      join(repoRoot, "packages/nudojs/src/commands/migrate.ts"),
      "utf-8",
    );
    expect(src).not.toMatch(/code:\s*"nudo:migrate-strip-failed"/);
    // 引用注册表常量
    expect(src).toContain("DIAG.migrateStripFailed");
  });
});
