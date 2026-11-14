/**
 * 审计批次 2026-11-14 回归钉 · 类型口径与不变量（设计类）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { makeFiles } from "./nudo-constraints.ts";

const errors = (r: { issues: Array<{ severity: string; code: string }> }): string[] =>
  r.issues.filter((i) => i.severity === "error").map((i) => i.code);

describe("audit 34 · 跨槽 binder 表（BUG-018）", () => {
  const SIDE = `import { fn, any, number, bind, ref } from "@nudojs/core";
export const t = fn({ x: bind("a", number()), y: fn({ z: ref("a") }, any()) }, any());
`;
  const SRC = `export function t(x, y) { return y(x); }`;

  function run(file: string) {
    const side = file.replace(/\.js$/, ".nudo.js");
    const { loadModule } = makeFiles({ [file]: SRC, [side]: SIDE });
    return checkSource(file, SRC, pTrue, { loadModule, fromFile: file });
  }

  it("跨槽 ref(\"a\") 的 y 位是可调用契约 ⇒ 不假红", () => {
    const r = run("/t/audit-b018.js");
    expect(errors(r)).not.toContain("nudo:entry-may-throw");
  });

  it("一变量对照：把 ref 换成 any() 同样不假红", () => {
    const side2 = `import { fn, any, number, bind } from "@nudojs/core";
export const t = fn({ x: bind("a", number()), y: fn({ z: any() }, any()) }, any());
`;
    const file = "/t/audit-b018-ctl.js";
    const side = file.replace(/\.js$/, ".nudo.js");
    const { loadModule } = makeFiles({ [file]: SRC, [side]: side2 });
    expect(errors(checkSource(file, SRC, pTrue, { loadModule, fromFile: file }))).toEqual([]);
  });
});
