/**
 * @nudo:contract return 后置契约：推断返回值 ⊭ 声明。
 * 与 @nudo:contract（前置）对偶；契约仍来自 *.nudo.js 模板。
 * DEC-001：统一证明通道 assertImplies + nullish 显式化 + any/unknown 策略。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

function issuesOf(src: string) {
  return checkSource("/t/ret.js", withStdImport(src), pTrue, stdOpts);
}

function errorsOf(src: string) {
  return issuesOf(src).issues.filter((i) => i.severity === "error");
}

function warningsOf(src: string) {
  return issuesOf(src).issues.filter((i) => i.severity === "warning");
}

describe("@nudo:contract return", () => {
  it("ok: 返回值满足 positive", () => {
    const r = issuesOf(`
/**
 * @nudo:contract x positive
 * @nudo:contract return positive
 */
function inc(x) {
  return x + 1;
}
`);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("error: 字面量返回 ⊭ positive", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return positive
 */
function bad() {
  return 0;
}
`);
    expect(r.ok).toBe(false);
    const err = r.issues.find((i) => i.message.includes("@nudo:contract return"));
    expect(err).toBeDefined();
    expect(err!.expected).toContain(">");
  });

  it("unknown return constraint name → no false violation, but a visible warning (BUG-016)", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return notAString
 */
function n() {
  return 1;
}
`);
    // notAString 不在 std 里 → 无契约可查，不报违例（false positive = 0）
    expect(r.issues.filter((i) => i.message.includes("@nudo:contract return") && i.severity === "error")).toEqual([]);
    // 但静默失效不允许：未知约束名 → nudo:contract-syntax warning
    expect(
      r.issues.filter(
        (i) => i.code === "nudo:contract-syntax" && i.message.includes("notAString"),
      ),
    ).toHaveLength(1);
  });

  it("ok: 无 @nudo:contract return 不猜后置", () => {
    const r = issuesOf(`
function free() {
  return -1;
}
`);
    expect(r.issues.filter((i) => i.message.includes("@nudo:contract return"))).toEqual([]);
  });

  it("error: percent 上界", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return percent
 */
function big() {
  return 150;
}
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("@nudo:contract return"))).toBe(true);
  });

  it("error: string 长度界（shortName min/max）", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return shortName
 */
function name() {
  return "";
}
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("@nudo:contract return"))).toBe(true);
  });

  it("ok: string 满足长度界", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return shortName
 */
function name() {
  return "abc";
}
`);
    expect(r.issues.filter((i) => i.message.includes("@nudo:contract return"))).toEqual([]);
  });

  it("ok: any/符号返回不误报", () => {
    const r = issuesOf(`
/**
 * @nudo:contract x positive
 * @nudo:contract return positive
 */
function keep(x) {
  return x;
}
`);
    // 符号返回带 pred x>0，应满足
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("ok: 条件赋值产生的分支 sum 逐成员对账（不因 sum 直接判违规）", () => {
    const r = issuesOf(`
/**
 * @nudo:contract x userShape
 * @nudo:contract return userShape
 */
function maybe(x) {
  const o = { id: x.id, name: x.name };
  if (x.name) o.extra = x.name;
  return o;
}
`);
    expect(r.issues.filter((i) => i.message.includes("@nudo:contract return"))).toEqual([]);
  });

  it("error: sum 中单个成员违反契约仍报", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return userShape
 */
function pick(flag) {
  if (flag) return { id: 1, name: "a", extra: 1 };
  return { id: 1 };
}
`);
    const err = r.issues.find((i) => i.message.includes("@nudo:contract return"));
    expect(err).toBeDefined();
    expect(err!.expected).toContain("missing field name");
  });
});

describe("DEC-001: 非字面量返回证数值界", () => {
  it("warning: 符号返回 x-100 ⊭ positive（无 pred 证据 → unprovable 不得伪装成功）", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return positive
 */
function f(x) {
  return x - 100;
}
`);
    const retIssues = r.issues.filter((i) => i.message.includes("@nudo:contract return"));
    expect(retIssues.length).toBeGreaterThan(0);
    // 无 pred 证据 → unprovable → warning（不得静默放行）
    expect(retIssues[0]!.severity).toBe("warning");
    expect(retIssues[0]!.code).toBe("nudo:unproven-return");
  });

  it("error: 符号返回带矛盾 pred（x<0 时 x ⊭ positive）报 error", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract x nonNeg
 * @nudo:contract return positive
 */
function f(x) {
  return x;
}
`);
    // x ≥ 0 不蕴含 x > 0（0 不满足 positive）→ pred 存在但不蕴含 → error
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.code).toBe("nudo:constraint-violated");
  });

  it("error: 符号返回 x（any 透传）warning 而非伪装成功", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return positive
 */
function g(x) {
  return x;
}
`);
    // any 不得伪装成功：至少 warning 可见
    const retIssues = r.issues.filter((i) => i.message.includes("@nudo:contract return"));
    expect(retIssues.length).toBeGreaterThan(0);
    expect(retIssues[0]!.severity).toBe("warning");
    expect(retIssues[0]!.code).toBe("nudo:unproven-return");
  });

  it("ok: 符号返回 x+1 在 x>0 下蕴含 positive（Pred 蕴含通道）", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract x positive
 * @nudo:contract return positive
 */
function inc(x) {
  return x + 1;
}
`);
    expect(errs).toEqual([]);
  });

  it("ok: 符号返回 x 在 x>0 下蕴含 positive（pred 蕴含）", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract x positive
 * @nudo:contract return positive
 */
function keep(x) {
  return x;
}
`);
    expect(errs).toEqual([]);
  });
});

describe("DEC-001: nullish 显式化", () => {
  it("error: return null 对不含 nullish 的契约报 error", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract return positive
 */
function f() {
  return null;
}
`);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.code).toBe("nudo:constraint-violated");
  });

  it("error: return undefined 对不含 nullish 的契约报 error", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract return positive
 */
function f() {
  return undefined;
}
`);
    expect(errs.length).toBeGreaterThan(0);
  });

  it("ok: nullable(positive) 允许 return null", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract return maybePositive
 */
function f() {
  return null;
}
`);
    expect(errs).toEqual([]);
  });

  it("ok: nullable(positive) 允许 return undefined", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract return maybePositive
 */
function f() {
  return undefined;
}
`);
    expect(errs).toEqual([]);
  });

  it("ok: nullable(positive) 证明条件返回 null | number（scalar-over-sum）", () => {
    // #68：官方建议修法 nullable(c) 对多 return 路径必须可证
    const r = issuesOf(`
/**
 * @nudo:contract return maybePositive
 */
function f(flag) {
  if (flag) return null;
  return 7;
}
`);
    const retIssues = r.issues.filter((i) => i.message.includes("@nudo:contract return"));
    expect(retIssues).toEqual([]);
  });

  it("ok: nullable(number()) 证明条件返回 null | n（符号数）", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return maybePositive
 */
function f(flag, n) {
  if (flag) return null;
  return n;
}
`);
    // n 为 unconstrained any → 臂 unprovable，但不得 error
    // 契约是 maybePositive = nullable(positive=gt0)，n 无界 → warning
    const errs = r.issues.filter(
      (i) => i.severity === "error" && i.message.includes("@nudo:contract return"),
    );
    expect(errs).toEqual([]);
  });

  it("ok: nullable(positive) 证明 x>0 路径上的 null | x", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract x positive
 * @nudo:contract return maybePositive
 */
function f(flag, x) {
  if (flag) return null;
  return x;
}
`);
    expect(errs).toEqual([]);
  });

  it("error: 条件返回 null | 0 对 nullable(positive) 仍报 0 ⊭ gt(0)", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract return maybePositive
 */
function f(flag) {
  if (flag) return null;
  return 0;
}
`);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.code).toBe("nudo:constraint-violated");
  });

  it("ok: union(positive, lit(null)) 允许 return null", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract return posOrNull
 */
function f() {
  return null;
}
`);
    expect(errs).toEqual([]);
  });

  it("error: union(positive, lit(null)) 仍拒绝 return 0", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract return posOrNull
 */
function f() {
  return 0;
}
`);
    expect(errs.length).toBeGreaterThan(0);
  });

  it("error: sum 含 nullish 臂对不含 nullish 的契约报 error", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract return positive
 */
function f(flag) {
  if (flag) return null;
  return 1;
}
`);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.expected).toContain("nullish");
  });
});

describe("BUG-002: 裸 prim 契约对非 prim 返回（obj/arr/fn）必须 disproved", () => {
  it("error: object return ⊭ string()", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return nonEmpty
 */
function f() { return { a: 1 }; }
`);
    const retIssues = r.issues.filter((i) => i.message.includes("@nudo:contract return"));
    expect(retIssues.length).toBeGreaterThan(0);
    expect(retIssues[0]!.severity).toBe("error");
    expect(retIssues[0]!.code).toBe("nudo:constraint-violated");
  });

  it("error: array return ⊭ string()", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return nonEmpty
 */
function f() { return [1]; }
`);
    const retIssues = r.issues.filter((i) => i.message.includes("@nudo:contract return"));
    expect(retIssues.length).toBeGreaterThan(0);
    expect(retIssues[0]!.severity).toBe("error");
    expect(retIssues[0]!.code).toBe("nudo:constraint-violated");
  });

  it("error: fn return ⊭ string()", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return nonEmpty
 */
function f() { return () => {}; }
`);
    const retIssues = r.issues.filter((i) => i.message.includes("@nudo:contract return"));
    expect(retIssues.length).toBeGreaterThan(0);
    expect(retIssues[0]!.severity).toBe("error");
    expect(retIssues[0]!.code).toBe("nudo:constraint-violated");
  });

  it("error: object return ⊭ number()", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return positive
 */
function f() { return { a: 1 }; }
`);
    // positive = number().gt(0)：prim 门应直接 disproved（非 unprovable warning）
    const retIssues = r.issues.filter((i) => i.message.includes("@nudo:contract return"));
    expect(retIssues.length).toBeGreaterThan(0);
    expect(retIssues[0]!.severity).toBe("error");
    expect(retIssues[0]!.code).toBe("nudo:constraint-violated");
  });

  it("error: array return ⊭ number()", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return positive
 */
function f() { return [1]; }
`);
    const retIssues = r.issues.filter((i) => i.message.includes("@nudo:contract return"));
    expect(retIssues.length).toBeGreaterThan(0);
    expect(retIssues[0]!.severity).toBe("error");
  });

  it("对照：number return ⊭ nonEmpty 仍报 error（双方都有 prim）", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return nonEmpty
 */
function f() { return 1; }
`);
    const retIssues = r.issues.filter((i) => i.message.includes("@nudo:contract return"));
    expect(retIssues.length).toBeGreaterThan(0);
    expect(retIssues[0]!.severity).toBe("error");
    expect(retIssues[0]!.expected).toContain("string");
  });

  it("error: shape 字段 object ⊭ string()（字段递归同源）", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return userShape
 */
function f() { return { id: 1, name: { a: 1 } }; }
`);
    const retIssues = r.issues.filter((i) => i.message.includes("@nudo:contract return"));
    expect(retIssues.length).toBeGreaterThan(0);
    expect(retIssues[0]!.severity).toBe("error");
    expect(retIssues[0]!.expected).toContain("name");
  });

  it("ok: sum 保持 FP 保护（any 派生并集不误报）", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return nonEmpty
 */
function f(x) { return x + 1; }
`);
    // x:any → x+1 派生 number|string（any 参与运算符）→ 不得报 error
    const errs = r.issues.filter(
      (i) => i.severity === "error" && i.message.includes("@nudo:contract return"),
    );
    expect(errs).toEqual([]);
  });
});

describe("DEC-001: any/unknown 策略（不得伪装成功）", () => {
  it("warning: any 返回对有界契约报 warning（非 error、非静默）", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return positive
 */
function f(x) {
  return x;
}
`);
    const retIssues = r.issues.filter((i) => i.message.includes("@nudo:contract return"));
    expect(retIssues.length).toBeGreaterThan(0);
    expect(retIssues[0]!.severity).toBe("warning");
  });

  it("warning: opaque/截断返回对有界契约报 warning 而非 error", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return positive
 */
function sumTo(n) {
  if (n <= 1) return 1;
  return n + sumTo(n - 1);
}
const s = sumTo(10);
`);
    // opaque/截断 → warning 不得计 error（gold FP 保护）
    const errs = r.issues.filter(
      (i) => i.severity === "error" && i.message.includes("@nudo:contract return"),
    );
    expect(errs).toEqual([]);
    const warns = r.issues.filter(
      (i) => i.severity === "warning" && i.message.includes("@nudo:contract return"),
    );
    // 可能有 warning（unproven），但绝无 error
    expect(warns.length).toBeGreaterThanOrEqual(0);
  }, 30000); // 递归契约检查在 CI 16-worker 并行（大量 nudojs 子进程测试）下实测 >5s；本地 ~1s。断言不变
});

describe("sum 源 × array 契约：逐成员分发（元组并 ⊑ array）", () => {
  it("ok: `[] | [1]` 满足 positives（每个成员单独都满足）", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract return positives
 */
function pick(n) {
  const out = [];
  if (n > 0) out.push(n);
  return out;
}
`);
    expect(errs).toEqual([]);
  });

  it("ok: `[] | [{ severity: high }]` 满足 findings", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract return findings
 */
function keep(list) {
  const out = [];
  for (const f of list) out.push({ severity: f.severity });
  return out;
}
`);
    expect(errs).toEqual([]);
  });

  it("ok: 多 return 路径的元组并满足 positives", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract return positives
 */
function pick(n) {
  if (n > 0) return [n];
  return [];
}
`);
    expect(errs).toEqual([]);
  });

  it("error: 非数组成员仍报（分发不放行非法成员）", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract return positives
 */
function bad(n) {
  if (n > 0) return 1;
  return [];
}
`);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.expected).toContain("array(...)");
  });

  it("control: 单一元组（非 sum）本就满足 positives", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract return positives
 */
function one() {
  return [1];
}
`);
    expect(errs).toEqual([]);
  });

  it("ok: fork 合并的字面量臂经 Math.min/max 保区间（sum 成员界并集）", () => {
    // s = flag ? 20 : 55 —— B 路径 fork 合并为 sum（成员为字面量）。
    // sum 的 numericBounds 取成员界并集、isNonNaN 逐成员可证 ⇒
    // Math.min/max 不得挂 NaN 臂/无界臂（此前误报 ⊭ percent）。
    const errs = errorsOf(`
/**
 * @nudo:contract return percent
 */
function pick(flag) {
  const s = flag ? 20 : 55;
  return Math.max(0, Math.min(100, s));
}
`);
    expect(errs).toEqual([]);
  });

  it("ok: Number.isNaN 守卫对合并值仍排除 NaN 臂", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract return percent
 */
function pick(flag) {
  const s = flag ? 20 : 55;
  if (Number.isNaN(s)) return 0;
  return Math.min(100, s);
}
`);
    expect(errs).toEqual([]);
  });

  it("ok: 条件累积分（+= 分支合并）经 clamp 满足区间", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract return percent
 */
function supplyChainScore(attestation) {
  let score = 0;
  if (attestation?.gitCommit) score += 35;
  if (attestation?.workflowFingerprint) score += 25;
  score += 20;
  if (Number.isNaN(score)) return 0;
  return Math.max(0, Math.min(100, score));
}
`);
    expect(errs).toEqual([]);
  });

  it("ok: 字面量减 fork 合并值保区间（sub sum 分发）", () => {
    // 此前 sub 遇 sum 操作数整体落 unknown → clamp 内 Math.min/max
    // 挂 NaN 臂 → 区间契约误报。
    const errs = errorsOf(`
/**
 * @nudo:contract return percent
 */
function pick(flag) {
  const s = flag ? 20 : 55;
  return 100 - s;
}
`);
    expect(errs).toEqual([]);
    // 断言分发精度：100 - (20 | 55) 推断为 45 | 80，不得退化成 unknown
    const violated = issuesOf(`
/**
 * @nudo:contract return small
 */
function pickSmall(flag) {
  const s = flag ? 20 : 55;
  return 100 - s;
}
`);
    const err = violated.issues.find((i) => i.message.includes("@nudo:contract return"));
    expect(err).toBeDefined();
    expect(err!.actual).toContain("45");
    expect(err!.actual).toContain("80");
    expect(err!.actual).not.toContain("unknown");
  });

  it("ok: 加权求和（mul/add sum 分发）保区间", () => {
    const errs = errorsOf(`
/**
 * @nudo:contract return percent
 */
function weighted(flag) {
  const a = flag ? 20 : 55;
  const b = flag ? 10 : 40;
  return 0.3 * a + 0.7 * b;
}
`);
    expect(errs).toEqual([]);
    // 断言分发精度：0.3*a + 0.7*b 推断为四个字面量臂，不得退化成 unknown
    const violated = issuesOf(`
/**
 * @nudo:contract return small
 */
function weightedSmall(flag) {
  const a = flag ? 20 : 55;
  const b = flag ? 10 : 40;
  return 0.3 * a + 0.7 * b;
}
`);
    const err = violated.issues.find((i) => i.message.includes("@nudo:contract return"));
    expect(err).toBeDefined();
    expect(err!.actual).toContain("13");
    expect(err!.actual).toContain("44.5");
    expect(err!.actual).not.toContain("unknown");
  });

  it("ok: 评分卡维度（解构形参 + filter/reduce + clamp）满足区间契约", () => {
    // npm-safe scanner computeScorecard 的真实形态：reduce 逐成员
    // 精确（penalty 枚举），100 - reduce 经 sub 分发保持字面量臂，
    // clamp100 的 Math.min/max 凭成员界/非 NaN 性不再挂 NaN 臂。
    // 形参契约（侧车 fn 签名）与返回契约同时挂载——同 npm-safe 侧车。
    const errs = errorsOf(`
function penaltyFor(severity) {
  if (severity === 'critical') return 45;
  if (severity === 'high') return 25;
  if (severity === 'medium') return 12;
  if (severity === 'low') return 6;
  return 0;
}
function clamp100(n) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
/**
 * @nudo:contract findings scorecardFindings
 * @nudo:contract return scorecard
 */
function computeScorecard({ findings }) {
  const codeBehavior = 100 - findings
    .filter((f) => f.category === 'code')
    .reduce((acc, f) => acc + penaltyFor(f.severity), 0);
  return { codeBehavior: clamp100(codeBehavior) };
}
`);
    expect(errs).toEqual([]);
  });

  it("ok: 加权总分（Math.round ∘ clamp100 ∘ 加权和）满足区间契约", () => {
    // npm-safe scanner totalScore 形态：钳位惯用法经 Math.round 收尾。
    // roundingAbs 此前对无 term 实参（sum）丢界 → 返回纯 number →
    // 区间契约 unproven-return（warning）。
    const r = issuesOf(`
function clamp100(n) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
/**
 * @nudo:contract dims dimensionScores
 * @nudo:contract return percent
 */
function totalScore(dims) {
  const raw =
    0.25 * dims.supplyChain +
    0.3 * dims.codeBehavior +
    0.15 * dims.dependencyHealth +
    0.15 * dims.maintainerHistory +
    0.15 * dims.metadataTrust;
  return Math.round(clamp100(raw));
}
`);
    expect(r.issues.filter((i) => i.severity !== "info")).toEqual([]);
  });
});

describe("issue #102：OOB marker 臂不 disproved（DP 表返回契约）", () => {
  // 抽象下标读（d[m]）并入的 oobUndef marker（conf=partial 的合成
  // undefined）此前作为 nullish 臂走 disproved → 契约 ERROR（gate 红）。
  // marker 是引擎精度产物（长度事实丢失），非用户域 undefined——降
  // unprovable（warning），真实臂证据充分时仍照常 disproved。
  const LEV = `
export function lev(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const m = long.length;
  const n = short.length;
  const d = [];
  for (let i = 0; i <= m; i++) {
    d[i] = new Array(n + 1).fill(0);
    d[i][0] = i;
  }
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = long[i - 1] === short[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && long[i - 1] === short[j - 2] && long[i - 2] === short[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}`;

  it("OSA levenshtein：number() 返回契约不报 error（marker → warning）", () => {
    const r = issuesOf(
      `/**\n * @nudo:contract a nonEmpty\n * @nudo:contract b nonEmpty\n * @nudo:contract return num\n */\n${LEV}`,
    );
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    const ret = r.issues.filter((i) => i.message.includes("@nudo:contract return"));
    expect(ret).toHaveLength(1);
    expect(ret[0]!.severity).toBe("warning");
    expect(ret[0]!.code).toBe("nudo:unproven-return");
    // 签名仍诚实显示 OOB 臂（marker 只降级证明通道，不改值域显示）
    expect(r.signatures.find((s) => s.name === "lev")?.display).toMatch(/undefined/);
  });

  it("单 marker 臂（空表抽象下标读）同口径：warning 不 error", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return num
 */
function miss(i) {
  const d = [];
  return d[i];
}
`);
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(true);
  });

  it("nullable 契约下多臂 marker discharged（与单臂 proved 对称）", () => {
    const r = issuesOf(
      `/**\n * @nudo:contract a nonEmpty\n * @nudo:contract b nonEmpty\n * @nudo:contract return nullableNum\n */\n${LEV}`,
    );
    expect(r.ok).toBe(true);
    // 0 | number | marker：真实臂证毕，marker 的 undefined 可能性被
    // nullable 域覆盖 → 整体 proved，不再残留 unproven-return warning
    expect(r.issues.filter((i) => i.message.includes("@nudo:contract return"))).toEqual([]);
  });

  it("nullable 契约下单 marker 臂 proved", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return nullableNum
 */
function miss(i) {
  const d = [];
  return d[i];
}
`);
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.message.includes("@nudo:contract return"))).toEqual([]);
  });

  it("真实 nullish 返回不受 marker 豁免影响（仍 error）", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return num
 */
function real() {
  return undefined;
}
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });
});

describe("issue #115：裸 prim partial 臂对无界 prim 契约域隶属可证", () => {
  // parseVersion 条件加字段 → pa 是双变体 sum；关系比较块（`<`/`>` on
  // narrowed string 字段）保持返回臂不合并 → sum `0 | -1 | 1 | number`，
  // 其中 `pa.major - pb.major` 臂是 term-less partial prim number
  // （Number() 派生，parent sum conf=partial）。
  const CMP_SRC = `
const VERSION_RE = /^(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z.-]+))?$/;
function parseVersion(v) {
  const m = VERSION_RE.exec(v);
  if (!m) return null;
  const parsed = { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
  if (m[4] !== undefined) parsed.prerelease = String(m[4]);
  return parsed;
}
/**
 * @nudo:contract return num
 */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null && pb === null) return 0;
  if (pa === null) return -1;
  if (pb === null) return 1;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (pa.prerelease == null && pb.prerelease != null) return 1;
  if (pa.prerelease != null && pb.prerelease == null) return -1;
  if (pa.prerelease != null && pb.prerelease != null) {
    if (pa.prerelease < pb.prerelease) return -1;
    if (pa.prerelease > pb.prerelease) return 1;
  }
  return 0;
}
`;

  it("ok: 0 | -1 | 1 | number（裸 prim partial 臂）对 number() 域隶属可证", () => {
    const r = issuesOf(CMP_SRC);
    expect(
      r.issues.filter((i) => i.message.includes("@nudo:contract return")),
    ).toEqual([]);
  });

  it("warning: 同形态对带界契约（positive）仍不可证（gold FP 口径不动）", () => {
    const r = issuesOf(CMP_SRC.replace("return num", "return positive"));
    const warns = r.issues.filter(
      (i) =>
        i.code === "nudo:unproven-return" &&
        i.message.includes("@nudo:contract return"),
    );
    expect(warns).toHaveLength(1);
  });
});
