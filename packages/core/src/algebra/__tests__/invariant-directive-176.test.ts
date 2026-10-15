/**
 * issue #176：`@nudo:invariant <name><path> <rel> <number>` 循环携带界。
 * assume 的循环类比物：用户供引理（如 `dp[*][*] >= 0`），引擎在循环
 * join/宽化位（widenLoopJoin / widenFinal）按绑定名实施强化；证明依赖了
 * 它时上屏 `nudo:invariant-relied` info 审计。本套件钉：
 * - 主靶（levenshtein 型 DP + if-guard）：证得 + relied；对照（无指令）
 *   与无 guard 原样版（OOB 诚实面）仍 unproven
 * - 标量形态（W1：`last = j` 循环携带）
 * - 文法/绑定名校验 → warning nudo:invariant-invalid（issue 结构）
 * - 槽（currentInvariantSpecs / withInvariantSpecs）set/restore/嵌套/异常
 *   + callAtFunctionBoundary 边界清空（callee 帧不继承）
 * - 跨帧护栏：caller 声明 invariant，callee 同名循环局部不受染（unsound
 *   假证明指纹 = proved via @nudo:invariant）
 * - applyInvariantsToPack 单元（下钻/叶子/lit 不改写/非 obj 直通）
 * - 无 invariant → 零 nudo:invariant-* 诊断
 *
 * 全部相对路径导入（单一模块实例）：vitest 的 @nudojs/core alias 与相对
 * 导入是两个实例——会话槽（state.ts 模块级 let）跨实例不可见（#152 教训）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import {
  currentInvariantSpecs,
  withInvariantSpecs,
  callAtFunctionBoundary,
} from "../exec/runtime/state.ts";
import { applyInvariantsToPack } from "../exec/runtime/invariant-apply.ts";
import { abs, num, str } from "../abs.ts";
import { lit } from "../term.ts";
import { predToString } from "../pred.ts";
import type { Abs } from "../abs.ts";

function checkOf(src: string, opts: Record<string, unknown> = {}) {
  return checkSource("/t/invariant.js", src, pTrue, opts);
}

const sidecarOpts = (sidecar: string) => ({
  loadModule: (spec: string) => (spec.endsWith(".nudo.js") ? sidecar : undefined),
  fromFile: "/t/invariant.js",
});

// ---------------------------------------------------------------------------
// 主靶：levenshtein 型 DP（循环携带界引擎诚实证不出的 research-grade 场景）
// ---------------------------------------------------------------------------

const levenshteinBody = `
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  const out = dp[m][n];
  if (out === undefined) return 0;
  return out;
`;

const levOpts = sidecarOpts(
  `export const levenshtein = fn({ a: string(), b: string() }, number().ge(0));`,
);

describe("@nudo:invariant 主靶（levenshtein 型 DP）", () => {
  it("dp[*][*] >= 0 + 侧车 ge(0) → 证得 + invariant-relied 审计", () => {
    const r = checkOf(
      `
/**
 * @nudo:invariant dp[*][*] >= 0
 */
export function levenshtein(a, b) {${levenshteinBody}}
`,
      levOpts,
    );
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
    const relied = r.issues.find((i) => i.code === "nudo:invariant-relied");
    expect(relied).toBeDefined();
    expect(relied!.severity).toBe("info");
    expect(relied!.fn).toBe("levenshtein");
    expect(relied!.message).toContain("proved via @nudo:invariant dp[*][*] >= 0");
    expect(relied!.suggestion).toContain("@nudo:case");
    expect(r.issues.some((i) => i.code === "nudo:invariant-invalid")).toBe(false);
  });

  it("对照（无 invariant）：unproven-return 诚实上报，无 relied", () => {
    const r = checkOf(
      `
export function levenshtein(a, b) {${levenshteinBody}}
`,
      levOpts,
    );
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(true);
    expect(r.issues.some((i) => i.code === "nudo:invariant-relied")).toBe(false);
  });

  it("无 if-guard 原样版：OOB 读位诚实面（number | undefined）仍不可证", () => {
    // 内层 row 域长度不可知——dp[m][n] 抽象下标读并 undefined 是读位事实，
    // invariant 只强化元素值域，不抹 OOB 面：返回契约仍证不出（诚实）
    const r = checkOf(
      `
/**
 * @nudo:invariant dp[*][*] >= 0
 */
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[m][n];
}
`,
      levOpts,
    );
    expect(r.issues.some((i) => i.code === "nudo:invariant-relied")).toBe(false);
    const unproven = r.issues.find(
      (i) => i.code === "nudo:unproven-return" || i.code === "nudo:constraint-violated",
    );
    expect(unproven).toBeDefined();
    if (unproven!.code === "nudo:unproven-return") {
      expect(unproven!.actual).toContain("undefined");
    }
  });
});

// ---------------------------------------------------------------------------
// 标量形态（W1）：循环变量区间宽化丢失的最小场景
// ---------------------------------------------------------------------------

describe("@nudo:invariant 标量形态", () => {
  const scalarSrc = (directive: string) => `
/**
 * ${directive}
 */
export function lastLoop(n) {
  let last = 0;
  for (let j = 1; j <= n; j++) last = j;
  return last;
}
`;
  const scalarOpts = sidecarOpts(
    `export const lastLoop = fn({ n: number() }, number().ge(1));`,
  );

  it("last >= 1 + 契约 ge(1) → 证得 + relied", () => {
    const r = checkOf(scalarSrc("@nudo:invariant last >= 1"), scalarOpts);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
    const relied = r.issues.find((i) => i.code === "nudo:invariant-relied");
    expect(relied).toBeDefined();
    expect(relied!.message).toContain("proved via @nudo:invariant last >= 1");
  });

  it("声明弱界（>= 0）不得证明强契约（ge(1)）：方向性诚实", () => {
    const r = checkOf(scalarSrc("@nudo:invariant last >= 0"), scalarOpts);
    // F3 既有口径：ret.pred 存在却不蕴含 → 「确定不满足」error（约束证据
    // 不满足义务），而非 unprovable warning——与 assume 播种的 pred 同语义。
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
    expect(r.issues.some((i) => i.code === "nudo:invariant-relied")).toBe(false);
  });

  it("对照（完全无指令）：unproven + 零 nudo:invariant-* 诊断", () => {
    const r = checkOf(scalarSrc(""), scalarOpts);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(true);
    expect(r.issues.some((i) => i.code.startsWith("nudo:invariant"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 解析与校验（nudo:invariant-invalid，warning）
// ---------------------------------------------------------------------------

describe("@nudo:invariant 校验诊断（nudo:invariant-invalid）", () => {
  it.each([["dp[*][*] == 0"], ["dp >= string"], ["dp[0] >= 0"], ["dp >="]])(
    "非法文法 %s → warning（非 error，report.ok 不受影响）",
    (seg) => {
      const r = checkOf(`
/**
 * @nudo:invariant ${seg}
 */
export function levenshtein(a, b) {${levenshteinBody}}
`);
      const bad = r.issues.find((i) => i.code === "nudo:invariant-invalid");
      expect(bad, seg).toBeDefined();
      expect(bad!.severity).toBe("warning");
      expect(bad!.fn).toBe("levenshtein");
      expect(bad!.actual).toBe(seg);
      expect(bad!.expected).toBe("<name><path> <rel> <number>");
      // warning 级（非 error）：invalid 不影响 report.ok 的 error 语义
      expect(r.issues.some((i) => i.code === "nudo:invariant-invalid" && i.severity === "error")).toBe(false);
    },
  );

  it("行尾残留 `*/` 被剥（JSDoc 块内同形）", () => {
    const r = checkOf(`
/**
 * @nudo:invariant dp[*] >= 0 */
export function f(a) {
  const dp = [a];
  return dp;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:invariant-invalid")).toEqual([]);
  });

  it("未绑定名 → warning（expected 列形参 ∪ 顶层局部）", () => {
    const r = checkOf(`
/**
 * @nudo:invariant zz[*] >= 0
 */
export function levenshtein(a, b) {${levenshteinBody}}
`);
    const bad = r.issues.find((i) => i.code === "nudo:invariant-invalid");
    expect(bad).toBeDefined();
    expect(bad!.actual).toBe("zz");
    expect(bad!.expected).toContain("a");
    expect(bad!.expected).toContain("dp");
  });

  it("负数界 / .ident 路径 / 多行合法段全部消费", () => {
    const r = checkOf(`
/**
 * @nudo:invariant dp[*] >= -1
 * @nudo:invariant dp[*][*] >= 0
 */
export function levenshtein(a, b) {${levenshteinBody}}
`, levOpts);
    expect(r.issues.filter((i) => i.code === "nudo:invariant-invalid")).toEqual([]);
    const relied = r.issues.find((i) => i.code === "nudo:invariant-relied");
    expect(relied).toBeDefined();
    expect(relied!.message).toContain("dp[*] >= -1");
    expect(relied!.message).toContain("dp[*][*] >= 0");
  });

  it("字符串里的同形文本 / 句中散文不是指令", () => {
    const r = checkOf(`
export function f(a) {
  return "@nudo:invariant a[*] >= 0";
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:invariant-invalid")).toEqual([]);

    const r2 = checkOf(`
/**
 * 讨论：@nudo:invariant dp >= 0 之后 DP 界可证 —— 但这是文档散文。
 */
export function g(a) {
  return a;
}
`);
    expect(r2.issues.filter((i) => i.code === "nudo:invariant-invalid")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 槽语义 + 调用边界清空
// ---------------------------------------------------------------------------

describe("invariant 槽（currentInvariantSpecs / withInvariantSpecs）", () => {
  const spec = { name: "dp", path: [{ k: "idx" as const }], rel: "ge" as const, value: 0 };

  it("默认空；scoped set/restore", () => {
    expect(currentInvariantSpecs()).toEqual([]);
    withInvariantSpecs([spec], () => {
      expect(currentInvariantSpecs()).toEqual([spec]);
    });
    expect(currentInvariantSpecs()).toEqual([]);
  });

  it("嵌套 restore 顺序正确 + 异常路径也恢复", () => {
    const inner = { ...spec, name: "x" };
    withInvariantSpecs([spec], () => {
      withInvariantSpecs([inner], () => {
        expect(currentInvariantSpecs()).toEqual([inner]);
      });
      expect(currentInvariantSpecs()).toEqual([spec]);
      try {
        withInvariantSpecs([inner], () => {
          throw new Error("boom");
        });
      } catch {
        /* 吞掉验恢复 */
      }
      expect(currentInvariantSpecs()).toEqual([spec]);
    });
    expect(currentInvariantSpecs()).toEqual([]);
  });

  it("callAtFunctionBoundary：callee 帧见空，边界退出还原 caller 值", () => {
    withInvariantSpecs([spec], () => {
      const seen = callAtFunctionBoundary(() => currentInvariantSpecs());
      expect(seen).toEqual([]);
      expect(currentInvariantSpecs()).toEqual([spec]);
    });
  });
});

// ---------------------------------------------------------------------------
// 跨帧护栏（unsound 假证明守卫，镜像 #152 adoption 碰撞测试）
// ---------------------------------------------------------------------------

describe("@nudo:invariant 跨帧护栏（callee 同名局部不受染）", () => {
  // 指纹：若 caller 的 specs 泄进 negLoop 帧（callAtFunctionBoundary 未清
  // 空），negLoop 的循环携带 last 被强化 ge(·,1) → caller 的 ge(1) 返回
  // 契约翻成 proved via @nudo:invariant（假证明——negLoop 诚实返回 -j ≤ -1）。
  // caller 自身的 last 是合法锚定面（顶层 let 局部 + 自有循环消费）。
  const src = `
export function negLoop(k) {
  let last = 0;
  for (let j = 1; j <= k; j++) last = 0 - j;
  return last;
}
/**
 * @nudo:invariant last >= 1
 */
export function caller(k) {
  let last = 0;
  for (let j = 0; j < 1; j++) last = k;
  const w = negLoop(k);
  return w;
}
`;
  const opts = sidecarOpts(`export const caller = fn({ k: number() }, number().ge(1));`);

  it("callee 帧内同名 last 不吃 caller 的 invariant：无 relied 假证明，仍 unproven", () => {
    const r = checkOf(src, opts);
    expect(r.issues.some((i) => i.code === "nudo:invariant-relied")).toBe(false);
    expect(
      r.issues.some(
        (i) =>
          (i.code === "nudo:unproven-return" || i.code === "nudo:constraint-violated") &&
          i.fn === "caller",
      ),
    ).toBe(true);
  });

  it("negLoop 自身（未声明 invariant）零 nudo:invariant-* 诊断", () => {
    const r = checkOf(src, opts);
    expect(
      r.issues.filter((i) => i.code.startsWith("nudo:invariant")).map((i) => i.fn),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyInvariantsToPack 单元（下钻 / 叶子 / lit 不改写 / 非 obj 直通）
// ---------------------------------------------------------------------------

describe("applyInvariantsToPack 单元", () => {
  const widenNum = (): Abs => abs(num().shape, undefined, undefined, "widened");
  const dpPack = (): Abs => {
    const cell = widenNum();
    const row = abs({ k: "arr", element: cell }, undefined, undefined, "widened");
    const grid = abs({ k: "arr", element: row }, undefined, undefined, "widened");
    return abs(
      { k: "obj", slots: { dp: { value: grid }, other: { value: widenNum() } } },
      undefined,
      undefined,
      "widened",
    );
  };
  const spec2 = {
    name: "dp",
    path: [{ k: "idx" as const }, { k: "idx" as const }],
    rel: "ge" as const,
    value: 0,
  };

  it("dp[*][*] >= 0：下钻到数值叶子 mint var + ge pred；他槽不动", () => {
    const before = dpPack();
    const otherBefore = (before.shape as { slots: Record<string, { value: Abs }> }).slots
      .other!.value;
    const r = withInvariantSpecs([spec2], () => applyInvariantsToPack(before));
    const slots = (r.shape as { slots: Record<string, { value: Abs }> }).slots;
    const grid = slots.dp!.value;
    const row = (grid.shape as { element: Abs }).element;
    const cell = (row.shape as { element: Abs }).element;
    expect(cell.term?.op).toBe("var");
    expect(String((cell.term as { id?: string }).id)).toMatch(/^inv#\d+$/);
    expect(predToString(cell.pred!)).toContain("≥ 0");
    // other 槽不匹配 spec：值恒等（未动）
    expect(slots.other!.value).toBe(otherBefore);
  });

  it("叶子带既有 term/var：复用 term，pred 并集", async () => {
    const { v } = await import("../term.ts");
    const { ge } = await import("../pred.ts");
    const cell = abs(num().shape, v("dp11"), ge(v("dp11"), lit(1)), "path");
    const row = abs({ k: "arr", element: cell }, undefined, undefined, "path");
    const pack = abs(
      { k: "obj", slots: { dp: { value: row } } },
      undefined,
      undefined,
      "path",
    );
    const r = withInvariantSpecs(
      [{ name: "dp", path: [{ k: "idx" }], rel: "le", value: 10 }],
      () => applyInvariantsToPack(pack),
    );
    const leaf = ((r.shape as { slots: Record<string, { value: Abs }> }).slots.dp!.value
      .shape as { element: Abs }).element;
    expect(leaf.term?.op).toBe("var");
    expect((leaf.term as { id?: string }).id).toBe("dp11");
    expect(predToString(leaf.pred!)).toContain("≤ 10");
    expect(predToString(leaf.pred!)).toContain("≥ 1");
  });

  it("lit 叶子不改写（具体值自带真值）；非数值叶子静默跳过", () => {
    const litCell = abs(num().shape, lit(-1), undefined, "exact");
    const strCell = abs(str().shape, undefined, undefined, "widened");
    const row = abs(
      { k: "tuple", elements: [litCell, strCell] },
      undefined,
      undefined,
      "widened",
    );
    const r = withInvariantSpecs([spec2], () =>
      applyInvariantsToPack(
        abs(
          { k: "obj", slots: { dp: { value: row } } },
          undefined,
          undefined,
          "widened",
        ),
      ),
    );
    const els = ((r.shape as { slots: Record<string, { value: Abs }> }).slots.dp!.value
      .shape as { elements: Abs[] }).elements;
    expect(els[0]).toBe(litCell);
    expect(els[0]!.pred).toBeUndefined();
    expect(els[1]!.pred).toBeUndefined();
  });

  it("无 specs / 非 obj：恒等返回（===）", () => {
    const p = dpPack();
    expect(applyInvariantsToPack(p)).toBe(p);
    const numTop = widenNum();
    expect(withInvariantSpecs([spec2], () => applyInvariantsToPack(numTop))).toBe(numTop);
  });
});
