/**
 * BUG-099 CLI 回归：截断诊断必须**跨面可见**。
 *
 * 修前：同一份递归源码，`nudo check` / `nudo health` 报「求值被截断」，
 * `nudo test`（人类面 + `--json`）**零诊断** —— 三个面对同一件事给出互斥
 * 结论，`test --freeze` 还会把放宽结果固化成 `@nudo:case` 事实。
 * 文档承诺（website/docs/guides/performance.md）：truncation never degrades
 * results silently。
 *
 * 断言面：text 面标注 / `--json` 的 diagnostics[] 与 summary 自洽 /
 * check 面同码（跨面口径一致）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

/** 自递归：抽象实参 `n - 1` 仍是 `number` ⇒ 同指纹在栈上（cycle 归因） */
const SELF_RECURSION = `export function loop(n) {
  if (n <= 0) return 0;
  return loop(n - 1) + 1;
}
`;

const CODE = "nudo:recursion-truncated";

function writeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug099-"));
  const file = join(dir, "self.js");
  writeFileSync(file, SELF_RECURSION, "utf-8");
  return file;
}

interface TestJson {
  summary: { diagnostics: number };
  diagnostics: { code: string; severity: string }[];
}

describe("BUG-099: 截断诊断跨面可见（test / --json / check）", () => {
  it("test 文本面与 --json 面都带 nudo:recursion-truncated", { timeout: 60_000 }, () => {
    const file = writeFixture();

    const text = runCliTsx(["test", file]);
    expect(text.stdout).toContain(`(${CODE})`);
    expect(text.stdout).toContain("Recursive evaluation of 'loop'");

    const json = runCliTsx(["test", file, "--json"]);
    const parsed = JSON.parse(json.stdout) as TestJson;
    const trunc = parsed.diagnostics.filter((d) => d.code === CODE);
    expect(trunc).toHaveLength(1);
    expect(trunc[0]!.severity).toBe("info");
    // summary 计数来自同一条数组 ⇒ 两面自洽（此前恒为 0）
    expect(parsed.summary.diagnostics).toBe(parsed.diagnostics.length);
  });

  it("check 面同码同源（跨面口径一致，info 不挡门禁）", { timeout: 60_000 }, () => {
    const file = writeFixture();
    const r = runCliTsx(["check", file]);
    expect(r.stdout).toContain(`(${CODE})`);
    // 门禁仍由 L2 may-throw 决定：截断诊断是 info，不是新错误
    expect(r.stdout).toContain("nudo:entry-may-throw");
    expect(r.status).toBe(1);
  });
});
