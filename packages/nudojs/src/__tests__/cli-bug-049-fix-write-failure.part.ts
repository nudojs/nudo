/**
 * BUG-049 —— `nudo check --fix --write` 写盘失败抛**裸 Node 异常**（EACCES）
 * 且**不再处理其余文件**（整次运行中断）。
 *
 * 现在与读路径同口径：`error: check --fix cannot write <path>: <原因>`
 * + 计入残余 error + 继续处理其余目标。
 */
import { describe, it, expect } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

/** 未约束 entry ⇒ 可修（写侧车） */
const HELPER = `export function staticName(node) {
  return node.type;
}
`;

/** root 对 chmod 555 免疫（写入仍成功）⇒ 该用例在 root 下无意义 */
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

describe.skipIf(isRoot)("BUG-049 — --fix --write 的写失败不中断整次运行", () => {
  it("不可写目录 ⇒ 有措辞的 error + 其余目标仍被处理", () => {
    const cwd = mkdtempSync(join(tmpdir(), "nudo-bug049-"));
    const roDir = join(cwd, "ro");
    try {
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "b49", private: true, type: "module" }),
        "utf-8",
      );
      mkdirSync(roDir);
      writeFileSync(join(roDir, "helper.js"), HELPER, "utf-8");
      writeFileSync(join(cwd, "second.js"), HELPER, "utf-8");
      chmodSync(roDir, 0o555);

      const r = runCliTsx(
        ["check", join("ro", "helper.js"), "second.js", "--fix", "--write"],
        { cwd },
      );

      // 有 nudo 的措辞（不是裸 errno：旧实现 stdout/stderr 里只有 EACCES 原文）
      expect(r.stderr).toContain("error: check --fix cannot write");
      expect(r.stderr).toContain("EACCES");
      // 其余目标仍被处理：second.nudo.js 落盘
      expect(r.stdout).toContain("second.nudo.js");
      // 写失败计入残余 error（门禁红）
      expect(r.stdout).toContain("residual error(s) remain");
      expect(r.status).toBe(1);
    } finally {
      chmodSync(roDir, 0o755);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
