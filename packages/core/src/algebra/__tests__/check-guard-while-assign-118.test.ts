/**
 * 守卫收窄扩展回归（issue #118 v3 / #120）。
 *
 * 四类扩展形态此前误报 nudo:entry-may-throw（1.3.10 等价 main 实测，
 * `extractEmbeddedJs` 报 `may throw TypeError → computed member on nullish
 * (union arm)`）：
 *   1. 赋值即守卫：`while ((m = re.exec(content)))` / `if ((m = f()))`——
 *      测试真值 ⇒ 赋予 m 的值非 nullish，此前 nullishGuardOf 不认
 *      AssignmentExpression，循环/分支体内 m 携 null 臂记假 may-throw。
 *      while 路径按轮收窄：体工厂内 IIFE `((m) => { … })($removeNullish(m))`
 *      每次进体以当前绑定求 remove 串；do-while 只收窄内层 $whileSeq 体拷贝
 *      （首轮先于测试，保持未收窄）。
 *   2. 成员宽松等价守卫：`node.property == null` / `!= null`——宽松等价下
 *      缺槽 undefined 与 null 互通，比较假/真 ⇒ 槽在场且槽值非 nullish
 *      （issue #120 静态名守卫形态）；严格 `!==` 仍不识别（undefined 可能，
 *      文档化边界，见控制组 iii）。
 *   3. 多名复合：`obj == null || node.property == null` 穿透臂双事实——
 *      此前 compositeNullishGuardOf 异名保守 undefined，现 nullishGuardsOf
 *      同方向递归展开、一名一影子参数齐用（((a, b) => THUNK)(rm a, rm b)）。
 *
 * 控制组（剪影不越界）：无守卫读、循环体写守卫名（影子吞写 → 跳过收窄）、
 * 严格成员守卫、do-while 首轮读仍报 L2。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";

/** issue #118 v3 / #120 契约形态（string 入参 / string[] 收集器 / optional 槽） */
const NUDO_SRC = `
export const contentShape = string();
export const fragmentsShape = array(string());
export const nodeShape = shape({ property: shape({ name: string() }).optional() });
export const objShape = nullable(shape({ v: number() }));
`;

const IMP = `/// @nudo:import { contentShape, fragmentsShape, nodeShape, objShape } from "./std118c.nudo.js"\n`;

const opts = {
  loadModule: (spec: string) => (spec.includes("std118c") ? NUDO_SRC : undefined),
  fromFile: "/test/file.js",
};

function check(src: string) {
  return checkSource("/t/guard-while-assign-118.js", IMP + src, pTrue, opts);
}

/** L2 entry-may-throw 的 issue 数（按函数名过滤可选） */
function l2Count(r: ReturnType<typeof check>, fn?: string): number {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn)).length;
}

function sigOf(r: ReturnType<typeof check>, fn: string): string {
  return r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
}

describe("#118 v3 赋值即守卫不再误报 entry-may-throw", () => {
  it("issue #118 原始形态：while ((m = re.exec(content))) 体内 m[2] 读零 L2", () => {
    const r = check(`
/**
 * @nudo:contract content contentShape
 * @nudo:contract fragments fragmentsShape
 */
export function extractEmbeddedJs(content, fragments) {
  const re = /node\\s+(?:-e|--eval)\\s*(["'\`])([\\s\\S]*?)\\1/g;
  let m;
  while ((m = re.exec(content))) {
    if (m[2].trim().length > 0) fragments.push(m[2]);
  }
  return fragments;
}
`);
    expect(l2Count(r, "extractEmbeddedJs")).toBe(0);
    expect(r.summary.errors).toBe(0);
    // 每轮测试真值 ⇒ m 剪去 null 臂，m[2] 读不再撞 union null 臂
    expect(sigOf(r, "extractEmbeddedJs")).not.toMatch(/throws/);
  });

  it("if 赋值守卫：`if ((m = re.exec(v)))` 真值臂内 m[1] 读零 L2", () => {
    const r = check(`
/**
 * @nudo:contract v contentShape
 */
export function ifAssign(v) {
  const re = /a(b)/g;
  let m;
  if ((m = re.exec(v))) { return m[1]; }
  return null;
}
`);
    expect(l2Count(r, "ifAssign")).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "ifAssign")).not.toMatch(/throws/);
  });

  it("while 单语句体（非块）赋值守卫：m[1] 直读成员面（Bug 3 口径拆分）", () => {
    // 单语句体（非块）同样进 IIFE 收窄；块体形态见上例。
    // #118 主题（赋值即守卫压掉 m 自身的 null 臂误报）仍由上两例钉住；
    // 本例 m[1] 直读成员（元素域 any）：`.length` 修 Bug 3 后与 `.foo`
    // 同口径记录 may-throw TypeError（修前的「零 L2」是 $len 假阴面）。
    const r = check(`
/**
 * @nudo:contract v contentShape
 */
export function whileSingleStmtBody(v) {
  const re = /a(b)/g;
  let m;
  while ((m = re.exec(v))) m[1].length;
  return m;
}
`);
    expect(l2Count(r, "whileSingleStmtBody")).toBe(1);
    expect(r.summary.errors).toBe(1);
    expect(sigOf(r, "whileSingleStmtBody")).toMatch(/throws TypeError/);
  });
});

describe("#120 多名复合 / 成员宽松等价守卫不再误报", () => {
  it("`obj == null || node.property == null` 穿透臂 node.property.name 读零 L2", () => {
    const r = check(`
/**
 * @nudo:contract obj objShape
 * @nudo:contract node nodeShape
 */
export function staticName(obj, node) {
  if (obj == null || node.property == null) return null;
  return node.property.name;
}
`);
    expect(l2Count(r, "staticName")).toBe(0);
    expect(r.summary.errors).toBe(0);
    // 穿透臂双事实：obj 非 nullish + node.property 剥 nullish/摘 optional → .name 折 string
    expect(sigOf(r, "staticName")).toMatch(/^null \| string/);
    expect(sigOf(r, "staticName")).not.toMatch(/throws/);
  });

  it("内联三元接线：`(obj == null || node.property == null) ? null : node.property.name` 零 L2", () => {
    const r = check(`
/**
 * @nudo:contract obj objShape
 * @nudo:contract node nodeShape
 */
export function staticNameTernary(obj, node) {
  return (obj == null || node.property == null) ? null : node.property.name;
}
`);
    expect(l2Count(r, "staticNameTernary")).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "staticNameTernary")).not.toMatch(/throws/);
  });

  it("单臂成员宽松守卫：`if (node.property != null)` 真值臂读零 L2", () => {
    const r = check(`
/**
 * @nudo:contract node nodeShape
 */
export function looseMemberGuard(node) {
  if (node.property != null) { return node.property.name; }
  return null;
}
`);
    expect(l2Count(r, "looseMemberGuard")).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "looseMemberGuard")).not.toMatch(/throws/);
  });
});

describe("#118 v3 控制组：守卫剪枝不越界（仍报 entry-may-throw）", () => {
  it("i. 无守卫的 exec 结果下标读仍报", () => {
    const r = check(`
/**
 * @nudo:contract v contentShape
 */
export function noGuard(v) { const re = /a(b)/g; const m = re.exec(v); return m[1]; }
`);
    expect(l2Count(r, "noGuard")).toBeGreaterThan(0);
  });

  it("ii. 循环体写守卫名（影子会吞写）→ 跳过收窄仍报", () => {
    const r = check(`
/**
 * @nudo:contract v contentShape
 */
export function whileBodyWrite(v) {
  const re = /a(b)/g;
  let m;
  while ((m = re.exec(v))) { m = null; m[0]; }
  return m;
}
`);
    expect(l2Count(r, "whileBodyWrite")).toBeGreaterThan(0);
  });

  it("iii. 严格成员守卫 `node.property !== null`（undefined 仍可能）不剪仍报（文档化边界）", () => {
    const r = check(`
/**
 * @nudo:contract node nodeShape
 */
export function strictGuard(node) {
  if (node.property !== null) { return node.property.name; }
  return null;
}
`);
    expect(l2Count(r, "strictGuard")).toBeGreaterThan(0);
  });

  it("iv. do-while 首轮（先于测试求值）守卫名读不剪仍报", () => {
    const r = check(`
/**
 * @nudo:contract v contentShape
 */
export function doWhileFirstRun(v) {
  const re = /a(b)/g;
  let m;
  do { m[0]; } while ((m = re.exec(v)));
  return m;
}
`);
    expect(l2Count(r, "doWhileFirstRun")).toBeGreaterThan(0);
  });
});
