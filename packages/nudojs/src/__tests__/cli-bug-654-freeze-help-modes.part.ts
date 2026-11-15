/**
 * Bug 654：`nudo test --help` 宣称 `--freeze` 的模式是 `update | add`，
 * 但 `--freeze=add` 是**用法错误** exit 1 ⇒ **帮助面承诺 vs 实现矛盾**
 * （用户照 `--help` 写就命令失败）。
 *
 * 修复：解析器**接受** `--freeze=add`（帮助文本已经承诺了它 ⇒ 改实现的
 * 成本更低、对用户更友好），并把错误文案里的合法取值集合同步成与帮助
 * 一致。
 *
 * 本钉钉的是**契约本身**：帮助文本列出的每个模式都必须被实现接受
 * （帮助 ↔ 实现同源），而不只是「某几个取值能跑」。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

const SRC = `export function add(a, b) {
  return a + b;
}
const x = add(1, 2);
`;

function makeProject(): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-654-"));
  const file = join(cwd, "lib.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd, file };
}

/** 从 `--freeze [mode]` 的帮助文案里取出承诺的模式集合。 */
function advertisedModes(help: string): string[] {
  const flat = help.replace(/\s+/g, " ");
  const m = /mode: ([a-z |]+);/.exec(flat);
  expect(m, `help 未声明 --freeze 的模式集合：${flat}`).not.toBeNull();
  return (m![1] ?? "").split("|").map((s) => s.trim()).filter((s) => s.length > 0);
}

describe("Bug 654 — --help 承诺的 --freeze 模式必须都被实现接受", () => {
  it("帮助文本承诺 update | add，且两个模式都能被实现接受", () => {
    const { cwd, file } = makeProject();
    try {
      const help = runCli(["test", "--help"], { cwd });
      expect(help.status).toBe(0);
      const modes = advertisedModes(help.stdout);
      expect(modes).toContain("update");
      expect(modes).toContain("add");
      // 帮助承诺的每个模式 ⇒ 实现都必须接受（旧行为：--freeze=add 被拒）
      for (const mode of modes) {
        const r = runCli(["test", file, `--freeze=${mode}`, "--dry-run"], { cwd });
        expect(r.status, `--freeze=${mode} 被拒：${r.stderr}`).toBe(0);
        expect(r.stderr).not.toContain("Invalid --freeze value");
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60000);

  it("非法取值仍被拒（且错误文案列出的合法取值与帮助一致）", () => {
    const { cwd, file } = makeProject();
    try {
      const help = runCli(["test", "--help"], { cwd });
      const modes = advertisedModes(help.stdout);
      const r = runCli(["test", file, "--freeze=bogus", "--dry-run"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Invalid --freeze value");
      // 错误文案里的合法取值集合必须覆盖帮助承诺的每个模式
      for (const mode of modes) {
        expect(r.stderr, `错误文案未列出 ${mode}`).toContain(`=${mode}`);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 60000);
});
