/**
 * Bug 616 — `nudo export --out` **写失败**时：产物已经部分落盘，但 stdout
 * 一行「wrote」都没有 ⇒ 用户以为「什么都没写」，实际磁盘上多了半个产物集；
 * 错误文案也不带**是哪个文件**失败。
 *
 * 钉：写盘失败 ⇒ stdout 如实回放**已落盘清单**（每行 `wrote <path>`），
 * stderr 点名失败的那个文件。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

describe("nudo export --out · Bug 616 · 写失败回放已落盘清单", () => {
  it("写失败 ⇒ stdout 回放已落盘产物 + stderr 点名失败文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-616-"));
    const file = join(dir, "lib.js");
    writeFileSync(file, "export function scale(x) {\n  return x + 1;\n}\n", "utf-8");
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });
    // 让 dts 产物的目标路径是一个目录 ⇒ 写到它时失败（前面几份已落盘）
    mkdirSync(join(out, "lib.d.ts"), { recursive: true });

    const r = runCli(["export", file, "--format", "all", "--out", out]);
    expect(r.status).toBe(1);
    // 已落盘清单如实回放（stdout）
    const wrote = r.stdout.split("\n").filter((l) => l.startsWith("wrote "));
    expect(wrote.length).toBeGreaterThan(0);
    expect(r.stdout).toContain("lib.nudo.schema.zod.ts");
    expect(r.stdout).toContain("lib.nudo.guard.ts");
    // 错误点名失败的那个文件（不是只说目录）
    expect(r.stderr).toContain("export --out write failed");
    expect(r.stderr).toContain("lib.d.ts");
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）
});
