/**
 * 族 29 · Bug 893：`statSync` / `fs.promises.stat` 的**返回域声明过窄**
 * ——原生 `statSync(p, { throwIfNoEntry: false })` 在路径不存在时**返回
 * undefined**（不抛），紧接着的成员读**必抛 TypeError**；旧面把返回域声明成
 * 「永不返回 undefined」⇒ 引擎判「不抛」还给出**自信的** `boolean` / `number`
 * ——**L2 假绿**。
 *
 * 修法：`throwIfNoEntry: false` 时返回域含 `undefined`（同步族与 promise 族
 * 同口径）。
 *
 * 原生 oracle（Node v26）：
 * - `fs.statSync("/nope", { throwIfNoEntry: false })` ⇒ `undefined`；
 * - `fs.statSync("/nope", { throwIfNoEntry: false }).isFile()` ⇒ TypeError；
 * - `fs.statSync("/nope")` ⇒ 抛 `Error`（code=ENOENT）。
 */
import { describe, it, expect } from "vitest";
import { boolLit, formatShape, objOf, strLit, type Abs } from "@nudojs/core";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { callSite, envMember } from "./env-bug-s3-helpers.ts";

/** promise 兑现值的内层（`promiseOf(x)` ⇒ x）。 */
function promiseInner(a: unknown): Abs | undefined {
  if (!a) return undefined;
  const s = (a as Abs).shape as { k?: string; inner?: Abs };
  return s.k === "eff" ? s.inner : undefined;
}

/** `{ throwIfNoEntry: false }` 选项对象。 */
const NO_ENTRY = objOf({ throwIfNoEntry: { value: boolLit(false) } });

describe("Bug 893 · statSync / fs.promises.stat 的返回域（含 undefined 分支）", () => {
  it("1. 原生 oracle：throwIfNoEntry:false ⇒ 返回 undefined（不抛）", () => {
    expect(fs.statSync("/nope/nope.txt", { throwIfNoEntry: false })).toBeUndefined();
    expect(() => fs.statSync("/nope/nope.txt")).toThrow();
  });

  it("2. 原生 oracle：undefined 上的成员读 ⇒ TypeError（返回域必须含 undefined）", () => {
    const st = fs.statSync("/nope/nope.txt", { throwIfNoEntry: false });
    expect(() => (st as { isFile: () => boolean }).isFile()).toThrow(TypeError);
  });

  it("3. 引擎侧：throwIfNoEntry:false ⇒ 返回域含 undefined（旧面：永不 undefined）", () => {
    const site = callSite(envMember("node:fs", "statSync"), [strLit("/nope/nope.txt"), NO_ENTRY]);
    expect(site.value, "应给出值面").toBeDefined();
    expect(formatShape(site.value!), "返回域应含 undefined").toContain("undefined");
  });

  it("4. 反向钉：默认形态（无 throwIfNoEntry:false）⇒ 返回域不含 undefined", () => {
    const site = callSite(envMember("node:fs", "statSync"), [strLit("/tmp")]);
    expect(site.value).toBeDefined();
    expect(formatShape(site.value!), "默认形态不该含 undefined").not.toContain("undefined");
  });

  it("5. promise 族同口径：兑现值含 undefined", async () => {
    expect(await fsp.stat("/nope/nope.txt", { throwIfNoEntry: false })).toBeUndefined();
    const site = callSite(envMember("node:fs/promises", "stat"), [strLit("/nope/nope.txt"), NO_ENTRY]);
    const inner = promiseInner(site.value);
    expect(inner, "兑现值应有内层").toBeDefined();
    expect(formatShape(inner!), "兑现值域应含 undefined").toContain("undefined");
  });

  it("6. 反向钉：promise 族默认形态 ⇒ 兑现值不含 undefined", () => {
    const site = callSite(envMember("node:fs/promises", "stat"), [strLit("/tmp")]);
    const inner = promiseInner(site.value);
    expect(formatShape(inner!), "默认形态不该含 undefined").not.toContain("undefined");
  });

  it("7. 声明面：返回域的 undefined 分支由调用点的 options 决定（不是恒有）", () => {
    // 声明的返回类型仍是 Stats（不含 undefined）——undefined 只在
    // throwIfNoEntry:false 的调用点出现（旧面的「永不 undefined」就在这里）
    const declared = envMember("node:fs", "statSync").shape as { returnType?: Abs };
    expect(formatShape(declared.returnType!), "声明面不该含 undefined").not.toContain("undefined");
  });
});
