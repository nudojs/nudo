/**
 * BUG-016 —— `nudo export --out` 用**绝对源路径**当模块标识 ⇒ 产物重复 +
 * 输出不可复现。
 *
 * 症状：同一份源码放在两个目录里分别导出到同一个 `--out` 目录 ⇒ 第二个模块被
 * 当成「另一个模块」⇒ 多出一份 hash 后缀副本，旧副本遗留；产物首行的
 * `// nudo-export-module:` 还内嵌**构建机绝对路径** ⇒ 同一份源码在不同
 * checkout / 不同机器上产出不同字节。
 *
 * 修法：模块标识改为**与路径无关**的稳定 id（包内 ⇒ `<包名>/<相对包根路径>`；
 * 包外 ⇒ `<stem>|<导出名集合>`），marker 里不再写绝对路径。
 *
 * 钉：
 * - 两个目录下的同一份源码导出后，`--out` 目录里**只有一份**产物（原地覆盖）；
 * - marker 行不含绝对路径（可复现构建）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SRC = "export function clean(x) {\n  return x + 1;\n}\nclean(1);\n";

describe("BUG-016 — export --out 的模块标识与绝对路径无关", () => {
  it("同一份源码在两个目录下导出到同一 out 目录 ⇒ 只有一份产物", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b016-"));
    dirs.push(dir);
    for (const sub of ["A", "B"]) {
      mkdirSync(join(dir, sub), { recursive: true });
      writeFileSync(join(dir, sub, "clean.js"), SRC, "utf-8");
    }
    const out = join(dir, "out");

    const a = runCliTsx(["export", join(dir, "A", "clean.js"), "--format", "dts", "--out", out]);
    expect(a.status).toBe(0);
    expect(a.stdout).toContain("wrote");
    const b = runCliTsx(["export", join(dir, "B", "clean.js"), "--format", "dts", "--out", out]);
    expect(b.status).toBe(0);

    const products = readdirSync(out).filter((f) => f.endsWith(".d.ts"));
    // 改前：clean.d.ts（A 的遗留副本）+ clean.<hash>.d.ts（B 的新副本）
    expect(products).toEqual(["clean.d.ts"]);
  }, 60000);

  it("产物 marker 不含绝对路径（同一源码 ⇒ 同一字节）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b016-marker-"));
    dirs.push(dir);
    mkdirSync(join(dir, "A"), { recursive: true });
    mkdirSync(join(dir, "B"), { recursive: true });
    writeFileSync(join(dir, "A", "clean.js"), SRC, "utf-8");
    writeFileSync(join(dir, "B", "clean.js"), SRC, "utf-8");
    const outA = join(dir, "outA");
    const outB = join(dir, "outB");

    expect(runCliTsx(["export", join(dir, "A", "clean.js"), "--format", "dts", "--out", outA]).status).toBe(0);
    expect(runCliTsx(["export", join(dir, "B", "clean.js"), "--format", "dts", "--out", outB]).status).toBe(0);

    const a = readFileSync(join(outA, "clean.d.ts"), "utf-8");
    const b = readFileSync(join(outB, "clean.d.ts"), "utf-8");
    const marker = a.split("\n")[0]!;
    expect(marker).toMatch(/^\/\/ nudo-export-module: clean\|clean$/);
    expect(marker).not.toContain(dir);
    expect(a).toBe(b);
  }, 60000);
});
