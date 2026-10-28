/**
 * BUG-021 —— `nudo contract --emit` 把**一次点观测**（实参全是字面量）直接
 * 提升成契约 ⇒ `fn({ a: lit(1), b: lit(2) }, lit(3))` ⇒ 导出的 dts / zod /
 * guard 三面塌缩成那个单点字面量（`add(5, 6)` 被自己的产物判非法），且与
 * `nudo check` 的签名面（`number × number → number`）结论相反。
 *
 * 修法：观测 Abs 进投影器之前把**字面量 / 收窄谓词**剥到基类型；带断言的
 * `@nudo:case`（域声明）保持字面量。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitInterface } from "../emit/interface-emitter.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-021-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("BUG-021 —— 点观测不得成为契约域", () => {
  it("调用点字面量实参 ⇒ 投影成基类型（不是 lit(N)）", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(
      file,
      `export function add(a, b) {\n  return a + b;\n}\nexport function caller() {\n  return add(1, 2);\n}\n`,
    );
    const r = await emitInterface(file, { mode: "update", all: true });
    expect(r.written).toContain("add");
    const sidecar = readFileSync(join(dir, "lib.nudo.js"), "utf-8");
    expect(sidecar).toContain("export const add = fn({ a: number(), b: number() }, number());");
    expect(sidecar).not.toContain("lit(1)");
    expect(sidecar).not.toContain("lit(3)");
  });

  it("对照组：带断言的 @nudo:case 是域声明 ⇒ 字面量保留", async () => {
    const file = join(dir, "sub.js");
    writeFileSync(
      file,
      `/**\n * @nudo:case "c" (1, 2) => 3\n */\nexport function sub(a, b) {\n  return a - b;\n}\n`,
    );
    await emitInterface(file, { mode: "update", all: true });
    const sidecar = readFileSync(join(dir, "sub.nudo.js"), "utf-8");
    expect(sidecar).toContain("export const sub = fn({ a: lit(1), b: lit(2) }, lit(-1));");
  });
});
