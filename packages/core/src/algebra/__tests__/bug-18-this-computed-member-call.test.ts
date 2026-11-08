/**
 * 分册 03 · Bug 18 —— `resolveCalleeFn` 只认 `recv.name`：类体内
 * `this.m(…)` / 静态字符串键 `c["m"](…)` / `K["s"](…)` 的类成员契约零执法。
 *
 * 根因：成员分支写死「非 computed 键 + Identifier 接收者」；`this` 是
 * `ThisExpression`、计算键的 `computed === true` ⇒ 都落不进任何分支。
 *
 * 修法：propOk 认 computed + StringLiteral 静态键；`ScopeFrame.thisClass`
 * 记录 ClassMethod 作用域所属类 ⇒ `this.m` 与 `c.m` 同一条 obligation 路径。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { makeFiles } from "./nudo-constraints.ts";

const SIDE = `import { number, fn } from "@nudojs/core";
export const positive = number().gt(0);
export const K_m = fn({ a: positive }, number());
export const K_s = fn({ a: positive }, number());
`;

function check(src: string, file: string) {
  const side = file.replace(/\.js$/, ".nudo.js");
  const { loadModule } = makeFiles({ [file]: src, [side]: SIDE });
  return checkSource(file, src, pTrue, { loadModule, fromFile: file });
}

function violations(r: { issues: Array<{ code: string; fn?: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

describe("Bug 18 · this 接收者", () => {
  it("类体内 this.m(-1) ⇒ K.m 参数契约执法（改前零诊断）", () => {
    const r = check(`export class K {
  m(a) { return a; }
  n() { return this.m(-1); }
}
`, "/t/bug18-this.js");
    const v = violations(r);
    expect(v).toHaveLength(1);
    expect(v[0]!.fn).toBe("K.m");
  });

  it("负控制：this.m(1) 合法 ⇒ 零违例", () => {
    const r = check(`export class K {
  m(a) { return a; }
  n() { return this.m(1); }
}
`, "/t/bug18-this-ok.js");
    expect(violations(r)).toHaveLength(0);
  });
});

describe("Bug 18 · 静态字符串计算键", () => {
  it('c["m"](-1) 与 c.m(-1) 同判据', () => {
    const r = check(`export class K {
  m(a) { return a; }
}
const c = new K();
export function badComputed() { return c["m"](-1); }
export function badDirect() { return c.m(-1); }
`, "/t/bug18-computed.js");
    expect(violations(r)).toHaveLength(2);
  });

  it('K["s"](-1)（静态成员）⇒ K.s 执法', () => {
    const r = check(`export class K {
  m(a) { return a; }
  static s(a) { return a; }
}
export function badStaticComputed() { return K["s"](-1); }
`, "/t/bug18-static.js");
    const v = violations(r);
    expect(v).toHaveLength(1);
    expect(v[0]!.fn).toBe("K.s");
  });
});
