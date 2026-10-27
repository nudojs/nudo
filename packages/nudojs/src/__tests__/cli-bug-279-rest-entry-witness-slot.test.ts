/**
 * BUG-279 —— `nudo export` 的 zod / standard 产物把**剩余参数**（`...args`）
 * 的入参槽**多包一层数组** ⇒ 导出的入参 schema 拒绝该函数自己的合法调用。
 *
 * 严格单变量：A 组（无调用点证据，只有 `entry@`）坏、B 组（同一函数 + 一行
 * 调用点）好 —— 两组的差别只在**见证的编码**：入口见证把剩余参数编码成**一个
 * 数组实参**（`entry@L1 (any[])`），调用点见证是「每个实参一个槽」。
 *
 * 钉：
 * - A 组 zod 槽 = `z.array(z.unknown())`（一层）；standard 节点同形；
 * - A 组 standard 校验器（Standard Schema 真跑）**接受** `{ args: [1, 2] }`；
 * - 对照组 B 组仍是**一层**数组，且接受同样的调用（同一函数的两个证据来源
 *   给出同一接受集）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const NO_CALLSITE = "export function restOne(...args) {\n  return args.length;\n}\n";
const WITH_CALLSITE = `${NO_CALLSITE}restOne(1, 2, 3);\n`;

function fixture(src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b279-"));
  dirs.push(dir);
  writeFileSync(join(dir, "lib.js"), src, "utf-8");
  return dir;
}

describe("BUG-279 — rest 入参槽不得多包一层数组", () => {
  it("A 组（无调用点）：zod / standard 槽是一层数组，dts 同形", () => {
    const dir = fixture(NO_CALLSITE);
    const schema = runCliTsx(["export", join(dir, "lib.js"), "--format", "schema"]);
    expect(schema.status).toBe(0);
    // BUG-109：rest 槽恒可选（zod 面 .optional()），仍是一层数组
    expect(schema.stdout).toContain("export const restOneInput = z.object({ args: z.array(z.unknown()).optional() })");
    expect(schema.stdout).not.toContain("z.array(z.array(");

    const std = runCliTsx(["export", join(dir, "lib.js"), "--format", "standard"]);
    expect(std.status).toBe(0);
    expect(std.stdout).toContain('{"key":"args","node":{"k":"arr","element":{"k":"unknown"}},"optional":true}');
    expect(std.stdout).not.toContain('{"key":"args","node":{"k":"arr","element":{"k":"arr"');

    const dts = runCliTsx(["export", join(dir, "lib.js"), "--format", "dts"]);
    expect(dts.stdout).toContain("...args: any[]");
  }, 90000);

  it("A 组 standard 校验器**接受**该函数自己的合法调用 `{args:[1,2]}`", () => {
    const dir = fixture(NO_CALLSITE);
    const out = join(dir, "out");
    expect(runCliTsx(["export", join(dir, "lib.js"), "--format", "standard", "--out", out]).status).toBe(0);
    const name = readdirSync(out).find((f) => f.endsWith(".nudo.standard.ts"));
    expect(name).toBeDefined();
    // artifact 自带类型标注 ⇒ 复制成 .mts 交给 node 的 strip-types 求值
    writeFileSync(join(dir, "artifact.mts"), readFileSync(join(out, name!), "utf-8"), "utf-8");
    const probe = join(dir, "probe.mjs");
    writeFileSync(
      probe,
      [
        `const m = await import(${JSON.stringify(join(dir, "artifact.mts"))});`,
        'const v = m.restOneInput["~standard"];',
        'console.log("one", "issues" in v.validate({ args: [1] }));',
        'console.log("two", "issues" in v.validate({ args: [1, 2] }));',
        'console.log("empty", "issues" in v.validate({ args: [] }));',
        "",
      ].join("\n"),
      "utf-8",
    );
    const run = spawnSync(process.execPath, ["--experimental-strip-types", probe], { encoding: "utf8" });
    const outText = `${run.stdout}${run.stderr}`;
    // 改前：one/two 都报「expected array, received number」
    expect(outText).toContain("one false");
    expect(outText).toContain("two false");
    expect(outText).toContain("empty false");
  }, 90000);

  it("对照组（有调用点证据）：同样是**一层**数组，接受集与 A 组一致", () => {
    const dir = fixture(WITH_CALLSITE);
    const schema = runCliTsx(["export", join(dir, "lib.js"), "--format", "schema"]);
    expect(schema.status).toBe(0);
    expect(schema.stdout).not.toContain("z.array(z.array(");
    expect(schema.stdout).toMatch(/export const restOneInput = z\.object\(\{ args: z\.array\(z\.(union|unknown)/);
  }, 90000);
});
