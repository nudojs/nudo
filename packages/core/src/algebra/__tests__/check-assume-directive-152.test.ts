/**
 * issue #152：@nudo:assume <param> <= <param> 用户引理前提。
 * T1 表面（文法/锚定/校验/种子槽/脚枪）——div 关系折叠规则（arithmetic.ts）
 * 由并行件落地，本套件不钉折叠产物，只钉：
 * - 解析锚定 = AST 最近 Function（多函数不串）
 * - 未知名/非法操作符 → error nudo:assume-invalid（exit 语义 = report.ok false）
 * - 侧车 `.le("max")` 脚枪 → 显式 throw，check 浮出 nudo:interface-load
 * - 前提槽（currentAssumePremises / withAssumePremises）set/restore/嵌套语义
 * - 无 assume → 零 nudo:assume-* 诊断
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, le, v as termVar } from "../index.ts";
import {
  currentAssumePremises,
  withAssumePremises,
} from "../exec/index.ts";
import { callTranspiledExportFull, tryRunTranspiled } from "../exec/run.ts";

function checkOf(src: string, opts: Record<string, unknown> = {}) {
  return checkSource("/t/assume.js", src, pTrue, opts);
}

describe("@nudo:assume 解析与锚定", () => {
  it("合法 assume 行不产 assume-invalid（多函数文件不串）", () => {
    const r = checkOf(`
/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
/**
 * @nudo:assume a >= b
 */
export function other(a, b) {
  return a + b;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:assume-invalid")).toEqual([]);
  });

  it("assume 锚定最近 Function：他函数形参名不误判（d 是 sim 的形参而非 other 的）", () => {
    const r = checkOf(`
/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
/**
 * @nudo:assume d <= max
 */
export function other(a, b) {
  return a + b;
}
`);
    const bad = r.issues.filter((i) => i.code === "nudo:assume-invalid");
    // 只有 other 报：d/max 不在 (a, b)；sim 的合法段不得被另一函数的消费污染
    expect(bad).toHaveLength(1);
    expect(bad[0]!.fn).toBe("other");
    expect(bad[0]!.message).toContain("not in the formal parameter list");
    expect(bad[0]!.actual).toContain("d");
    expect(bad[0]!.actual).toContain("max");
  });

  it("一函数多行 assume 全部消费", () => {
    const r = checkOf(`
/**
 * @nudo:assume a <= b
 * @nudo:assume b <= c
 * @nudo:assume a <= zz
 */
export function f(a, b, c) {
  return b;
}
`);
    const bad = r.issues.filter((i) => i.code === "nudo:assume-invalid");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.actual).toBe("zz");
  });

  it("行注释与 JSDoc 块注释同等支持", () => {
    const r = checkOf(`
// @nudo:assume d <= max
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:assume-invalid")).toEqual([]);
  });

  it("字符串里的同形文本不是指令", () => {
    const r = checkOf(`
export function sim(d, max) {
  return "@nudo:assume d <= nope";
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:assume-invalid")).toEqual([]);
  });
});

describe("@nudo:assume 校验诊断（nudo:assume-invalid）", () => {
  it("未知名 → error 级 + report.ok false（exit 语义）", () => {
    const r = checkOf(`
/**
 * @nudo:assume d <= nope
 */
export function sim(d, max) {
  return d;
}
`);
    expect(r.ok).toBe(false);
    const bad = r.issues.find((i) => i.code === "nudo:assume-invalid");
    expect(bad).toBeDefined();
    expect(bad!.severity).toBe("error");
    expect(bad!.message).toContain("sim");
    expect(bad!.actual).toBe("nope");
  });

  it("非法操作符（< / > / ==）→ 同码 error", () => {
    for (const seg of ["d < max", "d > max", "d == max"]) {
      const r = checkOf(`
/**
 * @nudo:assume ${seg}
 */
export function sim(d, max) {
  return d;
}
`);
      const bad = r.issues.find((i) => i.code === "nudo:assume-invalid");
      expect(bad, seg).toBeDefined();
      expect(bad!.severity).toBe("error");
      expect(bad!.actual).toBe(seg);
      expect(r.ok).toBe(false);
    }
  });

  it("字面量界（d <= 10）→ 同码 error（常数界属侧车契约）", () => {
    const r = checkOf(`
/**
 * @nudo:assume d <= 10
 */
export function sim(d) {
  return d;
}
`);
    const bad = r.issues.find((i) => i.code === "nudo:assume-invalid");
    expect(bad).toBeDefined();
    expect(bad!.actual).toBe("d <= 10");
  });

  it("无参函数上引用任意名 → error", () => {
    const r = checkOf(`
/**
 * @nudo:assume a <= b
 */
export function f() {
  return 1;
}
`);
    const bad = r.issues.find((i) => i.code === "nudo:assume-invalid");
    expect(bad).toBeDefined();
    expect(bad!.expected).toBe("(no params)");
  });

  it("合法段与非法段并存：合法段不被非法段拖垮（无 assume-invalid 以外的新码）", () => {
    const r = checkOf(`
/**
 * @nudo:assume d <= max
 * @nudo:assume d == max
 */
export function sim(d, max) {
  return d;
}
`);
    const bad = r.issues.filter((i) => i.code === "nudo:assume-invalid");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.actual).toBe("d == max");
  });
});

describe("number().le(\"max\") 脚枪（constraint builder 守卫）", () => {
  it("gt/ge/lt/le/min/max/shift 非有限数值实参 → throw（含方法名与 @nudo:assume 提示）", async () => {
    const { number } = await import("../constraint.ts");
    const n = number() as never as Record<
      string,
      (x: never) => unknown
    >;
    const cases: Array<[string, () => unknown]> = [
      ["gt", () => n.gt!("max" as never)],
      ["ge", () => n.ge!("max" as never)],
      ["lt", () => n.lt!("max" as never)],
      ["le", () => n.le!("max" as never)],
      ["min", () => n.min!(Infinity as never)],
      ["max", () => n.max!(NaN as never)],
      ["shift", () => n.shift!("n" as never)],
    ];
    for (const [name, invoke] of cases) {
      let err: unknown;
      try {
        invoke();
      } catch (e) {
        err = e;
      }
      expect(err, name).toBeInstanceOf(Error);
      expect((err as Error).message, name).toContain(`nudo ${name}()`);
      expect((err as Error).message, name).toContain("@nudo:assume");
      expect((err as Error).message, name).toContain("issue #152");
    }
  });

  it("合法数值界不受影响", async () => {
    const { number, string } = await import("../constraint.ts");
    expect(() => number().gt(0).le(100)).not.toThrow();
    expect(() => number().int().ge(1)).not.toThrow();
    expect(() => string().min(1).max(20)).not.toThrow();
    expect(() => number().gt(0).shift(3)).not.toThrow();
  });

  it("侧车里 throw → check 浮出 nudo:interface-load error（非静默；实测面）", () => {
    // 实测（2026-10）：throw 经 execNudoModuleCached 原文浮出为
    // nudo:interface-load "sidecar './assume.nudo.js' failed to load: nudo le(): …"；
    // 同时契约失效使参数回退 any → 既有 nudo:entry-may-throw（TypeError）同报
    const sidecar = `export const sim = fn({ d: number().ge(0), max: number().ge(1) }, number().ge(0).le("max"));`;
    const r = checkOf(
      `
/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
`,
      {
        loadModule: (spec: string) => (spec.endsWith(".nudo.js") ? sidecar : undefined),
        fromFile: "/t/assume.js",
      },
    );
    expect(r.ok).toBe(false);
    const err = r.issues.find(
      (i) => i.code === "nudo:interface-load" && i.message.includes("le()"),
    );
    expect(err).toBeDefined();
    expect(err!.severity).toBe("error");
    expect(err!.message).toContain('@nudo:assume (issue #152)');
    expect(err!.message).toContain('"max"');
  });

  it("合法侧车同形态：契约证得 + assume-relied 审计标注（对照组）", () => {
    const sidecar = `export const sim = fn({ d: number().ge(0), max: number().ge(1) }, number().ge(0).le(1));`;
    const r = checkOf(
      `
/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
`,
      {
        loadModule: (spec: string) => (spec.endsWith(".nudo.js") ? sidecar : undefined),
        fromFile: "/t/assume.js",
      },
    );
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    // 无 unproven-return（引理折叠生效）+ assume-relied 审计标注（info）
    expect(
      r.issues.some((i) => i.code === "nudo:unproven-return"),
    ).toBe(false);
    const relied = r.issues.find((i) => i.code === "nudo:assume-relied");
    expect(relied).toBeDefined();
    expect(relied!.severity).toBe("info");
    expect(relied!.message).toContain("proved via @nudo:assume d <= max");
    // invalid 不应出现（合法形态）
    expect(r.issues.some((i) => i.code === "nudo:assume-invalid")).toBe(false);
  });
});

describe("assume 前提槽（currentAssumePremises / withAssumePremises）", () => {
  it("默认 pTrue；withAssumePremises scoped set/restore", () => {
    expect(currentAssumePremises().op).toBe("true");
    const premise = le(termVar("d"), termVar("max"));
    withAssumePremises(premise, () => {
      expect(currentAssumePremises()).toBe(premise);
    });
    expect(currentAssumePremises().op).toBe("true");
  });

  it("嵌套 restore 顺序正确 + 异常路径也恢复", () => {
    const outer = le(termVar("a"), termVar("b"));
    const inner = le(termVar("c"), termVar("d"));
    withAssumePremises(outer, () => {
      withAssumePremises(inner, () => {
        expect(currentAssumePremises()).toBe(inner);
      });
      expect(currentAssumePremises()).toBe(outer);
      try {
        withAssumePremises(inner, () => {
          throw new Error("boom");
        });
      } catch {
        /* 吞掉验恢复 */
      }
      expect(currentAssumePremises()).toBe(outer);
    });
    expect(currentAssumePremises().op).toBe("true");
  });

  it("withAssumePremises 包裹与 opts.phi 组合不崩（播种单一机制）", () => {
    const run = tryRunTranspiled(`export function one() { return 1; }`);
    expect(run).toBeDefined();
    const premise = le(termVar("d"), termVar("max"));
    // #152 播种单一机制：assume 前提只走 withAssumePremises 动态域包裹
    // （callTranspiledExportFull 无 assumePremises 选项位），phi 走 opts.phi
    // ——两层嵌套互不干扰
    const r = withAssumePremises(premise, () =>
      callTranspiledExportFull(run!, "one", [], { phi: premise }),
    );
    expect(r.result.term?.op).toBe("lit");
    const r2 = withAssumePremises(premise, () => callTranspiledExportFull(run!, "one", []));
    expect(r2.result.term?.op).toBe("lit");
  });
});

describe("assume × #123 adoption 碰撞（unsound 假证明守卫）", () => {
  // 实测漏洞：sim 帧内 getD(wild(undefined)) 的无信息实参被 contract-face
  // adoption 重锚为 getD 的形参名 term（termVar("d")）；getD 无返回契约 →
  // presentCallResultFace 不洗回 → 该 term 原样流回 sim 帧（caller 帧前提
  // 仍激活——callAtFunctionBoundary 只清 callee 帧槽），与引理 d <= max 的
  // 裸 var 名按 termEquals 碰撞 → dd/mm 假折 le(·,1) →「return contract
  // proved via @nudo:assume」假证明（dd/mm 实际是 wild(undefined) 的结果，
  // 与 sim 形参毫无关系）。修复：adoptCallArgsToFaces 在前提槽非 pTrue 时
  // 跳过采用（callee 帧内槽已清空、照常采用；目标帧自身形参由 generalize
  // 的 entry Abs 锚定，不经采用）。
  const sidecar = `export const getD = fn({ d: number() });
export const getM = fn({ max: number().ge(1) });
export const sim = fn({ d: number(), max: number() }, number().le(1));`;
  const opts = {
    loadModule: (spec: string) => (spec.endsWith(".nudo.js") ? sidecar : undefined),
    fromFile: "/t/assume.js",
  };
  const body = (assumeSeg: string) => `
export function getD(d) { return d; }
export function getM(max) { return max; }
export function wild(x) { return x ** 2; }
/**
 * ${assumeSeg}
 * @nudo:contract
 */
export function sim(d, max) {
  const dd = getD(wild(undefined));
  const mm = getM(wild(undefined));
  return dd / mm;
}
`;

  it("对照（无 assume）：unproven-return 诚实上报", () => {
    const r = checkOf(body(""), opts);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(true);
  });

  it("adoption 重锚的假 term 不得撞引理：无 assume-relied 假证明，仍 unproven-return", () => {
    const r = checkOf(body("@nudo:assume d <= max"), opts);
    expect(r.issues.some((i) => i.code === "nudo:assume-relied")).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(true);
  });
});

describe("无 assume → 零行为变化", () => {
  it("无指令源不产任何 nudo:assume-* 诊断", () => {
    const r = checkOf(`
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
`);
    expect(r.issues.some((i) => i.code.startsWith("nudo:assume"))).toBe(false);
  });

  it("散文提及（句中非行首）不是指令", () => {
    const r = checkOf(`
/**
 * 讨论：@nudo:assume d <= max 之后 1 - d/max 可证 —— 但这只是文档散文。
 */
export function sim(d, max) {
  return d;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:assume-invalid")).toEqual([]);
  });
});
