/**
 * Bug 974：多条 `--assume` **互相覆盖**（每条都重写 φ ⇒ 只有最后一条生效）。
 *
 * 旧行为：`--assume x>100 --assume y>200` ⇒ φ = `y>200` ⇒ 结果谓词
 * `(x + y) > 200`（x 的界丢失）。
 * 修复：多条假设**合取**（core 既有导出 `algebra.and`）⇒ `(x + y) > 300`。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAbsViewCaptured } from "./helpers/abs-view.ts";

const G_SRC = `export function g(x, y) {\n  return x + y;\n}\n`;

async function withTmp(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-c4-974-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Bug 974: 多条 --assume 必须合取（不是互相覆盖）", () => {
  it("x>100 且 y>200 ⇒ 谓词 (x + y) > 300（两条都在场）", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "g.js");
      writeFileSync(file, G_SRC, "utf-8");
      const r = await runAbsViewCaptured(file, { assume: ["x>100", "y>200"] });
      expect(r.stdout).toContain("assume: x > 100, y > 200");
      // 合取 ⇒ 两条界都进结果谓词
      expect(r.stdout).toContain("(x + y) > 300");
      // 旧行为：只剩最后一条 ⇒ (x + y) > 200
      expect(r.stdout).not.toContain("(x + y) > 200");
    });
  });

  it("顺序无关（y 在前也一样合取）", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "g.js");
      writeFileSync(file, G_SRC, "utf-8");
      const r = await runAbsViewCaptured(file, { assume: ["y>200", "x>100"] });
      expect(r.stdout).toContain("(x + y) > 300");
    });
  });
});
