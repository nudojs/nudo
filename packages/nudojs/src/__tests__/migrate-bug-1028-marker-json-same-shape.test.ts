/**
 * Bug 1028 — `nudo migrate retire` 的**同一个键 `rewrittenWorkflows` 在两份产物里是两种类型**：
 * stdout 的 `--json` 报文是 `[{file,from,to}]`（对象数组），落盘的
 * `.nudo/migrate-retired.json` 是 `["<path>"]`（字符串数组）⇒ 同键异型（协议层非法值），
 * 且落盘的审计记录丢掉 CI 改写的前后内容。
 *
 * 期望：两份产物**逐元素深比较完全相等**，且都是带 `from`/`to` 的对象数组。
 * 反向闸：确实改写了 workflow（断言非永真）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetire } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function wfPkg(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m5-1028-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(dir, ".github", "workflows", "ci.yml"),
    [
      "name: CI",
      "on: [push]",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: npx tsc --noEmit",
      "",
    ].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "migfx",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: { typecheck: "tsc --noEmit" },
    }),
    "utf-8",
  );
  return dir;
}

function marker(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, ".nudo", "migrate-retired.json"), "utf-8")) as Record<
    string,
    unknown
  >;
}

describe("Bug 1028: rewrittenWorkflows 在 stdout 与落盘 marker 里必须同型同值", () => {
  it("库面：结果与 marker 的 rewrittenWorkflows 逐元素相等（对象数组，带 from/to）", () => {
    const dir = wfPkg();
    const result = migrateRetire(dir);
    const m = marker(dir);
    expect(result.rewrittenWorkflows.length).toBeGreaterThan(0);
    expect(m.rewrittenWorkflows).toEqual(result.rewrittenWorkflows);
    for (const rec of m.rewrittenWorkflows as Array<Record<string, unknown>>) {
      expect(typeof rec["file"]).toBe("string");
      expect(typeof rec["from"]).toBe("string");
      expect(typeof rec["to"]).toBe("string");
    }
  });

  it("CLI 面：--json 报文与落盘 marker 的同名键深比较相等", () => {
    const dir = wfPkg();
    const r = runCliTsx(["migrate", "retire", dir, "--json"]);
    expect(r.status).toBe(0);
    // Bug 675 收口：`migrate retire --json` 的顶层形状**恒为数组**（1 个包
    // 也是数组）⇒ 取第一条结果与 marker 比较。
    const reported = JSON.parse(r.stdout) as Array<{ rewrittenWorkflows: unknown }>;
    expect(Array.isArray(reported)).toBe(true);
    expect(reported).toHaveLength(1);
    const m = marker(dir);
    expect(m.rewrittenWorkflows).toEqual(reported[0]!.rewrittenWorkflows);
  });

  it("反向闸：确实改写了 workflow 行（断言非永真）", () => {
    const dir = wfPkg();
    migrateRetire(dir);
    const wf = readFileSync(join(dir, ".github", "workflows", "ci.yml"), "utf-8");
    expect(wf).toContain("npx nudojs check .");
    const m = marker(dir);
    expect((m.rewrittenWorkflows as unknown[]).length).toBe(1);
  });
});
