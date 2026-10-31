/**
 * BUG-232 —— `nudo export --format dts --out <dir>` 不重基相对模块说明符。
 *
 * 产物里的 `import type … from "./point.js"` / `export … from "./helper.js"`
 * 是相对**源目录**的；写到 `--out` 后解析基准变成输出目录 ⇒ 消费端
 * `tsc` 报 **TS2307**（同一份字节放源目录 0 error）。
 *
 * 修法：写盘时按「源目录 → 输出目录」的位移重写相对说明符
 * （`ExportArtifacts.sourcePath` 是**独立**的可选字段 —— `moduleKey` 仍与
 * 路径无关，BUG-016 不回归）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runCliTsx as runCli } from "./helpers/run-cli.ts";

function makeFixture(): { src: string; outDir: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "nudo-bug-232-"));
  const src = join(root, "src");
  const outDir = join(root, "dist", "types");
  mkdirSync(src, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(src, "point.js"), `export class Point {\n  constructor(x) { this.x = x; }\n}\n`);
  writeFileSync(join(src, "point.d.ts"), `export declare class Point {\n  x: number;\n  constructor(x: number);\n}\n`);
  writeFileSync(join(src, "helper.js"), `export function helper() {\n  return 1;\n}\n`);
  writeFileSync(join(src, "helper.d.ts"), `export declare function helper(): number;\n`);
  writeFileSync(
    join(src, "user.js"),
    'import { Point } from "./point.js";\n\nexport { helper } from "./helper.js";\n\nexport function make(x) {\n  return new Point(x);\n}\n\nmake(1);\n',
  );
  return { src, outDir, root };
}

describe("BUG-232 —— --out 产物的相对说明符必须重基", () => {
  it("写出的 .d.ts 里的相对说明符从输出目录可解析（不再指向源目录）", () => {
    const { src, outDir } = makeFixture();
    const r = runCli(["export", join(src, "user.js"), "--format", "dts", "--out", outDir]);
    expect(r.status).toBe(0);

    const produced = join(outDir, "user.d.ts");
    expect(existsSync(produced)).toBe(true);
    const dts = readFileSync(produced, "utf-8");

    const specs = [...dts.matchAll(/\bfrom\s*["'](\.[^"']*)["']/g)].map((m) => m[1]!);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      // 说明符按**产物所在目录**解析必须落到一个真实文件（或它的 .d.ts）
      const abs = resolve(dirname(produced), spec);
      const candidates = [abs, abs.replace(/\.js$/, ".d.ts"), abs.replace(/\.js$/, ".ts")];
      expect(candidates.some((p) => existsSync(p)), `unresolved specifier ${spec}`).toBe(true);
    }
    // 源目录相对写法必须已被重基
    expect(dts).not.toContain('from "./helper.js"');
    expect(dts).toContain('from "../../src/helper.js"');
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）
});
