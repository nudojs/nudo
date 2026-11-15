/**
 * Bug 604 —— 剩余参数（`...rest`）在产物面里被当成普通形参位：槽名原样带
 * `...rest`、槽值是**单个实参**、槽数取观测实参个数 ⇒ 凭空多出 `argN` 槽。
 *
 * 症状（改前）：`export function sumAll(first, ...rest)` 在 `sumAll(1, 2, 3)`
 * 的调用点上产出
 *   `z.object({ first: z.literal(1), "...rest": z.literal(2), arg2: z.literal(3) })`
 * —— 三个槽：剩余参数被拆成「`...rest` 一个槽 + `arg2` 一个槽」，而调用面里
 * 剩余参数**是一个数组**。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一参数面以**观测实参个数**
 * 为槽数、以 `fn.paramNames[i]` 为槽名 ⇒ 剩余参数与多出来的实参各自成槽。
 *
 * 修法（族 17 · S1）：槽位表改以**声明形参表**为骨架——剩余参数位取裸名
 * （`rest`，不带 `...`）、槽值是**数组** Abs（rest 之后的实参合成）、槽数取
 * 声明形参个数（不凭空造 `argN`）。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-604-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

describe("export — 剩余参数位（族 17 · S1 · Bug 604）", () => {
  it("zod 入参面：槽名取裸名、槽值是数组、不凭空造 argN 槽", () => {
    const dir = fixture({
      "rest604.js": [
        `export function sumAll(first, ...rest) { return first + rest.length; }`,
        `sumAll(1, 2, 3);`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "rest604.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    // 剩余参数位：裸名 + 数组值
    expect(r.stdout).toContain("rest: z.array(");
    // 槽名不带 `...`
    expect(r.stdout).not.toContain('"...rest"');
    // 槽数取声明形参表（2 个）⇒ 没有凭空造出来的 `arg2`
    expect(r.stdout).not.toContain("arg2");
  }, 30000);

  it("standard 面：剩余参数位导出名取裸名，节点是数组", () => {
    const dir = fixture({
      "rest604b.js": [
        `export function sumAll(first, ...rest) { return first + rest.length; }`,
        `sumAll(1, 2, 3);`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "rest604b.js"), "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("sumAll_rest");
    expect(r.stdout).not.toContain("sumAll____rest");
    expect(r.stdout).not.toContain("sumAll_arg2");
  }, 30000);
});
