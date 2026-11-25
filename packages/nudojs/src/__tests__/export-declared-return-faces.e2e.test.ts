/**
 * export — 返回位在四个产物面上同源（dts / guard / standard / zod）。
 *
 * 返回位有声明注解 ⇒ dts 发布声明；校验器面（guard / standard / zod）按同一条
 * 「注解可按原文发布」判据（引用的类型名在产物里可解析、没有裸泛型类引用）取
 * `declaredReturnAbs`，否则回落观测。本文件逐夹具把四个面钉在一起：任何一面
 * 单独漂移（比如守卫还按单次调用的观测字面量校验）都会红。
 *
 * 四个面共用一份夹具、各跑一次 CLI；按场景分 `it` 断言。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli, writeSrcTsconfig } from "./helpers/run-cli.ts";

type Format = "dts" | "guard" | "standard" | "schema";
type Faces = Record<Format, string>;
const FORMATS: readonly Format[] = ["dts", "guard", "standard", "schema"];

/** zod 面的 `number` 形态（含 NaN / ±Infinity 臂）。 */
const Z_NUMBER = "z.number().or(z.nan()).or(z.literal(Infinity)).or(z.literal(-Infinity))";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const cache = new Map<string, Faces>();

/** 夹具 × 四个产物面（同一夹具只跑一次）。`extra` 是伴随文件（侧车等）。 */
function faces(key: string, src: string, extra: Record<string, string> = {}): Faces {
  const hit = cache.get(key);
  if (hit) return hit;
  const dir = mkdtempSync(join(tmpdir(), "nudo-export-declared-return-"));
  dirs.push(dir);
  writeSrcTsconfig(dir);
  for (const [name, content] of Object.entries(extra)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  const file = join(dir, "mod.ts");
  writeFileSync(file, src, "utf-8");
  const out = {} as Faces;
  for (const format of FORMATS) {
    const r = runCli(["export", file, "--format", format]);
    expect(r.status, `${format} 面 exit ${r.status}：${r.stderr}`).toBe(0);
    out[format] = r.stdout;
  }
  cache.set(key, out);
  return out;
}

/** standard 面里某个导出的校验调用行（`__nudoCheck(<Abs 的 JSON IR>, …)`）。 */
function standardCheck(standard: string, exportName: string): string {
  const start = standard.indexOf(`export const ${exportName} = {`);
  expect(start, `standard 面缺少 export const ${exportName}`).toBeGreaterThan(-1);
  const line = standard
    .slice(start)
    .split("\n")
    .find((l) => l.includes("__nudoCheck("));
  expect(line, `standard 面 ${exportName} 缺少 __nudoCheck`).toBeDefined();
  return line!.trim();
}

describe("export 四个产物面的返回位同源", () => {
  describe("声明可解析 ⇒ 校验器面与 dts 同取声明", () => {
    it("声明与实现冲突（`(): number` 而实现返回 `\"a\" | 1`）⇒ 四个面都按 `number`", () => {
      const f = faces(
        "mixed",
        `export function mixed(flag: boolean): number {
  if (flag) return "a";
  return 1;
}
mixed(true);
mixed(false);
`,
      );
      expect(f.dts).toContain("export declare function mixed(flag: boolean): number;");
      expect(f.dts).toContain(
        'nudo:return-annotation-mismatch mixed — declared "number", observed ""a" | 1"; published the declared type',
      );
      // 观测是 `"a" | 1`：按观测校验会放行字符串
      expect(f.guard).toContain('return typeof data === "number";');
      expect(f.guard).not.toContain('typeof data === "string"');
      expect(f.schema).toContain(`export const mixedOutput = ${Z_NUMBER};`);
      expect(f.schema).not.toContain("z.string()");
      expect(standardCheck(f.standard, "mixedOutput")).toBe(
        '__nudoCheck({"k":"prim","type":"number","refinements":[]}, value, [], issues);',
      );
    });

    it("`async` 声明 `Promise<number>` 而实现返回字符串 ⇒ dts 与 standard 面按声明的元素类型", () => {
      const f = faces(
        "later",
        `export async function later(): Promise<number> { return "s"; }
later();
`,
      );
      expect(f.dts).toContain("export declare function later(): Promise<number>;");
      expect(f.dts).toContain(
        'nudo:return-annotation-mismatch later — declared "Promise<number>", observed "Promise<"s">"; published the declared type',
      );
      // guard / zod 的 promise 面只做同步的 instanceof 判据（内层不展开）——与声明无关
      expect(f.guard).toContain("return data instanceof Promise;");
      expect(f.schema).toContain("laterOutput = z.custom((v) => v instanceof Promise)");
      expect(standardCheck(f.standard, "laterOutput")).toBe(
        '__nudoCheck({"k":"promise","inner":{"k":"prim","type":"number","refinements":[]}}, value, [], issues);',
      );
    });

    it("本地类（未导出）：`makeFoo(): Foo` ⇒ dts 连同私有类声明一起发布，校验器面按声明的字段校验", () => {
      const f = faces(
        "foo_class",
        `class Foo {
  x: number;
  constructor(x: number) { this.x = x; }
}
export function makeFoo(n: number): Foo { return new Foo(n); }
makeFoo(1);
`,
      );
      expect(f.dts).toContain("export declare function makeFoo(n: number): Foo;");
      expect(f.dts).toContain("declare class Foo {");
      expect(f.guard).toContain(
        '(Object.hasOwn(data, "x") || ("x" in data && !Object.hasOwn(Object.prototype, "x"))) && typeof data.x === "number";',
      );
      expect(f.schema).toContain(`export const makeFooOutput = z.object({ x: ${Z_NUMBER} });`);
      expect(standardCheck(f.standard, "makeFooOutput")).toBe(
        '__nudoCheck({"k":"obj","slots":[{"key":"x","node":{"k":"prim","type":"number","refinements":[]}}]}, value, [], issues);',
      );
    });

    it("本地接口（未导出）：`makeFoo(): Foo` ⇒ 与本地类同形态", () => {
      const f = faces(
        "foo_iface",
        `interface Foo { x: number }
export function makeFoo(n: number): Foo { return { x: n }; }
makeFoo(1);
`,
      );
      expect(f.dts).toContain("export declare function makeFoo(n: number): Foo;");
      expect(f.dts).toContain("interface Foo { x: number }");
      expect(f.guard).toContain(
        '(Object.hasOwn(data, "x") || ("x" in data && !Object.hasOwn(Object.prototype, "x"))) && typeof data.x === "number";',
      );
      expect(f.schema).toContain(`export const makeFooOutput = z.object({ x: ${Z_NUMBER} });`);
      expect(standardCheck(f.standard, "makeFooOutput")).toBe(
        '__nudoCheck({"k":"obj","slots":[{"key":"x","node":{"k":"prim","type":"number","refinements":[]}}]}, value, [], issues);',
      );
    });
  });

  describe("注解按原文立不住是唯一一类例外：四个面一起回落观测", () => {
    it("`ghost(): Missing` ⇒ dts 出 dropped 台账并发观测类型，校验器面按观测校验", () => {
      const f = faces(
        "ghost",
        `export function ghost(): Missing { return 1; }
ghost();
`,
      );
      expect(f.dts).not.toContain("ghost(): Missing");
      expect(f.dts).toContain("export declare function ghost(): number;");
      expect(f.dts).toContain("nudo:dropped-type-annotation ghost: Missing (return type)");
      expect(f.guard).toContain('return typeof data === "number";');
      expect(f.schema).toContain(`export const ghostOutput = ${Z_NUMBER};`);
      expect(standardCheck(f.standard, "ghostOutput")).toBe(
        '__nudoCheck({"k":"prim","type":"number","refinements":[]}, value, [], issues);',
      );
    });

    it("裸泛型类引用（`make(): Box` 而 `class Box<T extends string>`）⇒ 同样回落观测，但不落台账（类型名可解析）", () => {
      const f = faces(
        "bare_generic",
        `export class Box<T extends string> {
  v: T = "x" as T;
}
export function make(): Box {
  return new Box("s");
}
make();
`,
      );
      // 裸 `Box` 落进产物是 TS2314 ⇒ 注解按原文不可发布；观测面带着约束实参
      expect(f.dts).toContain("export declare function make(): Box<string>;");
      expect(f.dts).not.toMatch(/make\(\): Box;/);
      expect(f.dts).not.toContain("nudo:dropped-type-annotation");
      expect(f.dts).not.toContain("nudo:return-annotation-mismatch");
      // 校验器面与 dts 同判据 ⇒ 都按观测：观测是 brand `Box`，守卫面展开成结构 +
      // 字段判据，zod / standard 对没有运行时构造器的 brand 放行
      expect(f.guard).toContain('typeof data.v === "string");');
      expect(f.schema).toContain("export const makeOutput = z.unknown();");
      expect(standardCheck(f.standard, "makeOutput")).toBe(
        '__nudoCheck({"k":"unknown"}, value, [], issues);',
      );
    });
  });

  describe("手写契约的返回位在四个面上都压过声明", () => {
    it("契约返回 `string`、声明 `number`、实现返回字符串 ⇒ 四个面都是 `string`", () => {
      const f = faces(
        "contract",
        `/// @nudo:import { txt } from "./txt.nudo.js"
/** @nudo:contract return txt */
export function g(n: number): number { return String(n); }
g(1);
`,
        { "txt.nudo.js": `export const txt = { __nudoConstraint: true, prim: "string", preds: [] };\n` },
      );
      expect(f.dts).toContain("export declare function g(n: number): string;");
      // 契约是第三来源：不参与「实现 vs 声明」的对账
      expect(f.dts).not.toContain("return-annotation-mismatch");
      expect(f.guard).toContain('return typeof data === "string";');
      expect(f.schema).toContain("export const gOutput = z.string();");
      expect(standardCheck(f.standard, "gOutput")).toBe(
        '__nudoCheck({"k":"prim","type":"string","refinements":[]}, value, [], issues);',
      );
    });
  });
});
