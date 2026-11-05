/**
 * Bug 559 —— `nudo contract` 打印面用**契约里的参数**冒充**函数的形参表**
 * ⇒ 与 `nudo check` 的签名面给出两套形参（跨 verb 自相矛盾）。
 *
 * 本测试钉住产品面：同一份文件，`nudo contract` 印的形参表必须与
 * `nudo check` 的签名面一致（同一来源 = 声明形参表）；契约里绑不上的参数
 * 另列一栏并显式标注（不顶替形参名）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli } from "./helpers/run-cli.ts";

const SRC_JS = `export function scale(x) {
  return x * 2;
}
`;

const MISMATCH_NUDO_JS = `import { fn, number } from "@nudojs/core";
export const scale = fn({ zzz: number().gt(0) }, number());
`;

describe("nudo contract — 打印面以声明形参表为骨架（Bug 559）", () => {
  it("contract 印的形参 = 声明形参；契约里绑不上的参数另列并标注", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug559-"));
    try {
      const file = join(dir, "lib.js");
      writeFileSync(file, SRC_JS, "utf-8");
      writeFileSync(join(dir, "lib.nudo.js"), MISMATCH_NUDO_JS, "utf-8");

      const contract = runCli(["contract", file]);
      expect(contract.status).toBe(0);
      expect(contract.stdout).toContain("(x: any)");
      // 契约参数不顶替形参名
      expect(contract.stdout).not.toContain("(zzz:");
      // 但必须显式出现（另列一栏 + 标注）
      expect(contract.stdout).toContain("zzz: number().gt(0)");
      expect(contract.stdout).toContain("(not a formal parameter)");

      const check = runCli(["check", file]);
      expect(check.stdout).toContain("scale(x: any)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
