/**
 * Bug 973：`--assume` 的运算符被**一律按 `>` 构造** ⇒ 用户写 `x>=1`
 * 实际得到 `x>1` ⇒ 引擎里的谓词与用户写的不一致
 * （`x+1 > 1.9999999999999998` 而不是 `x+1 ≥ 2`）。
 *
 * 修复：谓词构造按运算符分派（core 既有导出 `geNum` / `gtNum`），
 * 回显行打印**实际构造出来的谓词**。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAbsViewCaptured } from "./helpers/abs-view.ts";

const F_SRC = `export function f(x) {\n  if (x > 0) {\n    return x + 1;\n  }\n  return x - 1;\n}\n`;

async function withTmp(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-c4-973-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Bug 973: --assume 的 >= 与 > 必须落到不同谓词", () => {
  it("`x>=1` ⇒ 谓词是 (x + 1) ≥ 2（不是 > 1.999…）", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "f.js");
      writeFileSync(file, F_SRC, "utf-8");
      const r = await runAbsViewCaptured(file, { assume: ["x>=1"] });
      expect(r.stdout).toContain("assume: x >= 1");
      expect(r.stdout).toContain("(x + 1) ≥ 2");
      expect(r.stdout).not.toContain("1.9999999999999998");
    });
  });

  it("`x>1` ⇒ 谓词是 (x + 1) > 1.999…（与 >= 不同）", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "f.js");
      writeFileSync(file, F_SRC, "utf-8");
      const r = await runAbsViewCaptured(file, { assume: ["x>1"] });
      expect(r.stdout).toContain("assume: x > 1");
      expect(r.stdout).toContain("(x + 1) > 1.9999999999999998");
      expect(r.stdout).not.toContain("(x + 1) ≥ 2");
    });
  });
});
