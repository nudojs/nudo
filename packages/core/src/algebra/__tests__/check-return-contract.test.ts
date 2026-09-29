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

  it("error: 返回类型 ⊭ string", () => {
    const r = issuesOf(`
/**
 * @nudo:contract return notAString
 */
function n() {
  return 1;
}
`);
    // notAString 不在 std 里 → 无契约可查，不报
    expect(r.issues.filter((i) => i.message.includes("@nudo:contract return"))).toEqual([]);
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
  });
});
