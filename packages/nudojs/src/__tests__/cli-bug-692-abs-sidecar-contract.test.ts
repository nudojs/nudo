/**
 * Bug 692：`nudo check --abs` **完全不看契约**（侧车 `*.nudo.js` /
 * 源码 `@nudo:contract`）⇒ 同一函数在两个面上给出**互斥**的类型：
 *
 *   check          → g(x: number) => string
 *   check --abs    → g(any) => any            （旧行为）
 *
 * 修复：`--abs` 面与签名表**同源** —— 有效契约约束的形参真的进求值
 * （core `effectiveInterface` + `constraintToEntryAbs`，与 `checkSource`
 * 的侧车施加点同口径）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";
import { runAbsViewCaptured } from "./helpers/abs-view.ts";

const LIB_JS = `export function g(x) { return x.toFixed(2); }\n`;
const LIB_NUDO = `import { fn, number, string } from "@nudojs/core";\nexport const g = fn({ x: number() }, string());\n`;
const PLUS_JS = `export function f(x) { return x + 1; }\n`;
const PLUS_NUDO = `import { fn, number } from "@nudojs/core";\nexport const f = fn({ x: number() }, number());\n`;

async function withTmp(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-c4-692-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Bug 692: check --abs 必须与签名表同源地应用契约", () => {
  it("侧车契约的形参进求值（不再回落 any）", async () => {
    await withTmp(async (dir) => {
      writeFileSync(join(dir, "lib.js"), LIB_JS, "utf-8");
      writeFileSync(join(dir, "lib.nudo.js"), LIB_NUDO, "utf-8");
      const file = join(dir, "lib.js");
      const abs = await runAbsViewCaptured(file);
      expect(abs.stdout).toContain("g(number)");
      expect(abs.stdout).not.toContain("g(any)");
      expect(abs.stdout).toContain("string");
    });
  });

  it("算术函数的返回值随契约收窄（旧行为 number | string）", async () => {
    await withTmp(async (dir) => {
      writeFileSync(join(dir, "plus.js"), PLUS_JS, "utf-8");
      writeFileSync(join(dir, "plus.nudo.js"), PLUS_NUDO, "utf-8");
      const file = join(dir, "plus.js");
      const abs = await runAbsViewCaptured(file);
      expect(abs.stdout).toContain("f(number)");
      expect(abs.stdout).not.toContain("f(any)");
      expect(abs.stdout).not.toContain("number | string");
    });
  });

  it("没有契约的文件：--abs 行为不变（不误伤）", async () => {
    await withTmp(async (dir) => {
      writeFileSync(join(dir, "plain.js"), PLUS_JS, "utf-8");
      const abs = await runAbsViewCaptured(join(dir, "plain.js"));
      expect(abs.stdout).toContain("f(any)");
    });
  });

  it("CLI 级：签名表与 --abs 面给出同一个形参类型", async () => {
    await withTmp(async (dir) => {
      writeFileSync(join(dir, "lib.js"), LIB_JS, "utf-8");
      writeFileSync(join(dir, "lib.nudo.js"), LIB_NUDO, "utf-8");
      const file = join(dir, "lib.js");
      const sig = runCli(["check", file], { cwd: dir });
      expect(sig.stdout).toContain("g(x: number) => string");
      const abs = runCli(["check", file, "--abs"], { cwd: dir });
      expect(abs.stdout).toContain("g(number)");
      expect(abs.stdout).not.toContain("g(any)");
    });
  }, 30000);
});
