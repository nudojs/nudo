/**
 * BUG-120 —— `<fn>Input` 的**键语义**在解构形参与普通形参上相反 ⇒
 * `plainInput` 拒绝 `.d.ts` 明文声明的调用形态。
 *
 * **口径已由 BUG-030 修正**：BUG-120 把解构形参整段收进一个以**求值占位**
 * （`_p0`）命名的槽 —— 占位名不是公共名，发布的校验器因此对唯一合法调用报
 * `required@_p0`。现口径：解构形参按**字段名**建顶层键（与 dts 声明的调用形态
 * 同形）；普通形参仍按形参名。
 *
 * 症状：解构形参 `destr({ a, b })` ⇒ `destrInput` 的顶层键是**绑定名**
 * （`{a, b}` = 实参的**值**）；普通形参 `plain(o)` ⇒ 顶层键是**形参名**
 * （`{o: …}` = 实参的**包**）⇒ 同一份导出包里两个函数的 Input 语义相反，而
 * 文档与 dts 面都是「**具名形参**」。
 *
 * 修法：解构形参的字段级契约收进**一个**槽，槽名取**形参名**
 * （`FormalParam.placeholder`，与无契约的解构分支 / 数组解构分支同口径）⇒
 * `<fn>Input` 的顶层键集合 ≡ 形参名集合（字段级槽交给元组合成的那条分支不变）。
 *
 * 钉（三个面同口径 + 顶层键 ≡ 形参名）：
 * - zod：`destrInput` / `plainInput` 的顶层键都是形参名，值都是那个对象的形状；
 * - standard：`destrInput` 的槽节点是**一个**对象槽 `_p0`；
 * - 负控制：数组解构的字段级契约仍是**元组**（Bug 394 口径不变）。
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

const SRC = [
  "export function destr({ a, b }) { return a + b; }",
  "export function plain(o) { return o.a + o.b; }",
  "",
].join("\n");

const SIDECAR = [
  'import { fn, number, string, shape } from "@nudojs/core";',
  "export const destr = fn({ a: number(), b: string() });",
  "export const plain = fn({ o: shape({ a: number(), b: string() }) });",
  "",
].join("\n");

function fixture(extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b120-"));
  dirs.push(dir);
  writeFileSync(join(dir, "lib.js"), SRC, "utf-8");
  writeFileSync(join(dir, "lib.nudo.js"), SIDECAR, "utf-8");
  for (const [name, content] of Object.entries(extra)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/**
 * 某个 `<fn>Input` 导出的 Standard Schema 节点（`__nudoCheck(<node>, value, …)`
 * 里的那段 JSON）。
 */
function inputNode(stdout: string, exportName: string): string {
  const idx = stdout.indexOf(`export const ${exportName} = {`);
  expect(idx).toBeGreaterThan(-1);
  const m = /__nudoCheck\((\{.*?\}), value, \[\], issues\)/.exec(stdout.slice(idx));
  expect(m).not.toBeNull();
  return m![1]!;
}

describe("BUG-120 / BUG-030 — `<fn>Input` 的顶层键", () => {
  // 口径（BUG-030 覆盖 BUG-120 的槽名部分）：解构形参**没有公共名**，`_p0` 是
  // 求值占位 ⇒ 公共面只允许源码里写得出来的键。解构形参因此按**字段名**建顶层
  // 键（= `.d.ts` 明文声明的调用形态 `f({ a, b })`）；普通形参仍按形参名建键。
  it("zod：解构形参按**字段名**建顶层键（不再是内部占位 `_p0`）", () => {
    const dir = fixture();
    const r = runCliTsx(["export", join(dir, "lib.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/export const destrInput = z\.object\(\{ a:/);
    expect(r.stdout).not.toContain("_p0");
    // 普通形参：形参名 `o` ⇒ 值是该对象的形状
    expect(r.stdout).toMatch(/export const plainInput = z\.object\(\{ o: z\.object\(\{ a:/);
  }, 60000);

  it("standard：解构形参的顶层槽是字段名（无占位名）", () => {
    const dir = fixture();
    const r = runCliTsx(["export", join(dir, "lib.js"), "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(inputNode(r.stdout, "destrInput")).toContain('"key":"a"');
    expect(inputNode(r.stdout, "destrInput")).not.toContain("_p0");
    expect(inputNode(r.stdout, "plainInput")).toContain('"key":"o","node":{"k":"obj"');
  }, 60000);

  it("负控制：数组解构的字段级契约仍是元组（Bug 394 口径不变）", () => {
    const dir = fixture({
      "arr.js": "export function f7([a, b]) { return a; }\n",
      "arr.nudo.js": 'import { fn, number } from "@nudojs/core";\nexport const f7 = fn({ a: number() }, number());\n',
    });
    const r = runCliTsx(["export", join(dir, "arr.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("z.tuple(");
  }, 60000);
});
