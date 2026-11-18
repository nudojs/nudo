/**
 * 对象字面量方法上的函数级指令（`@nudo:contract` / `@nudo:throws`）。
 *
 * 同一条注释块里的 `@nudo:case` 一直生效（指令面按 `api.m` 建 scope），但
 * `@nudo:contract` 走的是 `check` / `refine` 的**裸名**查询（普查面按成员键
 * 推 `m`）⇒ 两条通道名字对不上 ⇒ 契约整段静默消失（签名 `x: any`、零诊断）。
 *
 * 本文件钉住两件事：
 * - 裸名能解析到**唯一的**顶层对象字面量方法 scope（契约生效）；
 * - 同名键出现在**两个**对象上时不猜（歧义 ⇒ 不绑，不得把 A 的契约套给 B）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, findFnDirectiveScope, fnDirectiveCommentLines, pTrue, parseSource } from "../index.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const FILE = "/t/obj-method-directives.js";
const SIDECAR = "export const pos = number().gt(0);\n";
const opts = sidecarOpts("obj-method-directives.nudo", SIDECAR, FILE);

const IMPORT_LINE = `/// @nudo:import { pos } from "./obj-method-directives.nudo.js"\n`;

function srcOf(body: string): string {
  return `${IMPORT_LINE}${body}`;
}

function displayOf(src: string, fn: string): string | undefined {
  return checkSource(FILE, src, pTrue, opts).signatures.find((s) => s.name === fn)?.display;
}

describe("对象字面量方法的函数级指令", () => {
  it("裸名解析到唯一对象方法 scope（`@nudo:contract` 不再整段消失）", () => {
    const src = srcOf(`export const api = {
  /**
   * @nudo:contract x pos
   */
  m(x){ return x; }
};
`);
    // 指令面按 `api.m` 建 scope；裸名查询回退到它 ⇒ 契约行回到 refine 手里
    const scope = findFnDirectiveScope(parseSource(src), "m");
    expect(scope?.name).toBe("api.m");
    expect(fnDirectiveCommentLines(src, "m")).toContain("@nudo:contract x pos");
  });

  it("`@nudo:throws` 走同一条 scope（不是只有 contract 面）", () => {
    const src = srcOf(`export const api = {
  /**
   * @nudo:throws TypeError
   */
  m(x){ return x; }
};
`);
    expect(fnDirectiveCommentLines(src, "m")).toContain("@nudo:throws TypeError");
  });

  it("同类名不冒充：`class C { m(){} }` 的 scope 是 `C.m`，裸名 `m` 不绑它", () => {
    const src = srcOf(`export class C {
  /**
   * @nudo:contract x pos
   */
  m(x){ return x; }
}
`);
    // 类方法的指令面名与普查面名一致（都是 `C.m`），裸名查不到 scope
    expect(findFnDirectiveScope(parseSource(src), "m")).toBeUndefined();
    expect(fnDirectiveCommentLines(src, "C.m")).toContain("@nudo:contract x pos");
  });

  it("歧义不猜：两个顶层对象都有 `m` ⇒ 裸名不绑（不得套错契约）", () => {
    const src = srcOf(`export const a = {
  /**
   * @nudo:contract x pos
   */
  m(x){ return x; }
};
export const b = {
  m(x){ return x; }
};
`);
    const scope = findFnDirectiveScope(parseSource(src), "m");
    expect(scope).toBeUndefined();
  });

  it("控制组：顶层具名函数的裸名查询不受影响", () => {
    const src = srcOf(`/**
 * @nudo:contract x pos
 */
export function m(x){ return x; }
`);
    expect(displayOf(src, "m")).toBe("number");
  });
});
