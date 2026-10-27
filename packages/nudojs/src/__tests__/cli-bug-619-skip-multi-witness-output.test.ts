/**
 * Bug 619 —— `@nudo:skip` + 多条 case 见证时，**Output 面（返回面）不产出**：
 * 兜底只取「第 0 条断言见证」，而无断言的 case 是见证不是断言 ⇒ 兜底落空。
 *
 * 症状（改前）：两条 `@nudo:case` 见证（返回 4 / 6）的 skip 函数，zod 面只有
 * `<fn>Input`、**没有** `<fn>Output`；standard 面同样没有 Output；而**参数面**
 * 却 join 了全部见证（`z.union([z.literal(2), z.literal(3)])`）⇒ 同一函数两套口径。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一返回面兜底取
 * `fn.combinedAbs ?? asserted[0]?.abs`（**只**取第 0 条带断言的 case），而参数
 * 面走的是 `domainEvidenceCases`（join 全部域证据）。
 *
 * 修法（族 17 · S1）：返回面兜底改为 join **全部域证据见证**（与参数面同口径）。
 *
 * ⚠ **BUG-044 口径变更后的重钉**（本文件现行断言）：`@nudo:case` 是**调试见证**，
 * 不是契约产品（`docs/concepts/directives.md`：Cases are debug witnesses … not
 * the contract product）⇒ `nudo export` 以 `caseMode: "none"` 调分析器，
 * **发布面不消费 `@nudo:case`**。因此：
 * - 见证**不再**进 `<fn>Output` 面（也不进 `<fn>Input` 面）；
 * - 只带 `@nudo:case`、无契约的 skip 函数 ⇒ 发布面**没有** Output 校验器
 *   （域证据为空 ⇒ 返回面无种子），这正是 BUG-044 的口径，不是 Bug 619 的缺陷；
 * - 见证返回值（4 / 6）**不**泄漏进产物。
 *
 * 仍钉住（与本次口径无关的真实行为）：函数**仍出现在产物**里（Input 面照常
 * 产出）、命令 exit 0。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-619-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

const SKIP_CASES = [
  `/**`,
  ` * @nudo:skip`,
  ` * @nudo:case "four" (2)`,
  ` * @nudo:case "six" (3)`,
  ` */`,
  `export function twice(data) { return data * 2; }`,
  ``,
].join("\n");

describe("export — skip 函数的多条见证不进 Output 面（BUG-044 重钉 · 原 Bug 619）", () => {
  it("zod 面：见证不进 Output 面，也不泄漏见证返回值", () => {
    const dir = fixture({ "skip619.js": SKIP_CASES });
    const r = runCliTsx(["export", join(dir, "skip619.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    // 函数仍出现在产物里（Input 面照常产出）——与见证口径无关的真实行为
    expect(r.stdout).toContain("twiceInput");
    // BUG-044：见证是调试见证，不进发布面 ⇒ 只带 `@nudo:case` 的 skip 函数
    // 没有 Output 校验器（域证据为空 ⇒ 返回面无种子）
    expect(r.stdout).not.toContain("twiceOutput");
    // 见证返回值（4 / 6）不泄漏进产物
    expect(r.stdout).not.toContain("z.literal(4)");
    expect(r.stdout).not.toContain("z.literal(6)");
  }, 30000);

  it("standard 面：同样没有 Output 校验器", () => {
    const dir = fixture({ "skip619b.js": SKIP_CASES });
    const r = runCliTsx(["export", join(dir, "skip619b.js"), "--format", "standard"]);
    expect(r.status).toBe(0);
    // 函数仍出现在产物里（Input 面照常产出）
    expect(r.stdout).toContain("twiceInput");
    // BUG-044：见证不进发布面 ⇒ 没有 Output 校验器
    expect(r.stdout).not.toContain("twiceOutput");
  }, 30000);
});
