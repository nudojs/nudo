/**
 * BUG-015 —— `nudo migrate verify` 与 `nudo check` 用**不同的 `ignoreThrows`
 * 解析器** ⇒ 同一文件同一配置两个结论（verify 假失败，迁移门禁永远转不绿）。
 *
 * 根因：verify 走 service `checkConfig()` 的**严格** `Array.isArray` 变体
 * （裸字符串 `"TypeError"` 与 `["TypeError,RangeError"]` 元素内逗号都不认），
 * 而 `nudo check` 走 `configIgnoreThrows`（宽松：裸字符串 + 逗号切分）。
 *
 * 修复：verify 改用同一个宽松解析器。
 *
 * 反向闸：**没配** ignoreThrows 时 verify 仍判红（不得把闸门整体放松）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateVerify } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const BOOM = "export function boom(x) {\n  return x.toUpperCase();\n}\n";

function project(ignoreThrows?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-015-"));
  dirs.push(dir);
  const pkg: Record<string, unknown> = { name: "f2", version: "1.0.0", type: "module" };
  if (ignoreThrows !== undefined) pkg.nudo = { check: { ignoreThrows } };
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg), "utf-8");
  writeFileSync(join(dir, "boom.js"), BOOM, "utf-8");
  return dir;
}

describe("Bug 015: verify 与 check 必须共用 ignoreThrows 解析器", () => {
  it("裸字符串 \"TypeError\" ⇒ verify 判绿（与 check 同结论）", async () => {
    const dir = project("TypeError");
    const rows = await migrateVerify([join(dir, "boom.js")], { json: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nudoOk).toBe(true);
  });

  it("数组元素内含逗号 [\"TypeError,RangeError\"] ⇒ verify 判绿", async () => {
    const dir = project(["TypeError,RangeError"]);
    const rows = await migrateVerify([join(dir, "boom.js")], { json: true });
    expect(rows[0]!.nudoOk).toBe(true);
  });

  it("反向闸：没配 ignoreThrows ⇒ verify 仍判红", async () => {
    const dir = project();
    const rows = await migrateVerify([join(dir, "boom.js")], { json: true });
    expect(rows[0]!.nudoOk).toBe(false);
  });
});
