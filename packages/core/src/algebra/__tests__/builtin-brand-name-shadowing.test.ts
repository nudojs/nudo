/**
 * 用户类**遮蔽内建构造器名**时的身份判据（`class Map { … }` / `class Set { … }`）。
 *
 * 内建 brand 访问器表（`BUILTIN_BRAND_ACCESSORS`）以**实例 brand 名**建键，
 * 而用户类可以叫同一个名字（polyfill / 测试替身 / `class Set` 包装）。用户
 * 类实例上 `size` 是普通可写数据属性（类里没有内建 getter-only 访问器）⇒
 * 写门必须按**值身份**（随值携带的类规格）判定，不能只看名字。
 *
 * 反方向也要守住：真 `new Map()` 的 `size` 仍是 getter-only ⇒ 写它定抛。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";

const FILE = "/t/builtin-name-shadow.js";

function report(src: string) {
  return checkSource(FILE, src, pTrue);
}

function entryThrows(src: string): string[] {
  return report(src)
    .issues.filter((i) => i.code === "nudo:entry-may-throw")
    .map((i) => i.fn ?? "");
}

function displayOf(src: string, fn: string): string | undefined {
  return report(src).signatures.find((s) => s.name === fn)?.display;
}

describe("用户类遮蔽内建构造器名", () => {
  it("class Map + this.size = 0 ⇒ 构造器不抛、调用点签名不退 never", () => {
    const src = `export class Map { constructor() { this.size = 0; } }
export function useMap() { const m = new Map(); return m.size; }
`;
    expect(entryThrows(src)).toEqual([]);
    expect(displayOf(src, "useMap")).toBe("number");
  });

  it("class Set + this.size = 1 同理（同表另一名）", () => {
    const src = `export class Set { constructor() { this.size = 1; } }
export function useSet() { const s = new Set(); return s.size; }
`;
    expect(entryThrows(src)).toEqual([]);
    expect(displayOf(src, "useSet")).toBe("number");
  });

  it("对照：真 new Map().size 写仍定抛（内建 getter-only 访问器）", () => {
    const src = `export function realWrite() { const m = new Map(); m.size = 5; return m.size; }
`;
    expect(entryThrows(src)).toContain("realWrite");
  });

  it("对照：真 new Map() 的 set/read 面不受影响", () => {
    const src = `export function realOk() { const m = new Map(); m.set("a", 1); return m.size; }
`;
    expect(entryThrows(src)).toEqual([]);
    expect(displayOf(src, "realOk")).toBe("1");
  });

  it("对照：类名不是内建名的同类体（Foo）本就无门", () => {
    const src = `export class Foo { constructor() { this.size = 0; } }
export function useFoo() { const f = new Foo(); return f.size; }
`;
    expect(entryThrows(src)).toEqual([]);
  });
});
