/**
 * Bug 624 — `nudo export --out` 写失败的 `fix:` 提示硬编码成 **不存在的**
 * `check --out` ⇒ 用户照做只会再吃一个 `unknown option '--out'`。
 *
 * 钉：写失败的提示指向**本命令**且可执行（不含 `check --out`）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

describe("nudo export --out · Bug 624 · 写失败提示可执行", () => {
  it("--out 指向已有文件 ⇒ 提示不再指向不存在的 check --out", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-624-"));
    const file = join(dir, "lib.js");
    writeFileSync(file, "export function scale(x) {\n  return x + 1;\n}\n", "utf-8");
    const notDir = join(dir, "notadir");
    writeFileSync(notDir, "not a directory\n", "utf-8");

    const r = runCli(["export", file, "--format", "dts", "--out", notDir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("export --out mkdir failed");
    expect(r.stderr).toContain("fix:");
    // 提示里不得出现不存在的 `check --out`
    expect(r.stderr).not.toContain("check --out");
    // 提示指向本命令的 --out（可执行）
    expect(r.stderr).toContain("export --out");
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

  it("目标路径是目录 ⇒ 写失败提示点名该文件且指向本命令（EISDIR 走写失败通道）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-624b-"));
    const file = join(dir, "lib.js");
    writeFileSync(file, "export function scale(x) {\n  return x + 1;\n}\n", "utf-8");
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });
    // 目标路径是目录 ⇒ readFileSync EISDIR。目录不可能被 writeFileSync
    // 覆盖（无绕过「拒绝覆盖」守卫的风险）⇒ 照常走写入，由**写失败通道**
    // 点名该文件并给可执行 fix:（与 Bug 616 的回放语义同一通道）。
    // （EACCES/EIO 等真读不出 ⇒ refuse 分支；refuse 文案由 Bug 617
    // 「可读手写文件」钉住。）
    mkdirSync(join(out, "lib.d.ts"), { recursive: true });

    const r = runCli(["export", file, "--format", "dts", "--out", out]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("export --out write failed");
    expect(r.stderr).toContain("lib.d.ts");
    expect(r.stderr).toContain("fix:");
    expect(r.stderr).not.toContain("check --out");
    // 提示指向本命令的 --out（可执行）
    expect(r.stderr).toContain("export --out");
  }, 60000); // 1 个 CLI 子进程
});
