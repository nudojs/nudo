/**
 * 审计 34 · D6：dts 模块面投影（一次投影覆盖全部形态）。
 *
 * 八条 bug 同一根因：模块面各子路径（类型镜像 / default 槽 / 再导出 /
 * namespace）各自实现，缺分支就整条丢失。这里逐条钉住「产物里必须写出来」。
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

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-d6-"));
  dirs.push(dir);
  for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src, "utf-8");
  return dir;
}

function dts(dir: string, file: string): string {
  const r = runCliTsx(["export", "--format", "dts", join(dir, file)]);
  expect(r.status).toBe(0);
  return r.stdout;
}

describe("D6 · dts 模块面投影", () => {
  it("BUG-005：本地 interface / type 注解保留（不再退 unknown，也不谎报未声明）", () => {
    const dir = fixture({
      "a1.ts": [
        "export interface Point { x: number; y: number }",
        "export function f(p: Point): Point { return p; }",
        "export type Alias = string | number;",
        "export function g(a: Alias): Alias { return a; }",
        "",
      ].join("\n"),
    });
    const out = dts(dir, "a1.ts");
    expect(out).toContain("export interface Point { x: number; y: number }");
    expect(out).toContain("f(p: Point)");
    expect(out).toContain("g(a: Alias)");
    expect(out).not.toContain("not declared in this module");
  }, 60000);

  it("BUG-006：镜像类型声明引用的 import 要补上（否则产物自身 TS2304）", () => {
    const dir = fixture({
      "foo.ts": "export interface Foo { a: number }\n",
      "bar.ts": [
        'import type { Foo } from "./foo";',
        "export interface Bar { f: Foo }",
        "export function use(b: Bar): number { return 1; }",
        "",
      ].join("\n"),
    });
    const out = dts(dir, "bar.ts");
    expect(out).toContain('import type { Foo } from "./foo";');
    expect(out).toContain("export interface Bar { f: Foo }");
  }, 60000);

  it("BUG-009：`export default {…}` / 数组按下标形状投影（不是 object / unknown[]）", () => {
    const dir = fixture({
      "d4.ts": "export default { a: 1, b: \"s\" };\n",
      "d5.ts": "export default [1, 2, 3];\n",
    });
    const obj = dts(dir, "d4.ts");
    const arr = dts(dir, "d5.ts");
    expect(obj).toContain("{ a: number; b: string }");
    expect(arr).toContain("number[]");
  }, 60000);

  it("BUG-012：再导出导入绑定（default / 别名）必须落到产物", () => {
    const dir = fixture({
      "d.js": "export default class C { getN() { return 1; } }\n",
      "c.js": [
        'import D from "./d.js";',
        "export default D;",
        "export { D as E };",
        "export const make = () => new D(1);",
        "",
      ].join("\n"),
    });
    const out = dts(dir, "c.js");
    expect(out).toContain('export { default as default } from "./d.js";');
    expect(out).toContain('export { default as E } from "./d.js";');
  }, 60000);

  it("BUG-027：namespace 内函数的类型形参子句保留", () => {
    const dir = fixture({
      "ns.ts": "export namespace NS {\n  export function id<T>(v: T): T { return v; }\n}\n",
    });
    const out = dts(dir, "ns.ts");
    expect(out).toContain("export function id<T>(v: T): T;");
  }, 60000);

  it("BUG-031：namespace 内的 `extends` 与类型形参保留", () => {
    const dir = fixture({
      "ns2.ts": [
        "export class Base { b: string = \"s\"; }",
        "export namespace NS {",
        "  export class C extends Base { n: number = 1; }",
        "}",
        "",
      ].join("\n"),
    });
    const out = dts(dir, "ns2.ts");
    expect(out).toContain("export class C extends Base {");
  }, 60000);

  it("BUG-029：解构形参的点路径契约投影成形（不再 `_p0: unknown`）", () => {
    const dir = fixture({
      "dot.js": 'export function nestedDot({ card: { grade } }) { return grade + "#"; }\n',
      "dot.nudo.js": [
        'import { fn, string } from "@nudojs/core";',
        'export const nestedDot = fn({ "card.grade": string() }, string());',
        "",
      ].join("\n"),
    });
    const out = dts(dir, "dot.js");
    expect(out).not.toContain("_p0");
    expect(out).toContain("{ card: { grade } }: { card: { grade: string } }");
  }, 60000);

  it("BUG-030：`<fn>Input` 的顶层键是解构字段名（不是内部占位 `_p0`）", () => {
    const dir = fixture({
      "e.js": "export function nestedField({ card }) { return card.grade; }\n",
      "e.nudo.js": [
        'import { fn, shape, string } from "@nudojs/core";',
        "export const nestedField = fn({ card: shape({ grade: string() }) });",
        "",
      ].join("\n"),
    });
    const r = runCliTsx(["export", "--format", "schema", join(dir, "e.js")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("nestedFieldInput = z.object({ card:");
    expect(r.stdout).not.toContain("_p0");
  }, 60000);
});
