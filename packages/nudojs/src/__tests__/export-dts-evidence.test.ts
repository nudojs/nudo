/**
 * export --format dts 的证据面（DX 批次）：
 * 1. sidecar（*.nudo.js）与 inline @nudo:contract 契约进参数/返回投影
 *    （与 check 签名面同数据源 effectiveInterface）；
 * 2. @nudo:case 见证**不进**投影（BUG-044）：见证是调试见证，契约义务在
 *    `*.nudo.js` 侧车 / `@nudo:contract`；`nudo export` 以 `caseMode: "none"`
 *    调分析器 ⇒ 见证既不 widen 形参/返回，也不产出 `Case:` 行；
 * 3. 非导出顶层函数不泄漏进 .d.ts（导出面 = export / export default /
 *    CJS exports，与 check entry 表同源 localNamedExports）；
 * 4. 无任何证据的参数位保持 unknown + stderr 单行提示（三条补证据路径）；
 * 5. 有函数但无导出声明时 stdout 如实说明（exit 0）。
 *
 * runner 注：spawn 型 CLI 子进程对 @nudojs/* 的解析不经 vitest 别名——
 * 子进程 cwd 下的 tsconfig.json paths（绝对路径指向 src）保证测试面
 * 与本仓 src 一致、不受共享 dist 构建新旧影响（与 vitest 别名同语义）。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-export-dts-"));
  dirs.push(dir);
  writeFileSync(join(dir, "tsconfig.json"), SRC_TSCONFIG, "utf-8");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

describe("export dts — 契约证据进投影（case 见证不进投影）", () => {
  it("sidecar 契约：参数投影契约形态、返回由契约种子求值折出", () => {
    const dir = fixtureDir({
      "mini.js": `export function greet(u) { return u.name; }\n`,
      "mini.nudo.js": `export const greet = fn({ u: shape({ name: string() }) });\n`,
    });
    const r = runCliTsx(["export", "mini.js", "--format", "dts"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function greet(u: { name: string }): string;");
    // 参数有证据 → 不打 unknown 提示
    expect(r.stderr).not.toContain("rendered as unknown");
  }, 30000);

  it("inline @nudo:contract（@nudo:import 模板）：同 sidecar 投影", () => {
    const dir = fixtureDir({
      "tpl.nudo.js": `export const userShape = shape({ name: string() });\n`,
      "inline.js": [
        `/// @nudo:import { userShape } from "./tpl.nudo.js"`,
        ``,
        `/**`,
        ` * @nudo:contract u userShape`,
        ` */`,
        `export function greet2(u) { return u.name; }`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", "inline.js", "--format", "dts"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function greet2(u: { name: string }): string;");
    expect(r.stderr).not.toContain("rendered as unknown");
  }, 30000);

  it("调试见证不进导出面（BUG-044）：@nudo:case 不 widen 投影，也不产出 Case 行", () => {
    const dir = fixtureDir({
      "cased.js": [
        `/** @nudo:case "named" ({ name: "Ada" }) */`,
        `export function greet3(u) { return u.name; }`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", "cased.js", "--format", "dts"], { cwd: dir });
    expect(r.status).toBe(0);
    // BUG-044：`@nudo:case` 是**调试见证**，不是契约产品（契约义务在
    // `*.nudo.js` 侧车 / `@nudo:contract`）⇒ `nudo export` 以
    // `caseMode: "none"` 调分析器，见证不进投影：形参/返回都无证据 ⇒ any。
    expect(r.stdout).toContain("export declare function greet3(u: any): any;");
    // 见证也不产出 `Case:` 行（Case 行只出现在 debug / `nudo test` / LSP 面）
    expect(r.stdout).not.toContain("Case:");
  }, 30000);
});

describe("export dts — 导出面过滤与 unknown 例外", () => {
  it("非导出顶层函数不进 .d.ts；无证据参数渲染 any（Abs any ≠ unknown，Bug 544）", () => {
    const dir = fixtureDir({
      "leak.js": [
        `function helper(u) { return u.name; }`,
        `export function public1(x) { return helper({ name: x }); }`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", "leak.js", "--format", "dts"], { cwd: dir });
    expect(r.status).toBe(0);
    // 未受约束的入口形参 = Abs any（未约束）⇒ TS any（abs.md:100：
    // 「unconstrained entry parameters display as `any`, never as `unknown`」）
    expect(r.stdout).toContain("export declare function public1(x: any): any;");
    expect(r.stdout).not.toContain("helper");
  }, 30000);

  it("export default 函数进导出面", () => {
    const dir = fixtureDir({
      "defs.js": `export default function makeGreeting(n) { return "hi " + n; }\n`,
    });
    const r = runCliTsx(["export", "defs.js", "--format", "dts"], { cwd: dir });
    expect(r.status).toBe(0);
    // default 导出进导出面：形态由 BUG-189 统一为「声明 + 别名导出」
    // （`declare function makeGreeting(...)` + `export { … as default }`），
    // 语义等价于 `export default function makeGreeting`。
    expect(r.stdout).toContain("makeGreeting");
    expect(r.stdout).toContain("as default");
    // 局部绑定名 `makeGreeting` **不是**导出名（Bug 515）⇒ 不得声明成命名导出
    expect(r.stdout).not.toContain("export declare function makeGreeting");
  }, 30000);

  it("有函数但无导出声明：stdout 如实说明（exit 0）", () => {
    const dir = fixtureDir({
      "noexport.js": `function internal(x) { return x * 2; }\n`,
    });
    const r = runCliTsx(["export", "noexport.js", "--format", "dts"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("No exported declarations found");
    expect(r.stdout).not.toContain("internal");
  }, 30000);
});
