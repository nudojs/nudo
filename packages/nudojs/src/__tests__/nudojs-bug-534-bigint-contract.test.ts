/**
 * Bug 534 —— `nudo contract` 遇 **bigint 字面量契约** 不得整条命令崩溃。
 *
 * 病灶：契约面把约束用 `JSON.parse(JSON.stringify(c))` 落盘 ⇒ JSON 无法表示
 * bigint ⇒ `JSON.stringify` 抛 `TypeError: Do not know how to serialize a
 * BigInt` ⇒ `nudo contract` 整条命令 exit 1（裸异常、无文件、无诊断码），
 * 而 `nudo check` / `health` / `test` 对**同一份文件**全绿。
 *
 * 本测试钉住产品面：同一份文件，`nudo contract` 与 `nudo check` 都必须
 * 正常出结果（不再裸异常崩溃）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli } from "./helpers/run-cli.ts";

const SRC_JS = `export function g(n) {
  return n;
}
`;

const BIGINT_NUDO_JS = `import { fn, lit } from "@nudojs/core";
export const g = fn({ n: lit(10n) }, lit(10n));
`;

describe("nudo contract — bigint 字面量契约不得崩溃（Bug 534）", () => {
  it("contract 正常出结果（改前：裸 Do not know how to serialize a BigInt，exit 1）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug534-"));
    try {
      const file = join(dir, "c.js");
      writeFileSync(file, SRC_JS, "utf-8");
      writeFileSync(join(dir, "c.nudo.js"), BIGINT_NUDO_JS, "utf-8");

      const r = runCli(["contract", file]);
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain("Do not know how to serialize a BigInt");
      expect(r.stdout).toContain("g");
      expect(r.stdout).toContain("lit(10)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("同一份文件：check 面与 contract 面都不崩（跨 verb 一致）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug534-"));
    try {
      const file = join(dir, "c.js");
      writeFileSync(file, SRC_JS, "utf-8");
      writeFileSync(join(dir, "c.nudo.js"), BIGINT_NUDO_JS, "utf-8");

      const check = runCli(["check", file]);
      expect(check.status).toBe(0);
      expect(check.stderr).not.toContain("BigInt");

      const contract = runCli(["contract", file]);
      expect(contract.status).toBe(0);
      expect(contract.stderr).not.toContain("BigInt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
