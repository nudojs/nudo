/**
 * Bug 968 —— 挂在「将被删除的语句」上的**文件级指令**被静默丢掉 ⇒ 产物
 * **失去契约绑定** ⇒ 门禁从**红变绿**（假绿）。
 *
 * **真源**：`packages/core/src/strip-types.ts`（数组分支剔除语句时把它的
 * `leadingComments` **转挂**到下一个幸存节点 + 「剥除前后指令条数比对」的
 * 兜底自检）。本钉是**产物面**的回归钉：
 * ① 指令必须在产物里**存活**；
 * ② 门禁行为正确：`.ts` 源与 `.js` 产物**同样红**（源红 / 产物红 ⇒ 结论
 *    一致；产物绿才是假绿）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SHAPES_NUDO_JS = `export const positive = number().gt(0);
`;
const TYPES_JS = `export const Foo = 1;
`;
const LIB_TS = `/// @nudo:import { positive } from "./shapes.nudo.js"
import type { Foo } from "./types.js";

/**
 * @nudo:contract x positive
 */
export function inc(x) {
  return x + 1;
}

export function caller() {
  return inc(-1);
}
`;

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

describe("Bug 968 —— 文件级指令随被删语句消失（产物面 + 门禁行为）", () => {
  it("挂在被删语句上的 `/// @nudo:import` 必须在产物里存活", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-968-"));
    dirs.push(dir);
    writeFileSync(join(dir, "shapes.nudo.js"), SHAPES_NUDO_JS, "utf-8");
    writeFileSync(join(dir, "types.js"), TYPES_JS, "utf-8");
    writeFileSync(join(dir, "lib.ts"), LIB_TS, "utf-8");

    const r = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "lib.ts")]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");

    const product = join(dir, "lib.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    // ★ 指令必须存活（否则契约整条失效 ⇒ 产物绿 = 假绿）
    expect(code).toContain("@nudo:import");
    expect(code).toContain("@nudo:contract x positive");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  });

  it("门禁行为正确：源红 / 产物**同样红**（契约仍被绑定 ⇒ 不是假绿）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-968b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "shapes.nudo.js"), SHAPES_NUDO_JS, "utf-8");
    writeFileSync(join(dir, "types.js"), TYPES_JS, "utf-8");
    writeFileSync(join(dir, "lib.ts"), LIB_TS, "utf-8");

    const strip = runCliTsx(["migrate", "strip", "--write", "--no-draft", join(dir, "lib.ts")]);
    expect(strip.status, strip.stderr).toBe(0);

    for (const name of ["lib.ts", "lib.js"]) {
      const c = runCliTsx(["check", join(dir, name), "--entry-throws", "off"]);
      expect(c.status, `${name}\n${c.stdout}\n${c.stderr}`).toBe(1);
      expect(c.stdout).toContain("nudo:constraint-violated");
    }
  });
});
