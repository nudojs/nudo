/**
 * #136 回归：抽象 subject 的 exec 匹配结果 per-index 槽建模 + 守卫窄化。
 *
 * 1.3.15 回归 FP：`m[1].trim()` 守卫后 push 的数组元素仍带 undefined 臂
 * → array(string()) 误报 constraint-violated。三件耦合修复：
 *   (a) execRegexBrand 抽象 subject 分支：均质 element（string|undefined）
 *      的 arr → 与具体路径 matchResultAbs 同构的 per-index 槽 obj（"0"=string、
 *      "1".."ng"=string|undefined、length=numLit(1+ng)、index/input=prim、
 *      groups=具名组 obj|undefined），整体仍 null|match 二值 join；
 *   (b) memberGuardTarget 计算键数值字面量：`if (m[1])` 走既有
 *      $removeMemberNullish 槽剪影（此前计算键不识别，显式守卫不窄化）；
 *   (c) 测试式方法调用接收者非 nullish 事实：`if (m[1].trim().length > 0)`
 *      的调用求值到达 ⇒ 接收者非 nullish（nullish 臂在 .trim 成员读处
 *      throws 分流），两臂影子重绑后 `out.push(m[1])` 剥掉 undefined 臂。
 *      短路方向：`A && B` 的 B 位仅真值臂、`A || B` 的 B 位仅假值臂；
 *      `?.` 可选链短路不蕴含接收者非 nullish（控制组）。
 *
 * 诚实化不回退：无守卫直推仍 [string|undefined]（#136 修的是窄化不是放宽）；
 * 无契约（subject any）时 exec 的 ToString 强制 may TypeError 仍报 L2
 * （entry-may-throw 事实不丢）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";

/** issue #136 侧车形态：fn({ content: string() }, array(string())) */
const NUDO_SRC = `
export const contentShape = string();
export const strArr = array(string());
export const nodeShape = shape({ name: string().optional() });
`;

const IMP = `/// @nudo:import { contentShape, strArr, nodeShape } from "./std136.nudo.js"\n`;

const opts = {
  loadModule: (spec: string) => (spec.includes("std136") ? NUDO_SRC : undefined),
  fromFile: "/test/file.js",
};

function check(src: string) {
  return checkSource("/t/regex-capture-narrow-136.js", IMP + src, pTrue, opts);
}

function sigOf(r: ReturnType<typeof check>, fn: string): string {
  return r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
}

function l2Of(r: ReturnType<typeof check>, fn?: string) {
  return r.issues.filter(
    (i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn),
  );
}

describe("#136 issue 原样：守卫后 push 元素不再带 undefined 臂", () => {
  it("while + (m = re.exec(content)) + if (m[1].trim().length > 0)：0 error、返回 [string]", () => {
    const r = check(`
/**
 * @nudo:contract content contentShape
 * @nudo:contract return strArr
 */
export function rg(content) {
  const out = [];
  const re = /x(.*?)y/g;
  let m;
  while ((m = re.exec(content))) {
    if (m[1].trim().length > 0) out.push(m[1]);
  }
  return out;
}
`);
    expect(r.summary.errors).toBe(0);
    // 零迭代 [] | 至少一轮 [string]——undefined 臂已剥（修前 [string|undefined]
    // ⊭ array(string()) 误报 constraint-violated）
    expect(sigOf(r, "rg")).toBe("[string] | []  #exact");
  });

  it("同源码无侧车：仍报 entry-may-throw TypeError（.trim() nullish 臂 throws 事实不丢）", () => {
    const r = check(`
export function rg(content) {
  const out = [];
  const re = /x(.*?)y/g;
  let m;
  while ((m = re.exec(content))) {
    if (m[1].trim().length > 0) out.push(m[1]);
  }
  return out;
}
`);
    const l2 = l2Of(r, "rg");
    expect(l2).toHaveLength(1);
    expect(l2[0]!.severity).toBe("error");
    expect(l2[0]!.message).toContain("TypeError");
  });

  it("显式守卫 if (m[1] && m[1].trim().length > 0)：计算键数值下标同窄化", () => {
    const r = check(`
/**
 * @nudo:contract content contentShape
 */
export function rgExplicit(content) {
  const out = [];
  const re = /x(.*?)y/g;
  let m;
  while ((m = re.exec(content))) {
    if (m[1] && m[1].trim().length > 0) out.push(m[1]);
  }
  return out;
}
`);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "rgExplicit")).toBe("[string] | []  #exact");
  });

  it("无守卫直推 out.push(m[1])：仍 [string|undefined]（诚实化不回退）", () => {
    const r = check(`
/**
 * @nudo:contract content contentShape
 * @nudo:contract return strArr
 */
export function rgNoGuard(content) {
  const out = [];
  const re = /x(.*?)y/g;
  let m;
  while ((m = re.exec(content))) {
    out.push(m[1]);
  }
  return out;
}
`);
    // 未参与捕获组读出 undefined 是真实值域——契约违例如实报告
    expect(r.summary.errors).toBe(1);
    expect(sigOf(r, "rgNoGuard")).toContain("string | undefined");
  });
});

describe("#136 (a) 抽象匹配结果的 per-index 槽（matchResultAbs 同构）", () => {
  it("m[0]/m.length/m.index/m.input 可读且类型合理", () => {
    const r = check(`
/**
 * @nudo:contract content contentShape
 */
export function parts(content) {
  const re = /x(.*?)y/g;
  let m;
  while ((m = re.exec(content))) {
    return [m[0], m.length, m.index, m.input];
  }
  return null;
}
`);
    expect(r.summary.errors).toBe(0);
    // 1 捕获组 → length 恒 2；整匹配 string（非空命中）；index:number；
    // input:string（修前均质 arr：m[0] 也带 undefined、length/index/input unknown）
    expect(sigOf(r, "parts")).toBe("[string, 2, number, string]  #exact");
  });

  it("具名捕获组：m.groups.<name> 读 string|undefined 槽", () => {
    const r = check(`
/**
 * @nudo:contract content contentShape
 */
export function named(content) {
  const re = /x(?<g>.*?)y/g;
  let m;
  while ((m = re.exec(content))) {
    return m.groups.g;
  }
  return null;
}
`);
    expect(r.summary.errors).toBe(0);
    // 具名组槽 string|undefined（未参与捕获 undefined）；join 尾注为
    // undefAbs 的 unknown 形状显示（Bug 22 口径，非引擎债）
    expect(sigOf(r, "named")).toMatch(/^string \| undefined  #exact/);
  });

  it("具体 subject 双字面量真执行路径（matchResultAbs）行为不变", () => {
    const r = check(`
export function concrete() {
  const re = /x(.*?)y/g;
  const m = re.exec("xby");
  return [m[0], m[1], m.length, m.index, m.input];
}
`);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "concrete")).toBe('["xby", "b", 2, 0, "xby"]  #exact');
  });
});

describe("#136 (c) 方法调用接收者事实的短路方向（sound 钉）", () => {
  it("A || m[1].trim()…：真值臂（cons）无事实——undefined 保留", () => {
    const r = check(`
/**
 * @nudo:contract content contentShape
 */
export function orCons(content) {
  const re = /x(.*?)y/g;
  let m;
  while ((m = re.exec(content))) {
    if (content == null || m[1].trim().length > 0) { return m[1]; }
    else { return "-"; }
  }
  return null;
}
`);
    expect(r.summary.errors).toBe(0);
    // content == null 短路位上 B 未求值——cons 臂不可证接收者非 nullish
    expect(sigOf(r, "orCons")).toContain("undefined");
  });

  it("A || m[1].trim()…：假值臂（alt）有事实——undefined 剥离", () => {
    const r = check(`
/**
 * @nudo:contract content contentShape
 */
export function orAlt(content) {
  const re = /x(.*?)y/g;
  let m;
  while ((m = re.exec(content))) {
    if (content == null || m[1].trim().length > 0) { return "-"; }
    else { return m[1]; }
  }
  return null;
}
`);
    expect(r.summary.errors).toBe(0);
    // 整体假 ⇒ A 假且 B 求值到达 ⇒ 接收者非 nullish
    expect(sigOf(r, "orAlt")).toBe("string  #path");
  });

  it("可选链 m?.[1]?.trim()：短路不蕴含接收者非 nullish（控制组不窄化）", () => {
    const r = check(`
/**
 * @nudo:contract content contentShape
 */
export function optionalChain(content) {
  const out = [];
  const re = /x(.*?)y/g;
  let m;
  while ((m = re.exec(content))) {
    if (m?.[1]?.trim().length > 0) out.push(m[1]);
  }
  return out;
}
`);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "optionalChain")).toBe("[string | undefined] | []  #exact");
  });

  it("点成员接收者 X.p.m(…)：node.name.trim() 守卫窄化 node.name", () => {
    const r = check(`
/**
 * @nudo:contract node nodeShape
 */
export function dotRecv(node) {
  if (node.name.trim().length > 0) return node.name;
  return "-";
}
`);
    expect(r.summary.errors).toBe(0);
    // 调用求值到达 ⇒ node.name 非 nullish（修前无事实：string | undefined | "-"）
    expect(sigOf(r, "dotRecv")).toBe('string | "-"  #path');
  });

  it("接收者含调用等复杂表达式不提取（宁缺毋假）", () => {
    const r = check(`
/**
 * @nudo:contract content contentShape
 */
export function complexRecv(content) {
  const pick = () => content;
  if (pick().trim().length > 0) return content;
  return "-";
}
`);
    expect(r.summary.errors).toBe(0);
    // receiver 是 CallExpression——不提取事实（此处不涉 m 槽，只钉不崩不误窄）
    expect(sigOf(r, "complexRecv")).toBe('string | "-"  #path');
  });
});
