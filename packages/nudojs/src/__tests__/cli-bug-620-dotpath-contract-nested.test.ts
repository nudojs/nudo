/**
 * Bug 620 —— **点路径**契约键（`"card.grade"`）在产物面里被当成字面量顶层
 * 属性名，约束也被当成**整个形参**的约束。
 *
 * 症状（改前）：侧车 `fn({ "card.grade": string() }, string())` 声明了解构形参
 * `{ card: { grade } }` 的内层字段约束 ⇒ zod 面产出
 *   `z.object({ "card.grade": z.string() })`
 * —— 点号键成了对象属性名（调用面里根本没有这个属性），而 dts 面是
 *   `nested({ card }: { card: { grade: string } })` ⇒ 两个产物面自相矛盾。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一参数面直接拿契约参数名
 * （`card.grade`）当槽位键、拿约束 Abs 当**整参**的槽值，没有按定位结果展开
 * 点路径。
 *
 * 修法（族 17 · S1）：契约参数按**声明形参表**定位（`locateContractParam`），
 * 点路径 ⇒ 槽位键取路径**首段**（`card`）、槽值是**嵌套 obj**（`{ grade: … }`）。
 *
 * runner 注：侧车要用 `@nudojs/core` 的 builder DSL（点路径键由 `fn()` 归一化）
 * ⇒ 子进程 cwd 下需要 tsconfig.json paths（绝对路径指向仓内 src），与
 * `export-dts-evidence.test.ts` 同口径。
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

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-620-"));
  dirs.push(dir);
  writeFileSync(join(dir, "tsconfig.json"), SRC_TSCONFIG, "utf-8");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

const SOURCE = [
  `export function nested({ card: { grade } }) { return grade + "#"; }`,
  `nested({ card: { grade: "A" } });`,
  ``,
].join("\n");

const SIDECAR = [
  `import { fn, string } from "@nudojs/core";`,
  `export const nested = fn({ "card.grade": string() }, string());`,
  ``,
].join("\n");

describe("export — 点路径契约键的嵌套投影（族 17 · S1 · Bug 620）", () => {
  it("zod 入参面：点路径 ⇒ 嵌套 obj（不是字面量点号键）", () => {
    const dir = fixture({ "dotpath620.js": SOURCE, "dotpath620.nudo.js": SIDECAR });
    const r = runCliTsx(["export", join(dir, "dotpath620.js"), "--format", "schema"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("card: z.object({ grade: z.string() })");
    expect(r.stdout).not.toContain('"card.grade"');
  }, 30000);

  it("dts 面保持嵌套形状（两面的节点形状一致）", () => {
    const dir = fixture({ "dotpath620b.js": SOURCE, "dotpath620b.nudo.js": SIDECAR });
    const r = runCliTsx(["export", join(dir, "dotpath620b.js"), "--format", "dts"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      "export declare function nested({ card }: { card: { grade: string } }): string;",
    );
  }, 30000);
});
