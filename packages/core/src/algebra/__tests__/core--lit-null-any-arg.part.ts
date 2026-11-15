/**
 * 分册 03 · Bug 5 —— `lit(null)` 形参契约收到 `any #path` 实参（变量键查找
 * `map[k]`）时误报 `nudo:constraint-violated`（假红）。
 *
 * 根因：`scan/literal-shapes.ts` 的 nullish `eq` 通道把「实参不是 nullish
 * 字面量」直接当确定违例，缺 `any` 守卫；而同函数其它通道（typeof / eq
 * 字面量 / shape）都跳过无信息实参，`scan/literal-args.ts` 产出 `anyAbs`
 * 处也明写「any ≤ 任意目标；≠ unknown 不发明义务」。
 *
 * 既有钉 core-bug-434 只覆盖字面量实参 ⇒ 本钉补 `any #path` / `any` 形参。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDE = `import { lit } from "@nudojs/core";
export const onlyNull = lit(null);
`;
const IMP = `/// @nudo:import { onlyNull } from "./std5.nudo.js"\n`;
const FILE = "/t/bug5.js";

function check(body: string) {
  return checkSource(FILE, IMP + body, pTrue, sidecarOpts("std5", SIDE, FILE));
}

const DECL = `/** @nudo:contract x onlyNull */
export function f(x) { return 1; }
`;

function violations(r: { issues: Array<{ code: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

describe("Bug 5 · lit(null) 契约对无信息实参不发明义务", () => {
  it("变量键查找 map[k]（any #path）⇒ 零违例（改前假红）", () => {
    const r = check(`${DECL}export function anyPath(map, k) { return f(map[k]); }`);
    expect(violations(r)).toHaveLength(0);
  });

  it("any 形参作实参 ⇒ 零违例（与 any #path 同口径）", () => {
    const r = check(`${DECL}export function anyParam(x) { return f(x); }`);
    expect(violations(r)).toHaveLength(0);
  });

  it("null 字面量放行（434 不回归）", () => {
    const r = check(`${DECL}export function use() { return f(null); }`);
    expect(violations(r)).toHaveLength(0);
  });

  it("0 字面量仍判违例，expected 指向 x = null", () => {
    const r = check(`${DECL}export function use() { return f(0); }`);
    expect(violations(r)).toHaveLength(1);
    expect(r.issues.find((i) => i.code === "nudo:constraint-violated")?.expected).toBe("x = null");
  });
});
