import { describe, it, expect } from "vitest";
import { checkNode, nodeSlotOf } from "./env-bug-1044-1049-helpers.ts";

/**
 * 族 15 · BUG-256 — 全局 `process` 是**封闭对象**且槽表漏 `title`
 * ⇒ 读 `process.title` 得到 exact `undefined` ⇒
 * - `process.title.length` 判「确定抛 TypeError」（L2 假红，exit 1）；
 * - `typeof process.title` 折成 **`"undefined"`**（宿主 `"string"`）
 *   ⇒ 特性探测分支被**反向**折叠（控制流也错）。
 *
 * 反向钉：删掉 `title` 槽 ⇒ 本文件必挂。
 */
describe("Bug 256 — process.title is modelled", () => {
  it("host oracle: process.title is a string", () => {
    expect(typeof process.title).toBe("string");
    expect(process.title.length).toBeGreaterThan(0);
  });

  it("process.title is declared as string", () => {
    expect(nodeSlotOf("process", "title")).toBeTruthy();
  });

  it("process.title.length folds to number (was definite TypeError)", () => {
    const out = checkNode(`export function f(){ return process.title.length; }`);
    expect(out.signatures[0]!.display).toBe("number");
    expect(out.throwBrands).toEqual([]);
    expect(out.errorCodes).toEqual([]);
  });

  it("typeof process.title folds to \"string\" (was \"undefined\")", () => {
    const out = checkNode(`export function f(){ return typeof process.title; }`);
    expect(out.signatures[0]!.display).toBe('"string"');
  });

  it("control: the same expression shape on process.version stays correct", () => {
    const out = checkNode(`export function a(){ return process.version.length; }
export function b(){ return typeof process.version; }`);
    expect(out.signatures.find((s) => s.name === "a")!.display).toBe("number");
    expect(out.signatures.find((s) => s.name === "b")!.display).toBe('"string"');
    expect(out.throwBrands).toEqual([]);
  });
});
