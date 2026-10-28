/**
 * BUG-089 回归：调用记录的「调用现场文件」不得用**行数上界**猜。
 *
 * 改前 `rec.callLoc.line > lineCount` 是唯一判据：依赖模块里的调用
 * （`dep.js` 第 2 行）在「行号 ≤ 现场文件行数」时被误贴成现场文件 ⇒
 * 见证名 `call@usage.js:L2` 指向现场文件里根本不是该调用的行（甚至注释行），
 * 并与现场文件自己的调用**撞名**。
 *
 * 现判据：本文件在该位置确实有**调用表达式**（AST 核对）才贴；核不上就不贴。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { collectCallRecords } from "../analyzer-orchestrate-calls.ts";
import { tmpProject, writeTmpFiles } from "./tmp-project.ts";

function project(collide: boolean): { dir: string; usage: string } {
  const dep = 'import { greet } from "./lib.js";\nexport const r = greet("from-dep");\n';
  // collide：现场文件第 2 行**恰好也是**调用（与 dep 同号不同列）
  const usage = collide
    ? 'import { greet } from "./lib.js";\nconst a = greet("from-usage");\nimport { r } from "./dep.js";\nexport const o = a;\nexport const p = r;\n'
    : 'import { greet } from "./lib.js";\n// line 2 is a COMMENT, definitely not a call\nimport { r } from "./dep.js";\nconst a = greet("from-usage");\nexport const o = a;\nexport const p = r;\n';
  const dir = tmpProject(collide ? "nudo-089-collide-" : "nudo-089-", {
    "lib.js": "export function greet(name) { return \"hi \" + name; }\n",
    "dep.js": dep,
    "usage.js": usage,
  });
  return { dir, usage };
}

describe("BUG-089 — 调用现场文件按 AST 核对，不用行数猜", () => {
  it("依赖模块里的调用不得带现场文件（行号落在注释行）", () => {
    const { dir, usage } = project(false);
    const records = collectCallRecords(join(dir, "usage.js"), usage);
    const depRecord = records.find((r) => r.argAbs.length > 0 && r.callLoc?.line === 2);
    expect(depRecord).toBeDefined();
    expect(depRecord!.callSiteFile).toBeUndefined();
  });

  it("同号不同列（collide）⇒ 现场调用保留现场文件，依赖调用不贴", () => {
    const { dir, usage } = project(true);
    const records = collectCallRecords(join(dir, "usage.js"), usage);
    const local = records.filter((r) => r.callSiteFile !== undefined);
    expect(local).toHaveLength(1);
    expect(local[0]!.callLoc!.line).toBe(2);
    // 依赖里那次调用（同 line 2，不同列）不得被贴成现场文件
    const depRecords = records.filter((r) => r.callSiteFile === undefined);
    expect(depRecords.length).toBeGreaterThanOrEqual(1);
  });
});
