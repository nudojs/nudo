/**
 * Bug 486：合成 `call@` 见证的**返回值**被「目标语境重求值」覆盖 ⇒ 报告出
 * 的调用点真值与实际调用结果矛盾（错误的确切值）。
 *
 * 根因（analyzer-orchestrate-uncached-cases.ts）：`caseAbs` 已经是闸门后的
 * 值（重求值只在「更有信息量」时替换观测值），但随后 `attachAbsToIntension`
 * 挂的是**重求值原值** ⇒ 无条件覆盖 ⇒ 观测值（调用现场语境下的真值）
 * 被目标语境（被分析文件语境）的值顶掉。
 *
 * 修法：挂闸门后的 `caseAbs`。
 *
 * 钉：模块状态不同的两次调用 ⇒ 见证值等于**现场观测值**（不是目标语境重算值）；
 * 无状态差异时口径不变（负控制）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeFile } from "../analyzer.ts";
import { collectCallRecords } from "../analyzer-orchestrate-calls.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

describe("Bug 486：call@ 见证值 = 调用现场观测值（不被目标语境重求值覆盖）", () => {
  it("模块状态不同：见证值 = 现场观测值 6（改前被重算成 1）", () =>
    withTmpProject("nudo-b486-", (dir) => {
      const lib = writeTmpFile(
        dir,
        "lib.js",
        `let counter = 0;
export function addTo(k) { counter += k; return counter; }
`,
      );
      const usage = writeTmpFile(
        dir,
        "usage.js",
        `import { addTo } from "./lib.js";
addTo(5);
addTo(1);
`,
      );
      const external = collectCallRecords(usage, readFileSync(usage, "utf-8"));
      const result = analyzeFile(
        lib,
        readFileSync(lib, "utf-8"),
        undefined,
        external,
      );
      const fn = result.functions.find((f) => f.name === "addTo");
      // 现场观测：addTo(5)=5, addTo(1)=6（模块级累加器）
      const values = fn!.cases
        .filter((c) => c.name.startsWith("call@"))
        .map((c) => c.abs.term?.value)
        .sort((a, b) => Number(a) - Number(b));
      expect(values).toEqual([5, 6]);
    }));

  it("负控制：无状态差异的调用点值不变（3）", () =>
    withTmpProject("nudo-b486b-", (dir) => {
      const lib = writeTmpFile(dir, "lib.js", `export function add(a, b) { return a + b; }\n`);
      const usage = writeTmpFile(
        dir,
        "usage.js",
        `import { add } from "./lib.js";
const x = add(1, 2);
`,
      );
      const external = collectCallRecords(usage, readFileSync(usage, "utf-8"));
      const result = analyzeFile(
        lib,
        readFileSync(lib, "utf-8"),
        undefined,
        external,
      );
      const fn = result.functions.find((f) => f.name === "add");
      const call = fn!.cases.find((c) => c.name.startsWith("call@"));
      expect(call!.abs.term?.value).toBe(3);
    }));
});
