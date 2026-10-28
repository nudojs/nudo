/**
 * BUG-055（CLI 面）：`nudo test --freeze` 把**违反被调方契约**的见证写进被调方
 * ⇒ 一个本来绿色的被调方被自己的 freeze 操作冻成红色（`nudo:case-inconsistency`），
 * 且 `--freeze=update` 原样重记 ⇒ 没有自愈路径。
 *
 * 契约：违反被写方**手写契约**的候选见证**不写入**（归因留给调用现场的
 * `nudo:interface-domain-exceeds`）⇒ 固化后 check 仍绿；update 不再重记。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliTsx } from "./helpers/run-cli.ts";

// ⚠ cwd 必须留在 repo 根：tsx 按 **cwd** 找 tsconfig 的 paths 别名；
// cwd 指向临时目录 ⇒ `@nudojs/service/emit` 落回 package.json exports 的
// **dist**（陈旧产物）⇒ 测试验的不是本次源码。路径一律用绝对路径。

function project(): { dir: string; lib: string; usage: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-055-cli-"));
  writeFileSync(join(dir, "tmpl.nudo.js"), "export const positive = number().gt(0);\n", "utf-8");
  writeFileSync(
    join(dir, "lib.js"),
    `/// @nudo:import { positive } from "./tmpl.nudo.js"
/**
 * @nudo:contract x positive
 */
export function needsPositive(x) {
  return x * 2;
}
`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "usage.js"),
    `import { needsPositive } from "./lib.js";
needsPositive(5);
needsPositive(-1);
`,
    "utf-8",
  );
  return { dir, lib: join(dir, "lib.js"), usage: join(dir, "usage.js") };
}

describe("BUG-055（CLI）— freeze 不得把违反被调方契约的见证写进被调方", () => {
  it("违约见证不写入；固化后 check 仍绿（旧行为：check FAILED + exit 1）", () => {
    const { dir, lib, usage } = project();
    try {
      const before = runCliTsx(["check", lib]);
      expect(before.status, before.stdout).toBe(0);

      const freeze = runCliTsx(["test", lib, "--from", usage, "--freeze"]);
      // 退出码不是本条的判据：调用点上确实存在违反契约的实参 ⇒ 分析面如实报
      // `nudo:interface-domain-exceeds`（error 级，BUG-014 口径）⇒ exit 1 是**正确**的。
      // BUG-055 的判据是「固化不得把该违约搬进被调方」。
      expect(freeze.stdout).toContain("freeze →");
      expect(freeze.stdout).toContain("nudo:interface-domain-exceeds");

      const after = readFileSync(lib, "utf-8");
      expect(after).toContain('@nudo:case "call@usage.js:L2" (5)');
      // 旧行为：`(-1)` 也被写进来 ⇒ 随后 `nudo:case-inconsistency` 判红
      expect(after).not.toContain("call@usage.js:L3");

      const check = runCliTsx(["check", lib]);
      expect(check.stdout, check.stdout).not.toContain("case-inconsistency");
      expect(check.status, check.stdout).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--freeze=update 不再重记违约见证（旧行为：原样重记同一条 ⇒ 永远红）", () => {
    const { dir, lib, usage } = project();
    try {
      const first = runCliTsx(["test", lib, "--from", usage, "--freeze"]);
      expect(first.stdout).toContain("freeze →");
      const once = readFileSync(lib, "utf-8");
      const upd = runCliTsx(["test", lib, "--from", usage, "--freeze=update"]);
      expect(upd.stdout).toContain("freeze: no changes.");
      expect(upd.stdout).not.toContain("freeze →");
      expect(readFileSync(lib, "utf-8")).toBe(once);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
