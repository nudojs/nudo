/**
 * 审计批次 2026-11-14 回归钉 · 调用点 AST 形态（BUG-004 / BUG-032）。
 *
 * 两种形态在原生里与非可选 / 字符串键写法完全等价，但 check 的调用点
 * 义务收集器此前只认 CallExpression + Identifier/StringLiteral 成员键。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { makeFiles } from "./nudo-constraints.ts";

const SIDE = `import { number, fn } from "@nudojs/core";
export const positive = number().gt(0);
export const f = fn({ a: positive }, number());
export const K_m = fn({ a: positive }, number());
`;

function check(src: string, file: string) {
  const side = file.replace(/\.js$/, ".nudo.js");
  const { loadModule } = makeFiles({ [file]: src, [side]: SIDE });
  return checkSource(file, src, pTrue, { loadModule, fromFile: file });
}

const violations = (r: { issues: Array<{ code: string; fn?: string }> }) =>
  r.issues.filter((i) => i.code === "nudo:constraint-violated");

describe("audit 34 · 静态模板字面量成员键（BUG-004）", () => {
  it("c[`m`](...) 与 c[\"m\"](...) / c.m(...) 三条义务一致", () => {
    const src = [
      `export class K { m(a) { return a; } }`,
      `const c = new K();`,
      "export function tplKey() { return c[`m`](-1); }",
      `export function strKey() { return c["m"](-1); }`,
      `export function dotKey() { return c.m(-1); }`,
    ].join("\n");
    const r = check(src, "/t/audit-b004.js");
    expect(violations(r)).toHaveLength(3);
  });

  it("负控制：合法实参零违例", () => {
    const src = [
      `export class K { m(a) { return a; } }`,
      `const c = new K();`,
      "export function tplKey() { return c[`m`](1); }",
    ].join("\n");
    expect(violations(check(src, "/t/audit-b004-ok.js"))).toHaveLength(0);
  });
});

describe("audit 34 · 可选链调用（BUG-032）", () => {
  it("f?.(-1) / c?.m(-1) / c.m?.(-1) 都触发形参前置条件", () => {
    const src = [
      `export function f(a) { return a; }`,
      `f?.(-1);`,
      `export class K { m(a) { return a; } }`,
      `const c = new K();`,
      `c?.m(-1);`,
      `c.m?.(-1);`,
    ].join("\n");
    const r = check(src, "/t/audit-b032.js");
    expect(violations(r)).toHaveLength(3);
  });

  it("负控制：合法实参零违例", () => {
    const src = [
      `export function f(a) { return a; }`,
      `f?.(1);`,
      `export class K { m(a) { return a; } }`,
      `const c = new K();`,
      `c?.m(1);`,
    ].join("\n");
    expect(violations(check(src, "/t/audit-b032-ok.js"))).toHaveLength(0);
  });
});

describe("audit 34 · BUG-003 面：catch 形参的作用域", () => {
  /** `f` 的契约：`a` 必须 ≥ 0 */
  const CALLEE_SIDE = `import { fn, number } from "@nudojs/core";
export const f = fn({ a: number().ge(0) }, number());
`;
  function run(file: string, body: string) {
    const src = [`import { f } from "./f.js";`, body].join("\n");
    const { loadModule } = makeFiles({
      "/t/f.js": "export function f(a) { return a; }",
      "/t/f.nudo.js": CALLEE_SIDE,
      [file]: src,
    });
    return checkSource(file, src, pTrue, { loadModule, fromFile: file });
  }

  it("catch 形参只在 catch 块内遮蔽：之后的调用仍用外层 const（真违例不得判绿）", () => {
    const file = "/t/audit-b003-catch.js";
    const r = run(
      file,
      `const LIMIT = -1;
export function afterCatch() { try { throw 1; } catch (LIMIT) { } return f(LIMIT); }`,
    );
    expect(violations(r)).toHaveLength(1);
  });

  it("对照：catch 块内的同名形参不读外层值（不发明义务）", () => {
    const file = "/t/audit-b003-catch-ok.js";
    const r = run(
      file,
      `const LIMIT = -1;
export function insideCatch() { try { throw 1; } catch (LIMIT) { return f(LIMIT); } }`,
    );
    expect(violations(r)).toHaveLength(0);
  });
});
