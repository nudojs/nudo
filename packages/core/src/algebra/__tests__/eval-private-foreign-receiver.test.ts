/**
 * 求值引擎私有名 foreign-obj 接收者定抛（Bug 115）：
 * 此前 privateNameGuard 的 obj 臂一律 recordMayThrow——闭 obj（对象字面量/
 * spread 产物/Object.create(null) 靶）上的 o.#p 读/写在 try 内被静默折
 * undefined/成功。原生：私有名只安装于类实例，闭 obj 访问 → 确定
 * TypeError（node 实测）。修复：闭 obj（无同名槽、无 index）→ 定抛；
 * open obj / any / sum 保留 may 档；携带同名槽（非 optional）的克隆/
 * 代理靶放行（与 brand 臂槽探测同口径）。
 */
import { describe, it, expect } from "vitest";
import { call, effects } from "./eval-helpers.ts";

const litOf = (src: string): unknown => {
  const r = call(src);
  const t = (r.result as { term?: { op?: string; value?: unknown } })?.term;
  return t?.op === "lit" ? t.value : undefined;
};

const throwsName = (r: { throws: unknown }): string | undefined =>
  (r.throws as { shape?: { k?: string; name?: string } })?.shape?.k === "never"
    ? undefined
    : (r.throws as { shape?: { name?: string } })?.shape?.name;

describe("Bug 115: private-name access on closed obj receivers", () => {
  it("闭 obj 读/写 → definite TypeError（try 捕获面与入口整抛面）", () => {
    expect(
      litOf(
        `class A { #p = 1; static check(o) { return o.#p; } } export function f() { try { return A.check({}); } catch (e) { return "caught:" + e.name; } }`,
      ),
    ).toBe("caught:TypeError");
    expect(
      litOf(
        `class A2 { #p = 1; static setp(o, v) { o.#p = v; return "ok"; } } export function f() { try { return A2.setp({}, 5); } catch (e) { return "caught:" + e.name; } }`,
      ),
    ).toBe("caught:TypeError");
    const r = call(
      `class A3 { #p = 1; static check(o) { return o.#p; } } export function f() { return A3.check(Object.create(null)); }`,
    );
    expect((r.result as { shape?: { k?: string } })?.shape?.k).toBe("never");
    expect(throwsName(r)).toBe("TypeError");
  });

  it("声明类实例 / 子类实例 / #p in / prim 接收者既有面不回归（control）", () => {
    expect(
      litOf(`class A4 { #p = 1; static check(o) { return o.#p; } } export function f() { return A4.check(new A4()); }`),
    ).toBe(1);
    expect(
      litOf(
        `class A5 { #p = 7; static check(o) { return o.#p; } } class B5 extends A5 {} export function f() { return B5.check(new B5()); }`,
      ),
    ).toBe(7);
    expect(
      litOf(
        `class A6 { #p = 1; static has(o) { return #p in o; } } export function f() { return A6.has({}) === false && A6.has(new A6()) === true; }`,
      ),
    ).toBe(true);
    expect(
      litOf(`class A7 { #p = 3; m() { return this.#p; } } export function f() { return new A7().m(); }`),
    ).toBe(3);
    expect(
      litOf(
        `class A8 { #p = 1; static check(o) { return o.#p; } } export function f() { try { return A8.check(5); } catch (e) { return "caught:" + e.name; } }`,
      ),
    ).toBe("caught:TypeError");
  });

  it("open obj / any 接收者 → may TypeError（gate 面）", () => {
    const eff = effects(`class A { #p = 1; static check(o) { return o.#p; } } export function f(o) { return A.check(o); }`);
    expect(eff).toContain("TypeError");
  });
});
