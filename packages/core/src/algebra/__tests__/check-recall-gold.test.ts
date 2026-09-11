import { describe, it, expect } from "vitest";
import { checkSource, pTrue, type CheckReport } from "../index.ts";

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
  // --- 调用链：wrapper 无条件转发 ---
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
    expect: "ok",
    note: "合法值经转发仍合法",
  },
  {
    id: "wrapper-forward-violates",
    origin: "内部转发",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
function wrapper(n) {
  return needsPositive(n);
}
wrapper(-1);
`,
    expect: "violation",
    note: "无条件转发：wrapper 的实参须满足 target 前置",
  },
  {
    id: "arrow-wrapper-forward-violates",
    origin: "箭头转发",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const wrap = (n) => needsPositive(n);
wrap(0);
`,
    expect: "violation",
  },
  {
    id: "conditional-wrapper-not-forward",
    origin: "带守卫的转发",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
function safeWrap(n) {
  if (n > 0) return needsPositive(n);
  return 0;
}
safeWrap(-1);
`,
    expect: "ok",
    note: "有守卫，不是无条件转发——clamp 语义",
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
  // --- 扫描边界已扩展：别名与对象属性调用 ---
  {
    id: "member-call-violates",
    origin: "obj.method(-1)",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const api = { needsPositive };
api.needsPositive(-1);
`,
    expect: "violation",
    note: "对象属性简写调用",
  },
  {
    id: "member-renamed-key-violates",
    origin: "{ key: fn }",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const api = { check: needsPositive };
api.check(-1);
`,
    expect: "violation",
  },
  {
    id: "aliased-fn-violates",
    origin: "const f = fn; f(-1)",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const f = needsPositive;
f(-1);
`,
    expect: "violation",
  },
  {
    id: "aliased-fn-valid-ok",
    origin: "const f = fn; f(5)",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const f = needsPositive;
f(5);
`,
    expect: "ok",
  },
  {
    id: "member-valid-ok",
    origin: "obj.method(5)",
    source: `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const api = { needsPositive };
api.needsPositive(5);
`,
    expect: "ok",
  },
];

/** require 金标：用 loadModule 喂外部源码 */
type RequireGold = {
  id: string;
  /** 入口文件源码 */
  source: string;
  /** spec → 模块源码 */
  modules: Record<string, string>;
  expect: Expect;
};

const REQUIRE_GOLD: RequireGold[] = [
  {
    id: "require-destructure-violates",
    source: `
const { needsPositive } = require("./v.js");
needsPositive(-1);
`,
    modules: {
      "./v.js": `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
module.exports = { needsPositive };
`,
    },
    expect: "violation",
  },
  {
    id: "require-destructure-ok",
    source: `
const { needsPositive } = require("./v.js");
needsPositive(5);
`,
    modules: {
      "./v.js": `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
module.exports = { needsPositive };
`,
    },
    expect: "ok",
  },
  {
    id: "require-member-violates",
    source: `
const v = require("./v.js");
v.needsPositive(0);
`,
    modules: {
      "./v.js": `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
module.exports = { needsPositive };
`,
    },
    expect: "violation",
  },
  {
    id: "require-named-prop-violates",
    source: `
const needsPositive = require("./v.js").needsPositive;
needsPositive(-3);
`,
    modules: {
      "./v.js": `
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
module.exports.needsPositive = needsPositive;
`,
    },
    expect: "violation",
  },
  {
    id: "esm-import-named-violates",
    source: `
import { needsPositive } from "./v.js";
needsPositive(-1);
`,
    modules: {
      "./v.js": `
export function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
`,
    },
    expect: "violation",
  },
  {
    id: "esm-import-alias-violates",
    source: `
import { needsPositive as np } from "./v.js";
np(0);
`,
    modules: {
      "./v.js": `
export function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
`,
    },
    expect: "violation",
  },
  {
    id: "esm-namespace-member-violates",
    source: `
import * as v from "./v.js";
v.needsPositive(-2);
`,
    modules: {
      "./v.js": `
export function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
`,
    },
    expect: "violation",
  },
  {
    id: "esm-import-ok",
    source: `
import { needsPositive } from "./v.js";
needsPositive(10);
`,
    modules: {
      "./v.js": `
export function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
`,
    },
    expect: "ok",
  },
  {
    id: "dynamic-import-destructure-violates",
    source: `
async function main() {
  const { needsPositive } = await import("./v.js");
  needsPositive(-1);
}
main();
`,
    modules: {
      "./v.js": `
export function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
`,
    },
    expect: "violation",
  },
  {
    id: "dynamic-import-ns-member-violates",
    source: `
async function main() {
  const v = await import("./v.js");
  v.needsPositive(0);
}
main();
`,
    modules: {
      "./v.js": `
export function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
`,
    },
    expect: "violation",
  },
  {
    id: "reexport-hop-violates",
    source: `
import { needsPositive } from "./barrel.js";
needsPositive(-1);
`,
    modules: {
      "./barrel.js": `export { needsPositive } from "./v.js";\n`,
      "./v.js": `
export function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
`,
    },
    expect: "violation",
    note: "barrel 只 re-export，约束在 v.js",
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

describe("check require cross-file gold", () => {
  for (const g of REQUIRE_GOLD) {
    it(`${g.id} → ${g.expect}`, () => {
      const r = checkSource(`req-${g.id}.js`, g.source, pTrue, {
        loadModule: (spec) => g.modules[spec],
        fromFile: `req-${g.id}.js`,
      });
      if (g.expect === "violation") {
        expect(
          r.issues.some((i) => i.code === "nudo:constraint-violated"),
          r.issues.map((i) => i.message).join("; ") || "ok",
        ).toBe(true);
      } else {
        expect(r.ok, r.issues.map((i) => i.message).join("; ")).toBe(true);
      }
    });
  }
});

describe("check ESM import gold", () => {
  for (const g of REQUIRE_GOLD.filter((x) => x.id.startsWith("esm-"))) {
    it(`${g.id} → ${g.expect}`, () => {
      const r = checkSource(`esm-${g.id}.js`, g.source, pTrue, {
        loadModule: (spec) => g.modules[spec],
        fromFile: `esm-${g.id}.js`,
      });
      if (g.expect === "violation") {
        expect(
          r.issues.some((i) => i.code === "nudo:constraint-violated"),
          r.issues.map((i) => i.message).join("; ") || "ok",
        ).toBe(true);
      } else {
        expect(r.ok, r.issues.map((i) => i.message).join("; ")).toBe(true);
      }
    });
  }
});
