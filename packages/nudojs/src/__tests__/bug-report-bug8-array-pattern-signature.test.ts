/**
 * 缺陷报告类别 03 补修 —— Bug 8 的**签名面残留**。
 *
 * L1 执法侧（数组解构形参按下标投影实参）已在类别 03 的主提交里修好；
 * 残留是 `generalize.ts` 仍把数组 pattern 的契约叶子合成**对象槽**：
 *
 *   f([ x ]: { x: number }) => never  throws TypeError
 *   [ERROR] f (export): may throw TypeError  (nudo:entry-may-throw)
 *
 * 期望：形参域是数组 `number[]`、返回 `number`、不判必抛；`f([5])` 合法、
 * `f([-1])` 仍报 `x > 0`（L1 不回归）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli, writeSrcTsconfig } from "./helpers/run-cli.ts";

describe("类别 03 补修 · Bug 8 数组解构形参签名面", () => {
  it("签名是 number[] / 返回 number / 不判必抛，L1 元素义务照常执法", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug8-sig-"));
    writeSrcTsconfig(dir);
    writeFileSync(
      join(dir, "package.json"),
      '{"name":"bug8","version":"1.0.0","type":"module"}\n',
      "utf-8",
    );
    writeFileSync(
      join(dir, "std.nudo.js"),
      'import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n',
    );
    const entry = join(dir, "entry.js");
    writeFileSync(
      entry,
      '/// @nudo:import { positive } from "./std.nudo.js"\n' +
        "/** @nudo:contract x positive */\n" +
        "export function f([x]) { return x; }\n" +
        "export function ok() { return f([5]); }\n" +
        "export function bad() { return f([-1]); }\n",
    );

    const r = runCli(["check", entry, "--json"]);
    const d = JSON.parse(r.stdout) as {
      signatures: Array<{ name: string; paramTypes?: string[]; display: string }>;
      issues: Array<{ code: string }>;
      summary: { errors: number };
    };
    const sig = d.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    expect(sig!.paramTypes).toEqual(["number[]"]);
    expect(sig!.display).toBe("number");
    expect(sig!.display).not.toContain("never");
    // 数组解构本身不可能抛 ⇒ 不得再报 error 级 entry-may-throw
    expect(d.issues.filter((i) => i.code === "nudo:entry-may-throw")).toHaveLength(0);
    // L1 不回归：合法调用零诊断，只有违约的元素值报一条
    const violations = d.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violations.length).toBe(1);
    expect(d.summary.errors).toBe(1);
  });
});
