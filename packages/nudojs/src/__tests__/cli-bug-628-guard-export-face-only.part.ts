/**
 * Bug 628 — `nudo export --format guard` **不守导出面闸门** ⇒ 被裁剪掉的模块内部
 * 函数照样产出运行时守卫（`isinternalHelperOutput`），而同一��导出里 .d.ts 面
 * 静默没有这个函数 ⇒ 产物面互相矛盾（内部实现泄漏成对外承诺）。
 *
 * 根因：导出面过滤（`onExportFace`）此前只装在 **dts 分支**，guard 分支不裁剪。
 *
 * 修法：**导出面闸门装在循环入口**（`export/selection.ts` 的
 * `selectPublicFunctions` —— 四个产物面共用一道闸门，安装点归族 17 · S3）⇒
 * guard 分支收到的函数已是导出面函数。本片（族 17 · S2）不另装闸门，只**消费**
 * 循环入口那道闸门 ⇒ 本钉是回归钉。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-628-"));
  dirs.push(dir);
  writeFileSync(join(dir, "tsconfig.json"), SRC_TSCONFIG, "utf-8");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/** 夹具：一个导出函数 + 一个**未导出**的模块内部函数（两者都有 case 见证） */
const FILES = {
  "lib.js": [
    `/**`,
    ` * @nudo:case "c" (1) => "Ada"`,
    ` */`,
    `export function getName(user) {`,
    `  return user.name;`,
    `}`,
    ``,
    `/**`,
    ` * @nudo:case "c" (3) => 4`,
    ` */`,
    `function internalHelper(x) {`,
    `  return x + 1;`,
    `}`,
    ``,
  ].join("\n"),
};

describe("Bug 628 — guard 面守导出面闸门（内部函数不出守卫）", () => {
  it("guard 产物只有导出面函数的守卫（改前：内部函数也出守卫）", () => {
    const dir = fixtureDir(FILES);
    const r = runCliTsx(["export", "lib.js", "--format", "guard"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export function isgetNameOutput");
    expect(r.stdout).not.toContain("isinternalHelperOutput");
    expect(r.stdout).not.toContain("internalHelper");
  }, 30000);

  it("guard 面与 dts 面口径一致（都只认导出面）", () => {
    const dir = fixtureDir(FILES);
    const guard = runCliTsx(["export", "lib.js", "--format", "guard"], { cwd: dir });
    const dts = runCliTsx(["export", "lib.js", "--format", "dts"], { cwd: dir });
    expect(dts.stdout).toContain("getName");
    expect(dts.stdout).not.toContain("internalHelper");
    expect(guard.stdout).not.toContain("internalHelper");
  }, 30000);
});
