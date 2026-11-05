/**
 * BUG-061 —— `nudo migrate verify` 对**模块级求值失败**放绿（`nudo check` 判红
 * `nudo:internal`）⇒ 迁移闸门假绿。
 *
 * 根因：`migrateVerify` 调 `checkSource` 时**没有装求值回落 collector**
 * （分析器通道装过一次又在自己的收尾处摘掉）⇒ 引擎 internal 回落被静默吞掉
 * ⇒ 模块的全部导出丢失、零诊断、`nudoOk: true`。而 `nudo check` 同路径装了
 * collector ⇒ error 级 `nudo:internal` ⇒ exit 1。
 *
 * 期望：verify 与 check **同结论**（这正是迁移闸门的语义：「任一文件
 * `nudo check` 不 ok ⇒ exit 1」）。
 *
 * 反向闸：模块级求值正常的文件仍是 OK（不得把闸门全打红）。
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

function dirWith(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-061-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "b061", version: "1.0.0", type: "module" }),
    "utf-8",
  );
  writeFileSync(join(dir, "boom.js"), source, "utf-8");
  return dir;
}

describe("Bug 061: verify 必须对模块级求值失败 fail-closed（与 check 同结论）", () => {
  it("模块顶层抛（undefined is not a function）⇒ nudoOk: false", async () => {
    const dir = dirWith(`export const boom = undefined();\n\nexport function add(a, b) {\n  return a + b;\n}\n`);
    const rows = await migrateVerify([join(dir, "boom.js")], { json: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nudoOk).toBe(false);
  });

  it("同目录的干净文件仍是 OK（反向闸：不得整批打红）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-mig-061-ok-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "b061ok", version: "1.0.0", type: "module" }),
      "utf-8",
    );
    writeFileSync(join(dir, "ok.js"), 'export function pick() {\n  return "s";\n}\n', "utf-8");
    const rows = await migrateVerify([join(dir, "ok.js")], { json: true });
    expect(rows[0]!.nudoOk).toBe(true);
  });
});
