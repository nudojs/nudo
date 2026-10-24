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

describe("export — skip 函数的多条见证进 Output 面（族 17 · S1 · Bug 619）", () => {
  it("zod 面产出 <fn>Output，且是全部见证的 join", () => {
    const dir = fixture({ "skip619.js": SKIP_CASES });
    const r = runCliTsx(["export", join(dir, "skip619.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("twiceOutput");
    expect(r.stdout).toContain("z.literal(4)");
    expect(r.stdout).toContain("z.literal(6)");
  }, 30000);

  it("standard 面同样产出 Output 校验器", () => {
    const dir = fixture({ "skip619b.js": SKIP_CASES });
    const r = runCliTsx(["export", join(dir, "skip619b.js"), "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("twiceOutput");
  }, 30000);
});
