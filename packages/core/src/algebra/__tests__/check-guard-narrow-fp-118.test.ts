/**
 * 守卫臂剪影误报回归（issue #118）。
 *
 * 三种守卫形态下 optional 槽 / nullable 参数的属性读、迭代曾误报
 * nudo:entry-may-throw（1.3.10 实测）：
 *   1. 成员真值守卫：`if (report.scorecard) return report.scorecard.grade`
 *      ——truthy ⇒ 槽值非 nullish 且槽必在场（optional 摘除），此前
 *      `$get` 对 optional 槽 join(value, undef) 导致 `.grade` 撞 undefined
 *      记假 may-throw（`property 'grade' on undefined`）。
 *   2. 复合混合析取：`if (!doc || typeof doc !== 'object') return 'none'`
 *      ——穿透臂里 `!doc` 假 ⇒ doc 非 nullish；此前 compositeNullishGuardOf
 *      要求两侧都是同标识符 nullish 守卫，遇 typeof 型右操作数直接放弃，
 *      `doc.lockfileVersion` 撞 null 记假（`property … on null`）。
 *   3. 可选链守卫后迭代：`if (!files?.length) return []` ——`files?.length`
 *      truthy ⇒ files 非 nullish ⇒ for-of 可迭代；此前不识别
 *      OptionalMemberExpression 真值守卫，记假
 *      `iteration over possibly non-iterable value`。
 *
 * 修复（#118）：
 *   - stmt-predicates.ts：NullishGuard 增 memberKey（单层成员真值守卫，
 *     `o.p`/`!o.p`/`o?.p`/`!o?.p`，非计算键 + Identifier 基名）；
 *     compositeNullishGuardOf 放宽为单侧成立（另一侧 typeof 守卫/任意谓词
 *     不否定该事实；两侧同为 nullish 守卫但异名仍保守 undefined）。
 *   - 新运行时助手 $removeMemberNullish(a, key)：重建 obj slots——槽值剥
 *     nullish 成员 + 摘 optional 标记（$get 的 join(value, undef) 消失）；
 *     键缺席/非 obj/裸宿主值透传（与 $removeNullish 同契约）。
 *   - 接线：narrowNullishArmThunk 按 memberKey 发射
 *     $removeMemberNullish($removeNullish(o), key)；stmt.ts 早退提升路径
 *     cons 臂同样剪影（`if (o.p) return o.p.q` 的读在真值臂内）；
 *     expr.ts 内联三元经 nullishRemoveCallOf 分发（不再硬编码 $removeNullish）。
 *
 * 控制组（守卫剪影不越界）：无守卫的成员读/基名读/for-of 仍报 L2；
 * `!o.p` 真值臂（o.p falsy——可能是 nullish）内的读不剪仍报；两层嵌套
 * 守卫（`o.p.q` 基名非 Identifier）单层语义下不识别仍报。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";

/** issue #118 三契约形态（optional 槽 / nullable 基名 / nullable 数组） */
const NUDO_SRC = `
export const reportShape = shape({ scorecard: shape({ grade: string(), totalScore: number() }).optional() });
export const docShape = nullable(shape({ lockfileVersion: number().optional() }));
export const fileArray = nullable(array(string()));
`;

const IMP = `/// @nudo:import { reportShape, docShape, fileArray } from "./std118.nudo.js"\n`;

const opts = {
  loadModule: (spec: string) => (spec.includes("std118") ? NUDO_SRC : undefined),
  fromFile: "/test/file.js",
};

function check(src: string) {
  return checkSource("/t/guard-narrow-fp-118.js", IMP + src, pTrue, opts);
}

/** L2 entry-may-throw 的 issue 数（按函数名过滤可选） */
function l2Count(r: ReturnType<typeof check>, fn?: string): number {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn)).length;
}

function sigOf(r: ReturnType<typeof check>, fn: string): string {
  return r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
}

describe("#118 三守卫形态不再误报 entry-may-throw", () => {
  it("成员真值守卫：optional 槽真值臂内的嵌套读零 L2", () => {
    const r = check(`
/**
 * @nudo:contract report reportShape
 */
export function truthyOptional(report) { if (report.scorecard) return report.scorecard.grade; return '-'; }
`);
    expect(l2Count(r, "truthyOptional")).toBe(0);
    expect(r.summary.errors).toBe(0);
    // 守卫真值臂摘 optional 后 .grade 折 string（此前 "-" throws TypeError）
    expect(sigOf(r, "truthyOptional")).toMatch(/string/);
    expect(sigOf(r, "truthyOptional")).not.toMatch(/throws/);
  });

  it("复合混合析取守卫：穿透臂内基名读零 L2", () => {
    const r = check(`
/**
 * @nudo:contract doc docShape
 */
export function nullGuard(doc) { if (!doc || typeof doc !== 'object') return 'none'; return doc.lockfileVersion === 3 ? 'v3' : 'v2'; }
`);
    expect(l2Count(r, "nullGuard")).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "nullGuard")).toMatch(/^"none" \| "v3" \| "v2"  #exact/);
  });

  it("可选链守卫后迭代：for-of 零 L2", () => {
    const r = check(`
/**
 * @nudo:contract files fileArray
 */
export function iterFiles(files) { if (!files?.length) return []; const out = []; for (const f of files) out.push(f); return out; }
`);
    expect(l2Count(r, "iterFiles")).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "iterFiles")).not.toMatch(/throws/);
  });
});

describe("#118 守卫形态变体（其余接线点）", () => {
  it.each([
    [
      "notMemberEarlyReturn",
      `if (!report.scorecard) return '-'; return report.scorecard.grade;`,
    ],
    [
      "ternaryMember",
      `return report.scorecard ? report.scorecard.grade : '-';`,
    ],
    [
      "ifElseBothArms",
      `if (report.scorecard) { return report.scorecard.grade; } else { return '-'; }`,
    ],
    [
      "andOperand",
      `return report.scorecard && report.scorecard.grade;`,
    ],
    [
      "orOperand",
      `return !report.scorecard || report.scorecard.grade;`,
    ],
    [
      "optChainTruthyArm",
      `if (files?.length) { const out = []; for (const f of files) out.push(f); return out; } return null;`,
    ],
  ])("%s：零 L2、签名无 throws", (name, body) => {
    const filesForm = name === "optChainTruthyArm";
    const contract = filesForm ? `@nudo:contract files fileArray` : `@nudo:contract report reportShape`;
    const param = filesForm ? "files" : "report";
    const r = check(`/**\n * ${contract}\n */\nexport function ${name}(${param}) { ${body} }\n`);
    expect(l2Count(r, name)).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, name)).not.toMatch(/throws/);
  });

  it("复合合取单侧成立：`doc == null || typeof …` 穿透臂同样零 L2", () => {
    const r = check(`
/**
 * @nudo:contract doc docShape
 */
export function looseMixed(doc) { if (doc == null || typeof doc !== 'object') return 'none'; return doc.lockfileVersion; }
`);
    expect(l2Count(r, "looseMixed")).toBe(0);
    expect(sigOf(r, "looseMixed")).not.toMatch(/throws/);
  });
});

describe("#118 控制组：守卫剪枝不越界（仍报 entry-may-throw）", () => {
  it("无守卫的 optional 槽嵌套读仍报", () => {
    const r = check(`
/**
 * @nudo:contract report reportShape
 */
export function noGuardMember(report) { return report.scorecard.grade; }
`);
    expect(l2Count(r, "noGuardMember")).toBeGreaterThan(0);
  });

  it("无守卫的 nullable 基名读仍报", () => {
    const r = check(`
/**
 * @nudo:contract doc docShape
 */
export function noGuardBase(doc) { return doc.lockfileVersion === 3 ? 'v3' : 'v2'; }
`);
    expect(l2Count(r, "noGuardBase")).toBeGreaterThan(0);
  });

  it("无守卫的 nullable for-of 仍报", () => {
    const r = check(`
/**
 * @nudo:contract files fileArray
 */
export function noGuardIter(files) { const out = []; for (const f of files) out.push(f); return out; }
`);
    expect(l2Count(r, "noGuardIter")).toBeGreaterThan(0);
  });

  it("`!o.p` 真值臂（槽值 falsy，可能 nullish）内的读不剪仍报", () => {
    const r = check(`
/**
 * @nudo:contract report reportShape
 */
export function falsyArm(report) { if (!report.scorecard) return report.scorecard.grade; return '-'; }
`);
    expect(l2Count(r, "falsyArm")).toBeGreaterThan(0);
  });

  it("两层嵌套守卫（`o.p.q` 基名非 Identifier）单层语义不识别仍报", () => {
    const r = check(`
/**
 * @nudo:contract report reportShape
 */
export function nestedTwoLevel(report) { if (report.scorecard.grade) return report.scorecard.grade; return '?'; }
`);
    expect(l2Count(r, "nestedTwoLevel")).toBeGreaterThan(0);
  });
});
