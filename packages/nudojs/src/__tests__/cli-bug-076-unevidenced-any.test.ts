/**
 * BUG-076 —— `nudo export --format dts` 的**无证据参数**口径。
 *
 * 导出指南 en/zh 与 `docs/design/cli-semantics.md` §2 原本承诺：未被观测的
 * export 参数渲染为 **`unknown`** 并在 stderr 打一行**点名提示**。历史实现
 * （Bug 544 把 `abs.md:100` 的 display 规则误引到 .d.ts 产物面）渲染成
 * **`any`** 且不打提示，本文件曾钉住那处「文档 vs 实现」矛盾。
 *
 * 2026-11-06 产品裁定「nudo 的 any 含义更接近 TS 的 unknown」把 TS 投影面
 * 归一为 `unknown` ⇒ **文档承诺的类型部分已兑现**。`abs.md` 的 display 规则
 * 仍只管 nudo 展示 / CLI 面（那里 any 与 unknown 继续区分）。
 *
 * 归一还带来一个**顺带的正面效应**：提示通道是按「渲染成 unknown」触发的，
 * 所以主路径也开始打点名提示 ⇒ BUG-076 记录的「文档承诺 vs 实现」矛盾
 * （类型 + 提示两半）**彻底关闭**：① **主路径**（普通导出函数，完全无证据 /
 * 契约未覆盖某位）⇒ `unknown` + stderr `rendered as unknown`；
 * ② **窄路径**（`@nudo:skip` / 无 case 函数 **且** 手写契约参数位存在
 *    ⇒ `contractOnlySignature`）⇒ 同样的 `unknown` + 点名提示。
 * 本文件钉住新口径；提示通道若退回只覆盖窄路径，这条回归会先亮红灯。
 *
 * ⚠ 夹具里写 `writeSrcTsconfig`：CLI 子进程按 cwd 找 tsconfig，否则落到
 * `<pkg>/dist` 的旧构建 ⇒ 断言会测到陈旧实现。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli, writeSrcTsconfig } from "./helpers/run-cli.ts";

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-076-"));
  writeSrcTsconfig(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

describe("export --format dts · BUG-076 · 无证据参数的既定口径", () => {
  it("主路径：完全无证据的导出函数 ⇒ 参数 unknown，stderr 点名提示", () => {
    const dir = fixtureDir({
      "noev.js": `export function neverCalled(a, b) {\n  return a + b;\n}\n`,
    });

    const r = runCli(["export", "noev.js", "--format", "dts"], { cwd: dir });

    expect(r.status, r.stdout + r.stderr).toBe(0);
    // Abs `any`（未约束）⇒ TS unknown（nudo any ≈ TS unknown；2026-11-06 归一）
    expect(r.stdout).toContain("export declare function neverCalled(a: unknown, b: unknown)");
    expect(r.stdout).toContain("@param a - unknown");
    expect(r.stdout).toContain("unknown");
    // 归一后主路径也纳入提示通道（文档承诺完全兑现）
    expect(r.stderr).toContain("rendered as unknown");
  }, 30000);

  it("主路径：契约只覆盖部分形参时，未覆盖位同样是 unknown", () => {
    const dir = fixtureDir({
      "std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
      "partial.js": `export function partialFn(a, b) {\n  return a + b;\n}\n`,
      "partial.nudo.js": `import { number } from "@nudojs/core";\nexport const partialFn = fn({ a: number() }, number());\n`,
    });

    const r = runCli(["export", "partial.js", "--format", "dts"], { cwd: dir });

    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("export declare function partialFn(a: number, b: unknown)");
    expect(r.stdout).toContain("b: unknown");
    expect(r.stderr).toContain("rendered as unknown");
  }, 30000);

  it("窄路径：@nudo:skip + 契约未覆盖的形参 ⇒ 该位 unknown + stderr 点名提示", () => {
    const dir = fixtureDir({
      "std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
      "skipped.js": [
        `/// @nudo:import { positive } from "./std.nudo.js"`,
        `/**`,
        ` * @nudo:skip`,
        ` * @nudo:contract a positive`,
        ` */`,
        `export function sk3(a, b) {`,
        `  return a + b;`,
        `}`,
        ``,
      ].join("\n"),
    });

    const r = runCli(["export", "skipped.js", "--format", "dts"], { cwd: dir });

    expect(r.status, r.stdout + r.stderr).toBe(0);
    // 契约位具名投影；未覆盖位 = unknown（contractOnlySignature 的兜底）
    expect(r.stdout).toContain("export declare function sk3(a: number, b: unknown)");
    // 提示点名到 `fn.param`，并给出三条补证据路径
    expect(r.stderr).toContain("note: sk3.b rendered as unknown");
    expect(r.stderr).toContain("*.nudo.js");
    expect(r.stderr).toContain("@nudo:contract");
    expect(r.stderr).toContain("@nudo:case");
  }, 30000);
});
