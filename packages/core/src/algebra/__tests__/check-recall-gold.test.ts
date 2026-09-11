import { describe, it, expect } from "vitest";
import { checkSource, type CheckReport } from "../index.ts";

/**
 * 金标 recall：真实 JS 库常见模式的人工标注。
 *
 * 标注约定（人工）：
 * - violation：调用点必须报 nudo:constraint-violated
 * - ok：不得报 error（真阴性，防误报）
 *
 * 指标：
 * - recall    = TP / (TP + FN)  必须 = 1（漏报 = 门禁失效）
 * - precision = TP / (TP + FP)  必须 = 1（误报 = 门禁噪音）
 */

type Expect = "ok" | "violation";

type Gold = {
  id: string;
  /** 模式来源（真实库/惯用法） */
  origin: string;
  source: string;
  expect: Expect;
  note?: string;
};

/** 真实库惯用法金标（人工标注） */
const GOLD: Gold[] = [
  // --- 延时 / 间隔（ms / setTimeout 风格） ---
  {
    id: "delay-positive",
    origin: "ms / setTimeout delay",
    source: `
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}
setDelay(100);
`,
    expect: "ok",
    note: "合法正延时",
  },
  {
    id: "delay-zero-violates",
    origin: "ms / setTimeout delay",
    source: `
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}
setDelay(0);
`,
    expect: "violation",
    note: "0 不满足 >0",
  },
  {
    id: "delay-negative-violates",
    origin: "ms / setTimeout delay",
    source: `
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}
setDelay(-50);
`,
    expect: "violation",
  },
  // --- 百分比 / 进度 ---
  {
    id: "pct-mid-ok",
    origin: "progress / opacity",
    source: `
function pct(n) {
  if (n >= 0 && n <= 100) return n;
  return 0;
}
pct(50);
`,
    expect: "ok",
  },
  {
    id: "pct-high-violates",
    origin: "progress / opacity",
    source: `
function pct(n) {
  if (n >= 0 && n <= 100) return n;
  return 0;
}
pct(150);
`,
    expect: "violation",
    note: "上界 100",
  },
  {
    id: "pct-low-violates",
    origin: "progress / opacity",
    source: `
function pct(n) {
  if (n >= 0 && n <= 100) return n;
  return 0;
}
pct(-1);
`,
    expect: "violation",
    note: "下界 0",
  },
  // --- 端口 / 索引 ---
  {
    id: "port-range-ok",
    origin: "net / listen port",
    source: `
function listen(port) {
  if (port >= 1 && port <= 65535) return port;
  return 80;
}
listen(8080);
`,
    expect: "ok",
  },
  {
    id: "port-zero-violates",
    origin: "net / listen port",
    source: `
function listen(port) {
  if (port >= 1 && port <= 65535) return port;
  return 80;
}
listen(0);
`,
    expect: "violation",
  },
  {
    id: "index-nonneg-ok",
    origin: "array index",
    source: `
function at(i) {
  if (i >= 0) return i;
  return 0;
}
at(3);
`,
    expect: "ok",
  },
  {
    id: "index-neg-violates",
    origin: "array index",
    source: `
function at(i) {
  if (i >= 0) return i;
  return 0;
}
at(-1);
`,
    expect: "violation",
  },
  // --- clamp：回退守卫不是调用前置 ---
  {
    id: "clamp-low-input-ok",
    origin: "lodash.clamp 风格",
    source: `
function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
clamp(-5, 0, 10);
`,
    expect: "ok",
    note: "clamp 合法接受越界输入",
  },
  {
    id: "clamp-high-input-ok",
    origin: "lodash.clamp 风格",
    source: `
function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
clamp(99, 0, 10);
`,
    expect: "ok",
  },
  // --- 上界-only ---
  {
    id: "max-size-ok",
    origin: "buffer / pageSize",
    source: `
function pageSize(n) {
  if (n <= 100) return n;
  return 100;
}
pageSize(20);
`,
    expect: "ok",
  },
  {
    id: "max-size-violates",
    origin: "buffer / pageSize",
    source: `
function pageSize(n) {
  if (n <= 100) return n;
  return 100;
}
pageSize(1000);
`,
    expect: "violation",
  },
  // --- 箭头 / export default ---
  {
    id: "arrow-violates",
    origin: "模块导出箭头",
    source: `
const needsPositive = (x) => {
  if (x > 0) return x;
  return 0;
};
needsPositive(-2);
`,
    expect: "violation",
  },
  {
    id: "export-default-violates",
    origin: "export default",
    source: `
export default function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
needsPositive(-1);
`,
    expect: "violation",
  },
  // --- 无前置：不得误报 ---
  {
    id: "no-guard-ok",
    origin: "普通工具函数",
    source: `
function double(n) { return n * 2; }
double(-1);
`,
    expect: "ok",
  },
  {
    id: "string-op-ok",
    origin: "debug / format",
    source: `
function fmt(s) { return String(s); }
fmt(-1);
`,
    expect: "ok",
  },
  {
    id: "equality-guard-not-precondition",
    origin: "分支处理",
    source: `
function onlyZero(x) {
  if (x === 0) return 0;
  return 1;
}
onlyZero(5);
`,
    expect: "ok",
  },
  // --- 调用链：把合法值传下去 ---
  {
    id: "chained-valid-ok",
    origin: "内部转发",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
function wrapper(n) {
  return needsPositive(n);
}
wrapper(3);
`,
    // wrapper 无字面量实参约束；wrapper(3) 不直接打 needsPositive
    expect: "ok",
    note: "当前门禁只查字面量调用点；间接调用记为 ok",
  },
  {
    id: "direct-invalid-in-chain",
    origin: "内部转发",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
needsPositive(-3);
`,
    expect: "violation",
  },
  // --- 扫描边界：当前只查 name(literal) 直接调用 ---
  {
    id: "member-call-out-of-scope",
    origin: "obj.method(-1)",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const api = { needsPositive };
api.needsPositive(-1);
`,
    expect: "ok",
    note: "成员调用暂不扫描；扩扫描后改标 violation",
  },
  {
    id: "aliased-fn-out-of-scope",
    origin: "const f = fn; f(-1)",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const f = needsPositive;
f(-1);
`,
    expect: "ok",
    note: "别名调用暂不扫描",
  },
];

function run(g: Gold): CheckReport {
  return checkSource(`gold-${g.id}.js`, g.source);
}

function bucket(g: Gold, r: CheckReport): "TP" | "FN" | "FP" | "TN" {
  const hasErr = r.issues.some((i) => i.severity === "error");
  if (g.expect === "violation") return hasErr ? "TP" : "FN";
  return hasErr ? "FP" : "TN";
}

describe("check gold recall (human-labeled)", () => {
  const counts = { TP: 0, FN: 0, FP: 0, TN: 0 };
  const failures: string[] = [];

  for (const g of GOLD) {
    it(`${g.id} [${g.origin}] → ${g.expect}`, () => {
      const r = run(g);
      const b = bucket(g, r);
      counts[b]++;
      if (b === "FN" || b === "FP") {
        failures.push(
          `${g.id} (${b}): ${g.note ?? ""} issues=${r.issues
            .map((i) => i.code)
            .join(",")}`,
        );
      }
      if (g.expect === "violation") {
        expect(
          r.issues.some((i) => i.code === "nudo:constraint-violated"),
          `expected violation, got: ${r.issues.map((i) => i.message).join("; ") || "ok"}`,
        ).toBe(true);
        expect(r.ok).toBe(false);
      } else {
        expect(r.ok, `false positive: ${r.issues.map((i) => i.message).join("; ")}`).toBe(true);
      }
    });
  }

  it("recall = 1.0 and precision = 1.0 on this gold set", () => {
    // 本 it 只汇总；逐条 it 已失败则这里也会红
    const recall = counts.TP + counts.FN === 0 ? 1 : counts.TP / (counts.TP + counts.FN);
    const precision = counts.TP + counts.FP === 0 ? 1 : counts.TP / (counts.TP + counts.FP);
    // vitest 并行下 counts 可能未累完——用同步重算
    let TP = 0, FN = 0, FP = 0, TN = 0;
    for (const g of GOLD) {
      const b = bucket(g, run(g));
      if (b === "TP") TP++;
      else if (b === "FN") FN++;
      else if (b === "FP") FP++;
      else TN++;
    }
    const rec = TP + FN === 0 ? 1 : TP / (TP + FN);
    const prec = TP + FP === 0 ? 1 : TP / (TP + FP);
    const detail = `TP=${TP} FN=${FN} FP=${FP} TN=${TN} recall=${rec.toFixed(2)} precision=${prec.toFixed(2)}`;
    expect(rec, `recall < 1: ${detail}`).toBe(1);
    expect(prec, `precision < 1: ${detail}`).toBe(1);
    expect(TP).toBeGreaterThan(5);
  });
});
