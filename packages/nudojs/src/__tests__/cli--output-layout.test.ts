/**
 * 缺陷报告类别 08 ——「产物落盘与文件集合」8 条回归钉：
 *
 * - Bug 24：无方法的类 / 纯 namespace 模块的 `export` 空产物早退
 * - Bug 26：`migrate strip` 把 `.ts` 与 `.cts` 映射到同一产物路径
 * - Bug 27：目标越出 cwd 时 diff 头拼成 `--- a//<绝对路径>`
 * - Bug 31：第二道空产物早退丢弃已组装好的 `dtsChunks`
 * - Bug 32：`.mjs/.mts/.cjs/.cts` 源恒写 `<stem>.d.ts`（TS 永不查）
 * - Bug 43：dts 相对说明符重基到**源文件**而非产物旁边的兄弟声明
 * - Bug 46：`standard --out` 按函数名落盘且从不回收陈旧产物
 * - Bug 67：`migrate verify` 目录扫描不套用「产物压掉同 stem 源」规则
 *
 * 夹具一律 `writeSrcTsconfig` ⇒ 子进程解析 `@nudojs/*` 到仓内 `src`，
 * 不测上一次构建的 dist。
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli, writeSrcTsconfig } from "./helpers/run-cli.ts";

function fixture(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `nudo-bug08-${tag}-`));
  writeSrcTsconfig(dir);
  writeFileSync(
    join(dir, "package.json"),
    '{"name":"bug08","version":"1.0.0","type":"module"}\n',
    "utf-8",
  );
  return dir;
}

function readIfExists(p: string): string {
  return existsSync(p) ? readFileSync(p, "utf-8") : "";
}

describe("类别 08 · 产物落盘与文件集合", () => {
  it("Bug 24：无方法的类 / 纯 namespace 都是模块面 ⇒ 正常出 .d.ts 且 --out 落盘", () => {
    const dir = fixture("24");
    writeFileSync(
      join(dir, "dto.js"),
      "export class User { constructor(name, age) { this.name = name; this.age = age; } }\n",
    );
    writeFileSync(
      join(dir, "ns.ts"),
      "export namespace NS {\n  export interface I { a: number }\n  export function g(x: number): number { return x; }\n}\n",
    );

    const dto = runCli(["export", join(dir, "dto.js"), "--format", "dts"]);
    expect(dto.status).toBe(0);
    expect(dto.stdout).not.toContain("No analyzed functions found");
    expect(dto.stdout).toContain("export declare class User");

    const out = join(dir, "out");
    const written = runCli(["export", join(dir, "dto.js"), "--format", "dts", "--out", out]);
    expect(written.status).toBe(0);
    expect(readdirSync(out)).toContain("dto.d.ts");

    const ns = runCli(["export", join(dir, "ns.ts"), "--format", "dts"]);
    expect(ns.status).toBe(0);
    expect(ns.stdout).not.toContain("No analyzed functions found");
    expect(ns.stdout).toContain("export declare namespace NS");
  });

  it("Bug 31：私有函数 + export const 不得丢掉已组装的模块面", () => {
    const dir = fixture("31");
    writeFileSync(
      join(dir, "m.js"),
      "function inner(x) { return x + 1; }\nfunction other() { return inner(2); }\nexport const VERSION = 1;\n",
    );
    const out = join(dir, "out");
    const r = runCli(["export", join(dir, "m.js"), "--format", "all", "--out", out]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("No exported declarations found");
    expect(readIfExists(join(out, "m.d.ts"))).toContain("export declare const VERSION: number");
  });

  it("Bug 32：显式扩展名源按 TS 解析口径落 .d.mts / .d.cts", () => {
    for (const [src, expected] of [
      ["m.mjs", "m.d.mts"],
      ["m.mts", "m.d.mts"],
      ["m.cjs", "m.d.cts"],
      ["m.cts", "m.d.cts"],
      ["m.js", "m.d.ts"],
    ] as const) {
      const dir = fixture("32");
      writeFileSync(join(dir, src), "export function f(x) { return x + 1; }\n");
      const out = join(dir, "out");
      const r = runCli(["export", join(dir, src), "--format", "dts", "--out", out]);
      expect(r.status).toBe(0);
      expect(readdirSync(out), `${src} → ${expected}`).toContain(expected);
    }
    // 5 次 CLI 子进程（tsx 冷启动各约 5–10s）⇒ 单用例放宽超时
  }, 120_000);

  it("Bug 43：dts 相对说明符指向产物旁边的兄弟声明（./base.js）", () => {
    const dir = fixture("43");
    writeFileSync(join(dir, "base.js"), 'export class Base { greet() { return "hi"; } }\n');
    writeFileSync(
      join(dir, "child.js"),
      'import { Base } from "./base.js";\nexport class Child extends Base { greet() { return "yo"; } }\n',
    );
    const types = join(dir, "types");
    expect(runCli(["export", join(dir, "base.js"), "--format", "dts", "--out", types]).status).toBe(0);
    expect(runCli(["export", join(dir, "child.js"), "--format", "dts", "--out", types]).status).toBe(0);
    const child = readIfExists(join(types, "child.d.ts"));
    expect(child).toContain('from "./base.js"');
    expect(child).not.toContain('from "../base.js"');
  });

  it("Bug 46：standard 重导出后回收上一轮的陈旧 <fn>.nudo.standard.ts", () => {
    const dir = fixture("46");
    const lib = join(dir, "lib.js");
    const out = join(dir, "out");
    writeFileSync(lib, "export function alpha(x) { return x + 1; }\nexport function beta(x) { return x * 2; }\n");
    expect(runCli(["export", lib, "--format", "all", "--out", out]).status).toBe(0);
    expect(readdirSync(out)).toContain("beta.nudo.standard.ts");

    writeFileSync(lib, "export function alpha(x) { return x + 1; }\nexport function gamma(x) { return x * 3; }\n");
    const again = runCli(["export", lib, "--format", "all", "--out", out]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("removed stale");
    expect(readdirSync(out)).toContain("gamma.nudo.standard.ts");
    expect(readdirSync(out)).not.toContain("beta.nudo.standard.ts");
  });

  it("Bug 26：.cts → .cjs（与 tsc 一致），两个模块都留在产物面", () => {
    const dir = fixture("26");
    writeFileSync(
      join(dir, "index.ts"),
      "export const a: number = 1;\nexport function fa(): number { return a; }\n",
    );
    writeFileSync(
      join(dir, "index.cts"),
      "export const b: number = 2;\nexport function fb(): number { return b; }\n",
    );
    const r = runCli(["migrate", "strip", dir, "--write", "--no-draft", "--json"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("index.cjs");
    expect(r.stdout).toContain("index.js");
    // 后写不得覆盖先写：两个模块的内容都在产物面
    expect(readIfExists(join(dir, "index.cjs"))).toContain("b = 2");
    expect(readIfExists(join(dir, "index.js"))).toContain("a = 1");
  });

  it("Bug 67：verify 的扫描集合与 nudo check . 同口径（产物压掉同 stem 源）", () => {
    const dir = fixture("67");
    const src = join(dir, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "n.ts"), "export function setDelay(ms) { return ms.toFixed(2); }\n");
    writeFileSync(
      join(src, "n.js"),
      'export function setDelay(ms) { if (typeof ms === "number") return ms.toFixed(2); return 0; }\n',
    );
    const r = runCli(["migrate", "verify", dir, "--json"]);
    expect(r.status).toBe(0);
    const rows = JSON.parse(r.stdout) as Array<{ file: string; nudoOk: boolean }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.file).toContain("n.js");
    expect(rows[0]!.nudoOk).toBe(true);
  });

  it("Bug 27：越出 cwd 的目标不再产出 a//<绝对路径> 的 diff 头", () => {
    const ws = fixture("27ws");
    const proj = fixture("27proj");
    writeFileSync(join(proj, "lib.js"), "export function f(x) { return x + 1; }\n");
    const r = runCli(["check", join(proj, "lib.js"), "--fix"], { cwd: ws });
    expect(r.stdout).not.toContain("a//");
    expect(r.stdout).toContain("--- a/lib.nudo.js");
    expect(r.stdout).toContain("target outside cwd");

    writeFileSync(join(ws, "use.js"), `import { f } from ${JSON.stringify(join(proj, "lib.js"))};\nconst a = f(2);\n`);
    const freeze = runCli(
      ["test", join(proj, "lib.js"), "--from", join(ws, "use.js"), "--freeze", "--dry-run"],
      { cwd: ws },
    );
    expect(freeze.stdout).not.toContain("a//");
    expect(freeze.stdout).toContain("--- a/lib.js");
  });
});
