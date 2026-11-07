/**
 * Bug 578 — `nudo migrate retire` 注入的 `check:nudo` **从未落盘**，
 * 但 CLI 输出与审计记录**都谎报「已改写」**。
 *
 * 根因：`pkg.scripts ?? {}` 产生**局部新对象**，注入写进局部副本，`pkg.scripts` 从未被赋值。
 * 期望：注入真的落进 package.json；报告与审计记录只记真正落盘的改动。
 * 反向闸：有 scripts 键的包注入照常落盘（断言非永真）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetire } from "../migrate.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function noScriptsPkg(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-m5-578-"));
  dirs.push(dir);
  // 没有 scripts 键
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "f1-noscripts", "version": "1.0.0", "devDependencies": { "typescript": "^5.0.0" } }\n',
    "utf-8",
  );
  return dir;
}

describe("Bug 578: 注入的 check:nudo 必须真的落盘", () => {
  it("库面：package.json 出现 scripts.check:nudo（报告与落盘一致）", () => {
    const dir = noScriptsPkg();
    const result = migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts!["check:nudo"]).toBe("nudo check .");
    // 报告里说的就是落盘的
    expect(result.rewrittenScripts.some((s) => s.name === "check:nudo")).toBe(true);
  });

  it("CLI 面：--json 报文里报改了，落盘也得有", () => {
    const dir = noScriptsPkg();
    const r = runCliTsx(["migrate", "retire", dir, "--json"]);
    expect(r.status).toBe(0);
    // Bug 675 收口：`migrate retire --json` 的顶层形状**恒为数组**（1 个包
    // 也是数组）⇒ 取第一条结果。
    const reported = JSON.parse(r.stdout) as Array<{
      rewrittenScripts: Array<{ name: string }>;
    }>;
    expect(Array.isArray(reported)).toBe(true);
    expect(reported[0]!.rewrittenScripts.some((s) => s.name === "check:nudo")).toBe(true);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["check:nudo"]).toBe("nudo check .");
  });

  it("反向闸：已有 scripts 键的包，注入也落进**既有** scripts 对象（不丢原有脚本）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-m5-578-ok-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "withscripts",
        scripts: { test: "node -e 0" },
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf-8",
    );
    migrateRetire(dir, { workflows: false });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:nudo"]).toBe("nudo check .");
    expect(pkg.scripts["test"]).toBe("node -e 0");
  });
});
