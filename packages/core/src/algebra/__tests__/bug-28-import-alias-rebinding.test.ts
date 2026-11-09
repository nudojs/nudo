/**
 * 分册 03 · Bug 28 —— 导入函数经本地**别名 / 对象成员**再绑定后 L1 零执法。
 *
 * 根因：`bindExternal()` 把 `import { f }` 写进 `externalFn` /
 * `frame.externals`，而再绑定收集器只查**本地** `knownSet` ⇒
 * `const alias = f` 落进 `frame.names`（shadowed，fail-closed）、
 * `const o = { f }` 的成员根本不登记 ⇒ 调用点拿不到被调方。
 *
 * 修法：收集侧把「外部绑定的再绑定」登记成 `frame.externals` /
 * `frame.externalMembers`（+ 模块表），`normalizeCallee` 覆盖数组元素 /
 * 逗号 / 条件三种同源形态。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { makeFiles } from "./nudo-constraints.ts";

const LIB = `export function f(x) { return x; }
`;
const LIB_SIDE = `import { number, fn } from "@nudojs/core";
export const f = fn({ x: number().gt(0) }, number());
`;

/** 跨模块 caller：lib.js 提供 f，lib.nudo.js 提供契约 */
function check(src: string, file = "/t/forms.js") {
  const { loadModule } = makeFiles({
    "/t/lib.js": LIB,
    "/t/lib.nudo.js": LIB_SIDE,
    [file]: src,
  });
  return checkSource(file, src, pTrue, { loadModule, fromFile: file });
}

function violations(r: { issues: Array<{ code: string; actual?: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

describe("Bug 28 · 导入绑定再绑定的六条调用形态", () => {
  it("六形态（-1…-6）各报一条 nudo:constraint-violated", () => {
    const r = check(`import { f } from "./lib.js";
const alias = f;
const o = { f };
export function direct() { return f(-1); }
export function viaAlias() { return alias(-2); }
export function viaObj() { return o.f(-3); }
export function viaArr() { return [f][0](-4); }
export function viaComma() { return (0, f)(-5); }
export function viaCond(c) { return (c ? f : f)(-6); }
`);
    const v = violations(r);
    expect(v).toHaveLength(6);
    expect(v.map((i) => i.actual).join(" | ")).toContain("-6");
  });

  it.each([
    ["alias", `const alias = f; export function use() { return alias(-2); }`],
    ["对象成员", `const o = { f }; export function use() { return o.f(-3); }`],
    ["数组元素", `export function use() { return [f][0](-4); }`],
    ["逗号表达式", `export function use() { return (0, f)(-5); }`],
    ["条件表达式", `export function use() { return (1 ? f : f)(-6); }`],
  ])("%s 单独出现也报一条（import 前缀自动补）", (_name, body) => {
    const r = check(`import { f } from "./lib.js";\n${body}`);
    expect(violations(r)).toHaveLength(1);
  });

  it("负控制：导入函数收到合法实参 ⇒ 零违例（直接 / 别名 / 对象成员）", () => {
    const r = check(`import { f } from "./lib.js";
const alias = f;
const o = { f };
export function ok() { return f(1); }
export function okAlias() { return alias(2); }
export function okObj() { return o.f(3); }
`);
    expect(violations(r)).toHaveLength(0);
  });
});
