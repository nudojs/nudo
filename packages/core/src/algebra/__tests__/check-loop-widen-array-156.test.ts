/**
 * issue #156：循环变异的数组绑定（`const out = []; for…of: out.push(elt)`）
 * 宽化不再伪造元素臂——`(unknown | undefined)[] | ({…} | undefined)[]` 的
 * unknown 臂（空 tuple 独自放大）与 undefined 臂（OOB marker 烘焙进元素
 * 域）都是宽化伪影：元素面从未见过这些值。
 *
 * 机制（loop-widen.ts + control.ts widenLoopJoin + postcondition.ts）：
 * - diffGrowth tuple 长度失配 → {el}（长度维增长，arr 形状抹除），宽化走
 *   arrify：元素域 = 全部观测元素域 join（空 tuple 成员贡献空）；
 * - OOB undefined 是**读位**事实（$idx 抽象下标读已并入元素 ∪ undefined，
 *   与 splice/sort 降 arr 同口径），不烘焙进元素域；
 * - 打包容器槽位 join（joinValues）不结构合并 obj 值 → sum-of-objs 里的
 *   顺序状态先 joinObjects 归一（normalizeForWiden），零元素成员不再独自
 *   放大成 arr(unknown)；
 * - postcondition：conf=widened 的 arr/tuple/obj 结构臂对 array(...)/
 *   shape(...) 契约放行进入逐元素/逐字段对账（宽化丢长度/键开闭/界与
 *   路径证据，不丢结构域；叶子带界义务照旧 unprovable）。
 *
 * 对照干净：`xs.map((x) => ({ v: x }))` 不经 loop-widen（{ v: string }[]）。
 * 守卫：interrupted（break 打断、效应不可观测）保持诚实 unknown[] 顶；
 * 带界元素契约（number().gt(0)）对宽化元素仍 unprovable（#151 口径）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, runTranspiled, callTranspiledExportFull, abs, formatShape } from "../index.ts";

/** issue #156 契约形态（元素 shape / 元素带界 / 混合域 / obj 槽位） */
const NUDO_SRC = `
export const strArr = array(string());
export const findingsV = array(shape({ v: string() }));
export const posArr = array(number().gt(0));
export const numOrV = array(union(shape({ v: string() }), number()));
`;

const IMP = `/// @nudo:import { strArr, findingsV, posArr, numOrV } from "./std156.nudo.js"\n`;

const opts = {
  loadModule: (spec: string) => (spec.includes("std156") ? NUDO_SRC : undefined),
  fromFile: "/test/file.js",
};

function check(src: string) {
  return checkSource("/t/loop-widen-array-156.js", IMP + src, pTrue, opts);
}

/** @nudo:contract return 后置诊断（unproven-return warning / violated error） */
function retIssues(r: ReturnType<typeof check>) {
  return r.issues.filter((i) => i.message.includes("@nudo:contract return"));
}

const strArrAbs = abs(
  { k: "arr", element: abs({ k: "prim", type: "string" }, undefined, undefined, "exact") },
  undefined,
  undefined,
  "exact",
);
const unknownAbs = abs({ k: "unknown" }, undefined, undefined, "exact");
const arrUnknownAbs = abs(
  { k: "arr", element: unknownAbs },
  undefined,
  undefined,
  "exact",
);

function evalOf(src: string, args: unknown[] = [strArrAbs]): string {
  const run = runTranspiled(src, { mode: "analyze" });
  const r = callTranspiledExportFull(run, "f", args as never) as { result: unknown };
  return formatShape(r.result as never);
}

describe("issue #156：for…of + push 的元素域宽化（eval 面）", () => {
  it("m1 复现：out.push({ v: x }) → { v: string }[]（无 unknown/undefined 臂）", () => {
    const s = evalOf(
      `export function f(xs) { const out = []; for (const x of xs) out.push({ v: x }); return out; }`,
    );
    expect(s).toBe("{ v: string }[]");
    expect(s).not.toContain("unknown");
    expect(s).not.toContain("undefined");
  });

  it("m2 混合 push 域：元素域 = 观测元素 join（obj | number）", () => {
    const s = evalOf(
      `export function f(xs) { const out = []; for (const x of xs) { out.push({ v: x }); out.push(1); } return out; }`,
    );
    expect(s).toBe("({ v: string } | number)[]");
  });

  it("空体 / join-幂等绑定不动：[] #exact", () => {
    expect(evalOf(`export function f(xs) { const out = []; for (const x of xs) {} return out; }`)).toBe("[]");
  });

  it("for(;;) / 计数循环同口径（control 路径不再烘焙 OOB undefined）", () => {
    const s = evalOf(
      `export function f(xs) { const out = []; for (let i = 0; i < xs.length; i++) out.push({ v: xs[i] }); return out; }`,
    );
    expect(s).toBe("{ v: string }[]");
  });

  it("obj 槽位绑定：acc.list.push(x) → { list: string[] }（顺序状态归一，不放大零元素成员）", () => {
    expect(
      evalOf(`export function f(xs) { const acc = { list: [] }; for (const x of xs) acc.list.push(x); return acc; }`),
    ).toBe("{ list: string[] }");
    expect(
      evalOf(`export function f(xs) { const acc = { list: [] }; for (let i = 0; i < xs.length; i++) acc.list.push(xs[i]); return acc; }`),
    ).toBe("{ list: string[] }");
  });

  it("稳定字面量 push：元素域不取顶（1[]，原生全体为 1）", () => {
    expect(
      evalOf(`export function f(xs) { const out = [1]; for (const x of xs) out.push(1); return out; }`),
    ).toBe("1[]");
  });

  it("增长计数器 push：元素值域取顶（number[]，无假字面量上界）", () => {
    expect(
      evalOf(`export function f(xs) { const out = []; let i = 0; for (const x of xs) { out.push(i); i++; } return out; }`),
    ).toBe("number[]");
  });

  it("抽象下标读回仍并入 OOB undefined（读位事实保留）", () => {
    const s = evalOf(
      `export function f(xs) { const out = []; for (const x of xs) out.push(x); return out[xs.length]; }`,
    );
    // out[xs.length]：抽象下标 → string | undefined（marker 不因元素域去 undefined 而丢）
    expect(s).toContain("string");
    expect(s).toContain("undefined");
  });

  it("interrupted（break 打断代表体）：诚实 unknown[] 顶（未观测 push 仍可能）", () => {
    const s = evalOf(
      `export function f(xs) { const out = []; for (const x of xs) { if (x === "z") break; out.push({ v: x }); } return out; }`,
    );
    expect(s).toBe("unknown[]");
  });

  it("对照：map 链不经 loop-widen（{ v: string }[]）", () => {
    expect(evalOf(`export function f(xs) { return xs.map((x) => ({ v: x })); }`)).toBe("{ v: string }[]");
  });
});

describe("issue #156 残留：参数位数组绑定的顺序状态收敛（无增长路径）", () => {
  it("r1 for-of + 参数位 arr(unknown)：单臂（元素域并），不再摊成 unknown[] | … 双臂", () => {
    const s = evalOf(
      `export function f(xs, out) { for (const x of xs) out.push({ v: x }); return out; }`,
      [strArrAbs, arrUnknownAbs],
    );
    expect(s).toBe("(unknown | { v: string })[]");
  });

  it("r2 for(;;) + 参数位 arr(unknown)：control 循环同口径（widenFinal 累计 join 不再摊回）", () => {
    const s = evalOf(
      `export function f(xs, out) { for (let i = 0; i < xs.length; i++) out.push({ v: xs[i] }); return out; }`,
      [strArrAbs, arrUnknownAbs],
    );
    expect(s).toBe("(unknown | { v: string })[]");
  });

  it("r3 while + 参数位 arr(unknown)：单臂", () => {
    const s = evalOf(
      `export function f(xs, out) { let i = 0; while (i < xs.length) { out.push({ v: xs[i] }); i++; } return out; }`,
      [strArrAbs, arrUnknownAbs],
    );
    expect(s).toBe("(unknown | { v: string })[]");
  });

  it("r4 本地拷贝 const acc = [...out]：同口径收敛", () => {
    const s = evalOf(
      `export function f(xs, out) { const acc = [...out]; for (const x of xs) acc.push({ v: x }); return acc; }`,
      [strArrAbs, arrUnknownAbs],
    );
    expect(s).toBe("(unknown | { v: string })[]");
  });

  it("r5 参数位 arr 元素域已知（{ v: string }）：join-幂等，exact 单臂不变", () => {
    const objV = abs(
      { k: "obj", slots: { v: { value: abs({ k: "prim", type: "string" }, undefined, undefined, "exact") } } },
      undefined,
      undefined,
      "exact",
    );
    const arrV = abs({ k: "arr", element: objV }, undefined, undefined, "exact");
    const s = evalOf(
      `export function f(xs, out) { for (const x of xs) out.push({ v: x }); return out; }`,
      [strArrAbs, arrV],
    );
    expect(s).toBe("{ v: string }[]");
  });

  it("r6 收敛只动数组族：计数器 prim-sum（0 | 1）不被折叠", () => {
    const s = evalOf(
      `export function f(xs) { let n = 0; for (const x of xs) n++; return n; }`,
    );
    // 计数器增长走 domainTop（number），但若绑定 join-幂等（n++ 被吸收前
    // 的快照）不得把 prim-sum 当数组收敛
    expect(s).toBe("number");
  });
});

describe("issue #156：宽化结构臂对 array/shape 契约可证（check 面）", () => {
  it("复现契约证得：array(shape({ v: string() })) 无 unproven-return", () => {
    const r = check(`
/**
 * @nudo:contract xs strArr
 * @nudo:contract return findingsV
 */
export function one(xs) {
  const out = [];
  for (const x of xs) out.push({ v: x });
  return out;
}
`);
    expect(r.summary.errors).toBe(0);
    expect(retIssues(r)).toEqual([]);
  });

  it("参数位数组绑定：out 带元素契约，循环 push 后 return 证得（残留收敛后无假臂）", () => {
    const r = check(`
/**
 * @nudo:contract xs strArr
 * @nudo:contract out findingsV
 * @nudo:contract return findingsV
 */
export function one(xs, out) {
  for (const x of xs) out.push({ v: x });
  return out;
}
`);
    expect(r.summary.errors).toBe(0);
    expect(retIssues(r)).toEqual([]);
  });

  it("union 元素契约：array(union(shape({v:string()}), number())) 证得", () => {
    const r = check(`
/**
 * @nudo:contract xs strArr
 * @nudo:contract return numOrV
 */
export function one(xs) {
  const out = [];
  for (const x of xs) { out.push({ v: x }); out.push(1); }
  return out;
}
`);
    expect(retIssues(r)).toEqual([]);
  });

  it("带界元素契约守卫：array(number().gt(0)) 对宽化元素仍 unprovable（warning 非 error）", () => {
    const r = check(`
/**
 * @nudo:contract xs strArr
 * @nudo:contract return posArr
 */
export function one(xs) {
  const out = [];
  let i = 0;
  for (const x of xs) { out.push(i); i++; }
  return out;
}
`);
    const issues = retIssues(r);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
    expect(r.summary.errors).toBe(0);
  });

  it("错配元素域守卫：string 元素对 array(shape({v:string()})) 不 proved 也不 error（#151 错配口径）", () => {
    const r = check(`
/**
 * @nudo:contract xs strArr
 * @nudo:contract return findingsV
 */
export function one(xs) {
  const out = [];
  for (const x of xs) out.push(x);
  return out;
}
`);
    const issues = retIssues(r);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
    expect(r.summary.errors).toBe(0);
  });

  it("参数无契约（any）：元素 unknown → 诚实 unprovable，不伪装成功", () => {
    const r = check(`
/**
 * @nudo:contract return findingsV
 */
export function one(xs) {
  const out = [];
  for (const x of xs) out.push({ v: x });
  return out;
}
`);
    expect(retIssues(r)).toHaveLength(1);
  });
});
