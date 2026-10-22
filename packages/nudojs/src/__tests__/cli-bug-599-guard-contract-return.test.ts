/**
 * Bug 599 — `nudo export --format guard` 忽略**契约返回域**，按单次 case 字面量出守卫。
 *
 * 症状（改前）：函数声明了 `@nudo:contract return unit01`（返回域 = number
 * 区间 [0,1]），同一文件 `@nudo:case` 见证返回 `0.5` ⇒ guard 生成
 * `return data === 0.5;` —— 一个对**所有合法返回值**（0.7 / 0 / 1）都会拒绝的
 * 守卫；而同一次导出的 zod 面按契约投影（`z.number().gte(0).lte(1)`）⇒ 两个
 * 产物面口径分裂。
 *
 * 根因：guard 分支另起炉灶取**观测** Abs（`fn.combinedAbs ?? asserted[0]?.abs`），
 * 完全绕开调度器已算好的统一返回面 `outputAbs`（契约面优先）。
 *
 * 修法（族 17 · S2）：`export/guard-face.ts` 的 `guardFaceChunk` 改为消费调度器
 * 传入的**统一返回面**（`outputAbs`）⇒ 与 zod / standard / dts 三个面同口径。
 *
 * 注：夹具的实现**满足**返回契约（返回 0.5，契约域 = number [0,1]）⇒ 契约面
 * 是出口域；若实现**违约**（返回域与实现矛盾），族 17 · S1 的违约复核
 * （Bug 626）会让**四个面**一起回落实现实际的返回形态（那时不存在跨面分裂）。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-599-"));
  dirs.push(dir);
  writeFileSync(join(dir, "tsconfig.json"), SRC_TSCONFIG, "utf-8");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/**
 * 夹具：返回契约 = number 区间 [0,1]（`unit01`），实现返回 0.5（**满足**契约）。
 *
 * 改前 guard = `data === 0.5`（观测字面量）；改后 = 契约域
 * （`data >= 0 && data <= 1`）。
 */
const CONTRACT_RETURN_FILES = {
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

describe("Bug 599 — guard 面消费契约返回域（不再按单次 case 字面量收窄）", () => {
  it("guard 不再收窄成观测字面量（改前：data === 0.5）", () => {
    const dir = fixtureDir(CONTRACT_RETURN_FILES);
    const r = runCliTsx(["export", "lib.js", "--format", "guard"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export function isclamp01Output");
    expect(r.stdout).not.toContain("data === 0.5");
    // 契约域 = number [0,1] ⇒ 守卫按区间判定
    expect(r.stdout).toContain("data >= 0");
    expect(r.stdout).toContain("data <= 1");
  }, 30000);

  it("guard 与 zod 面同一出口域（zod = 契约域，guard = 契约域）", () => {
    const dir = fixtureDir(CONTRACT_RETURN_FILES);
    const guard = runCliTsx(["export", "lib.js", "--format", "guard"], { cwd: dir });
    const schema = runCliTsx(["export", "lib.js", "--format", "schema"], { cwd: dir });
    // zod 面（契约域）：Output = number [0,1]
    expect(schema.stdout).toContain("export const clamp01Output = z.number()");
    expect(schema.stdout).toContain(".gte(0)");
    expect(schema.stdout).toContain(".lte(1)");
    // guard 面（契约域）：同一出口域，不再是单点字面量
    expect(guard.stdout).not.toContain("data === 0.5");
    expect(guard.stdout).toContain("data >= 0");
    expect(guard.stdout).toContain("data <= 1");
  }, 30000);
});
