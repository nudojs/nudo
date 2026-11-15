/**
 * Bug 651 — `nudo test` 的 synthetic 判据必须按 **case 来源**（`c.source`），
 * 不得按 **名字前缀**（`call@` / `entry@`）。
 *
 * 报告原文（`tmp/bugs/19-nudojs-test.md` §Bug 651）：synthetic 判定用
 * `name.startsWith("call@") || name.startsWith("entry@")` ⇒ 用户**手写**的
 * 声明式见证 `@nudo:case "call@L42" (2) => 5`（实得 4）被降级成合成 case ⇒
 * 失败的声明断言被**整条丢出断言面** ⇒ 报告面「0 failed」、**exit 0**，而
 * 诊断面同时报 `nudo:case-expected` error ⇒ 报告自相矛盾。
 *
 * 该根因**已修**（族 14/15 收口提交 `dde4b037`）：判据改成**来源**判据
 * `c.source !== "directive"`（CLI 面 `packages/nudojs/src/run-test.ts`，
 * 平行副本 `packages/service/src/test-report.ts` 同改）。
 * ⇒ 本文件是**反向守护钉**：钉住「已修」的行为，防止判据被改回**名字前缀**。
 *
 * 断言口径：只钉**语义** —— 声明式 case 出现在断言面（期望不符 ⇒ 计入失败
 * 且 exit ≠ 0；期望相符 ⇒ 计入通过）、与普通名字的见证**同构**；
 * **不钉汇总行的字面量**（汇总行会随断言分类演进而变 ⇒ 与同族其它片不打架）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/**
 * 声明式见证：名字落在合成 case 名字空间（`call@` / `entry@`），但它是
 * **写在源码里**的 `@nudo:case` 指令 ⇒ 已声明 ⇒ 必须进断言面。
 */
function declaredCase(name: string, expected: string): string {
  return `/** @nudo:case "${name}" (2) => ${expected} */\nexport function double(x) { return x * 2; }\n`;
}

async function withTmp(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b651-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Bug 651：声明式 @nudo:case 不得因名字前缀被丢出断言面", () => {
  it("call@ 前缀的声明式见证：期望不符 ⇒ 计入失败 + exit 1", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "callnamed.js");
      writeFileSync(file, declaredCase("call@L42", "5"), "utf-8");
      const r = runCli(["test", file], { cwd: dir });
      // 旧行为：被当成 synthetic ⇒ 无 [FAIL] 行、exit 0（报告自相矛盾）
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("[FAIL]");
      expect(r.stdout).toContain("call@L42");
    });
  }, 30000);

  it("entry@ 前缀的声明式见证：期望不符 ⇒ 计入失败 + exit 1", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "entrynamed.js");
      writeFileSync(file, declaredCase("entry@L42", "5"), "utf-8");
      const r = runCli(["test", file], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("[FAIL]");
      expect(r.stdout).toContain("entry@L42");
    });
  }, 30000);

  it("--freeze 写回形态的名字（call@<file>:<line>）：仍是声明式见证 ⇒ 计入失败 + exit 1", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "frozen.js");
      writeFileSync(file, declaredCase("call@frozen.js:1", "5"), "utf-8");
      const r = runCli(["test", file], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("[FAIL]");
      expect(r.stdout).toContain("call@frozen.js:1");
    });
  }, 30000);

  it("普通名字的声明式见证：与前缀变体同构（同样计入失败 + exit 1）", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "mycase.js");
      writeFileSync(file, declaredCase("myCase", "5"), "utf-8");
      const r = runCli(["test", file], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("[FAIL]");
      expect(r.stdout).toContain("myCase");
    });
  }, 30000);

  it("call@ 前缀的声明式见证：期望相符 ⇒ 计入通过、exit 0（不是 unchecked / synthetic）", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "callnamed-ok.js");
      writeFileSync(file, declaredCase("call@L42", "4"), "utf-8");
      const r = runCli(["test", file], { cwd: dir });
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain("[FAIL]");
      // 通过的行（不是 [unchecked] 行）⇒ 该 case 计入断言面且被判定通过
      expect(r.stdout).toContain("[ok]");
      expect(r.stdout).toContain("call@L42");
    });
  }, 30000);
});
