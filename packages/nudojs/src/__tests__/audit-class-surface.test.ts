/**
 * 审计 34 · D2：类公开类型的**唯一优先级格**（BUG-007 / 014 / 033）。
 *
 * 三个 bug 是同一处判据的三种症状：谁决定类字段 / accessor 的公开类型。
 * 现口径（`classFieldType` + `fieldsOf`）：
 *
 *   源码注解（declared） > 源码赋值形态（this.x = <expr>） > brand 观测 > unknown
 *
 * - BUG-014：注解不再被初始化器抢占（`z: number | null = 1` 不得窄成 number）；
 * - BUG-007：单个内部构造点（`static make(){ return new C() }`）不得把字段
 *   钉死成 `undefined`——那是与构造器签名自相矛盾的 unsound 窄化；
 * - BUG-033：无注解 getter 按返回值观测给类型——**只在恰有一个 return 时**；
 *   多 return（分支可能返回不同类型）保留 `unknown`，取首个会把公开类型
 *   钉得比运行时窄。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(name: string, source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-d2-"));
  dirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, source, "utf-8");
  return file;
}

function dts(file: string): string {
  const r = runCliTsx(["export", "--format", "dts", file]);
  expect(r.status).toBe(0);
  return r.stdout;
}

describe("D2 · 类字段/accessor 的公开类型来源", () => {
  it("BUG-014：注解优先于初始化器（含联合 / readonly 数组）", () => {
    const out = dts(
      fixture(
        "t8.ts",
        `export class E4 {
  x: 1 | 2 = 2;
  z: number | null = 1;
  arr: readonly number[] = [1];
}
`,
      ),
    );
    expect(out).toContain("x: 1 | 2;");
    expect(out).toContain("z: number | null;");
    expect(out).toContain("arr: readonly number[];");
  }, 60000);

  it("BUG-007：内部零实参构造不把字段钉成 undefined", () => {
    const out = dts(
      fixture(
        "p1.js",
        `export class C {\n  constructor(n) { this.n = n; }\n  static make() { return new C(); }\n}\n`,
      ),
    );
    expect(out).toContain("constructor(n: unknown)");
    expect(out).not.toMatch(/\bn: undefined;/);
    expect(out).toMatch(/\bn: unknown;/);
  }, 60000);

  it("BUG-007 对照：`new C(1)` 的内部构造同样不窄化字段", () => {
    const out = dts(
      fixture(
        "p2.js",
        `export class C {\n  constructor(n) { this.n = n; }\n  static make() { return new C(1); }\n}\n`,
      ),
    );
    expect(out).toMatch(/\bn: unknown;/);
  }, 60000);

  it("BUG-033：无注解 getter 按返回值观测（字面量 / this.<字段>）", () => {
    const out = dts(
      fixture(
        "g.js",
        `export class C {
  n = 1;
  get lit() { return 1; }
  get value() { return this.n; }
  get opaque() { return compute(); }
}
function compute() { return 1; }
`,
      ),
    );
    expect(out).toContain("get lit(): number;");
    expect(out).toContain("get value(): number;");
    // 不猜：非字面量 / 非 this.<字段> 的表达式仍是 unknown
    expect(out).toContain("get opaque(): unknown;");
  }, 60000);

  it("BUG-033 边界：多 return 的 getter 保 unknown（不取首个 return 的类型）", () => {
    const out = dts(
      fixture(
        "g2.js",
        `export class C {
  n = 1;
  flag = false;
  get branch() { if (this.flag) return this.n; return "s"; }
  get two() { if (this.flag) return 1; return 2; }
  get single() { return this.n; }
}
`,
      ),
    );
    // 多分支：首支 number、末支 string ⇒ 任一单支都不等于真实返回值集合
    expect(out).toContain("get branch(): unknown;");
    expect(out).toContain("get two(): unknown;");
    // 对照：唯一 return 仍取观测（不因这条收严而退化）
    expect(out).toContain("get single(): number;");
  }, 60000);
});
