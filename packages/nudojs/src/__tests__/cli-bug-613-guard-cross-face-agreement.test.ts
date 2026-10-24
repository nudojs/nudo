/**
 * Bug 613 — `nudo export` 的 **guard 面无视契约**：守卫取「单次调用点字面量」
 * 而 zod / standard 取「契约域」⇒ 同一次导出里两个面**对同一个值给出相反裁决**。
 *
 * 症状（改前，夹具 = 返回契约 number[0,1] + case 见证 0.5）：
 *   zod 面   → `clamp01Output = z.number().gte(0).lte(1)`（契约域）
 *   guard 面 → `return data === 0.5;`（观测字面量）
 *   ⇒ 值 0.7：zod **接受**、guard **拒绝**（同一命令、同一个函数、同一个值）。
 *
 * 根因：guard 分支取**观测** Abs（`fn.combinedAbs ?? asserted[0]?.abs`），
 * 绕开调度器已算好的统一返回面 `outputAbs`（契约面优先）。
 *
 * 修法（族 17 · S2）：`export/guard-face.ts` 的 `guardFaceChunk` 消费调度器传入
 * 的 `outputAbs` ⇒ guard 与 zod / standard / dts 三个面同一出口域。
 *
 * 本钉把「同一次导出、两个面、同一个值」的裁决**真的跑一遍**（把生成的守卫
 * 去掉类型标注后用 `new Function` 求值），而不是只比字符串。
 *
 * runner 注：spawn 型 CLI 子进程对 @nudojs/* 的解析不经 vitest 别名 ⇒ 子进程
 * cwd 下的 tsconfig.json paths（绝对路径指向 src）保证测试面与本仓 src 一致。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx, repoRoot } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 子进程 tsx 用 tsconfig：@nudojs/* → 仓内 src（vitest 别名的子进程面） */
const SRC_TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      paths: {
        "@nudojs/core": [`${repoRoot}packages/core/src`],
        "@nudojs/core/exec": [`${repoRoot}packages/core/src/algebra/exec/index.ts`],
        "@nudojs/core/internal": [`${repoRoot}packages/core/src/internal.ts`],
        "@nudojs/parser": [`${repoRoot}packages/parser/src`],
        "@nudojs/service": [`${repoRoot}packages/service/src`],
        "@nudojs/service/emit": [`${repoRoot}packages/service/src/emit/index.ts`],
        "@nudojs/service/evaluator": [`${repoRoot}packages/service/src/evaluator/evaluator-api.ts`],
        "@nudojs/env/es": [`${repoRoot}packages/env/src/es.ts`],
        "@nudojs/env/web": [`${repoRoot}packages/env/src/web.ts`],
        "@nudojs/env/node": [`${repoRoot}packages/env/src/node.ts`],
        "@nudojs/harvester": [`${repoRoot}packages/harvester/src`],
      },
    },
  },
  null,
  2,
)}\n`;

/** 建夹具目录（tsconfig.json + 源文件），返回目录路径 */
function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-613-"));
  dirs.push(dir);
  writeFileSync(join(dir, "tsconfig.json"), SRC_TSCONFIG, "utf-8");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/** 夹具：返回契约 = number[0,1]；实现返回 0.5（满足契约 ⇒ 契约面是出口域） */
const FILES = {
  "tpl.nudo.js": `export const unit01 = number().ge(0).le(1);\n`,
  "lib.js": [
    `/// @nudo:import { unit01 } from "./tpl.nudo.js"`,
    ``,
    `/**`,
    ` * @nudo:case "c" (0.5) => 0.5`,
    ` * @nudo:contract return unit01`,
    ` */`,
    `export function clamp01(x) {`,
    `  return 0.5;`,
    `}`,
    ``,
  ].join("\n"),
};

/** 从导出产物里取出守卫函数源码（`export function is<fn>Output(…) { … }`）。 */
function guardSource(stdout: string): string {
  const m = /export function is\w+Output\(value: unknown\): boolean \{[\s\S]*?\n\}/.exec(stdout);
  if (!m) throw new Error(`产物里没有守卫函数：\n${stdout}`);
  return m[0];
}

/**
 * 守卫产物是 TS 源码 ⇒ 去掉类型标注后求值（只为把「裁决」跑出来）。
 * 产物形态固定：`export function isXOutput(value: unknown): boolean { const data = value as T; … }`
 */
function evalGuard(src: string): (value: unknown) => boolean {
  const js = src
    .replace(/export\s+function\s/, "function ")
    .replace(/\(\s*value:\s*unknown\s*\)\s*:\s*boolean/, "(value)")
    .replace(/value as [^;]+;/, "value;");
  return new Function(`return (${js});`)() as (value: unknown) => boolean;
}

describe("Bug 613 — guard 面与 zod 面同一出口域（同一次导出、同一裁决）", () => {
  it("契约允许的值（0.7）guard 接受（改前：guard 拒绝，zod 接受）", () => {
    const dir = fixtureDir(FILES);
    const r = runCliTsx(["export", "lib.js", "--format", "guard"], { cwd: dir });
    expect(r.status).toBe(0);
    const isOutput = evalGuard(guardSource(r.stdout));
    // 契约域 number[0,1] ⇒ 0.7 / 0 / 1 合法，2 / "0.5" 非法
    expect(isOutput(0.7)).toBe(true);
    expect(isOutput(0)).toBe(true);
    expect(isOutput(1)).toBe(true);
    expect(isOutput(2)).toBe(false);
    expect(isOutput("0.5")).toBe(false);
  }, 30000);

  it("zod 面判同一组值 ⇒ 与 guard 面裁决一致（不再一个接受一个拒绝）", () => {
    const dir = fixtureDir(FILES);
    const guard = runCliTsx(["export", "lib.js", "--format", "guard"], { cwd: dir });
    const schema = runCliTsx(["export", "lib.js", "--format", "schema"], { cwd: dir });
    // zod 面 = 契约域（number[0,1]）
    expect(schema.stdout).toContain("export const clamp01Output = z.number()");
    expect(schema.stdout).toContain(".gte(0)");
    expect(schema.stdout).toContain(".lte(1)");
    // guard 面 = 同一出口域（改前是 `data === 0.5` ⇒ 对 0.7 拒绝）
    const isOutput = evalGuard(guardSource(guard.stdout));
    expect(isOutput(0.7)).toBe(true);
  }, 30000);

  it("守卫源码不再是单点字面量判定（改前：data === 0.5）", () => {
    const dir = fixtureDir(FILES);
    const r = runCliTsx(["export", "lib.js", "--format", "guard"], { cwd: dir });
    expect(r.stdout).not.toContain("data === 0.5");
    expect(r.stdout).toContain("data >= 0");
    expect(r.stdout).toContain("data <= 1");
  }, 30000);
});
