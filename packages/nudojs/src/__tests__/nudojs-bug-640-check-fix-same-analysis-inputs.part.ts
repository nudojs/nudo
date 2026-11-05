/**
 * Bug 640 — `nudo check` 与 `nudo check --fix` 喂给分析器的**输入集不同**
 * ⇒ 同一文件两条命令给出**相反**的门禁结论（一个绿一个红 / 一个红一个绿）。
 *
 * 修法（族 18 片 4）：`runCheckFix` 的两处 `checkSource` 调用与 `runCheck`
 * **共用同一个选项构造**（`checkSourceOptions`）：autoBind / projectDir /
 * entryThrows / ignoreThrows / inject·modules / skips —— 且 `--fix` 面同样
 * 装配 env 注入包（`@nudo:mock` 的替换、`@nudo:env` 的全局、模块图）。
 *
 * 四个方向（每个方向都锁「两条命令结论一致」）：
 *  a) `@nudo:mock`（内联）——改前 check 绿 / --fix 红（假红）
 *  b) `nudo.contract.autoBind: false`——改前 check 红 / --fix 绿（假绿 / CI 假通过）
 *  c) `@nudo:mock x from "缺文件"`——改前两条命令的**诊断集**不同
 *  d) `--profile adoption`（L2 降级 warning）——改前 --fix 仍替用户写契约
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli } from "./helpers/run-cli.ts";

function project(
  files: Record<string, string>,
  name = "b640",
): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b640-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", type: "module" }),
    "utf-8",
  );
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(dir, rel), content, "utf-8");
  }
  return dir;
}

/** 门禁结论（exit code = 门禁红绿；--fix 面与 plain check 必须一致） */
function gate(r: { status: number }): "red" | "green" {
  return r.status === 0 ? "green" : "red";
}

describe("Bug 640 — check 与 check --fix 的分析输入集必须一致", () => {
  it("方向 a：@nudo:mock 内联 —— 两条命令同绿（改前 check 绿 / --fix 红）", { timeout: 90_000 }, () => {
    const dir = project({
      "lib.js": `/**
 * @nudo:mock dep = (x) => x
 */
export function f() {
  return dep(1);
}
`,
    });
    const file = join(dir, "lib.js");
    const plain = runCli(["check", file]);
    const fix = runCli(["check", "--fix", file]);
    expect(gate(plain), plain.stdout + plain.stderr).toBe("green");
    expect(gate(fix), fix.stdout + fix.stderr).toBe("green");
    expect(fix.stdout + fix.stderr).not.toContain("residual error");
  });

  it("方向 b：autoBind:false —— 两条命令同红（改前 check 红 / --fix 绿）", { timeout: 90_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b640-ab-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "b640ab",
        version: "1.0.0",
        type: "module",
        nudo: { contract: { autoBind: false } },
      }),
      "utf-8",
    );
    writeFileSync(
      join(dir, "lib.js"),
      `export function f(x) {
  return x + 1;
}
`,
      "utf-8",
    );
    writeFileSync(
      join(dir, "lib.nudo.js"),
      `import { fn, number } from "@nudojs/core";

export const f = fn({ x: number() });
`,
      "utf-8",
    );
    const file = join(dir, "lib.js");
    const plain = runCli(["check", file]);
    const fix = runCli(["check", "--fix", file]);
    expect(gate(plain), plain.stdout + plain.stderr).toBe("red");
    expect(gate(fix), fix.stdout + fix.stderr).toBe("red");
    expect(fix.stdout + fix.stderr).toContain("residual error");
  });

  it("方向 c：@nudo:mock from 缺文件 —— 两条命令的 error 条数一致", { timeout: 90_000 }, () => {
    const dir = project({
      "lib.js": `/**
 * @nudo:mock dep from "./missing-mock.js"
 * @nudo:throws TypeError
 */
export function f() {
  return dep(1);
}
`,
    });
    const file = join(dir, "lib.js");
    const plain = runCli(["check", file]);
    const fix = runCli(["check", "--fix", file]);
    const errorCount = (out: string): number => (out.match(/\[ERROR/g) ?? []).length;
    const residual = (out: string): number =>
      Number(/(\d+) residual error\(s\) remain/.exec(out)?.[1] ?? "-1");
    expect(gate(plain)).toBe("red");
    expect(gate(fix)).toBe("red");
    // mock 装配失败（nudo:module-missing）必须**两条命令都**计入
    expect(plain.stdout + plain.stderr).toContain("nudo:module-missing");
    expect(fix.stdout + fix.stderr).toContain("residual error");
    // 残余 error 条数 = plain check 的 error 条数（同一套输入 ⇒ 同一诊断集）
    expect(residual(fix.stdout + fix.stderr)).toBe(
      errorCount(plain.stdout + plain.stderr),
    );
  });

  it("方向 d：--profile adoption —— --fix 不得为 warning 级诊断替用户写契约", { timeout: 90_000 }, () => {
    const dir = project({
      "lib.js": `export function f(x) {
  return x.toFixed(2);
}
`,
    });
    const file = join(dir, "lib.js");
    const plain = runCli(["check", "--profile", "adoption", file]);
    expect(gate(plain), plain.stdout + plain.stderr).toBe("green");
    const fix = runCli(["check", "--profile", "adoption", "--fix", file]);
    const out = fix.stdout + fix.stderr;
    expect(gate(fix), out).toBe("green");
    expect(out).toContain("0 edit(s) planned");
    expect(existsSync(join(dir, "lib.nudo.js"))).toBe(false);
  });
});
