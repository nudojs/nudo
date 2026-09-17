import { describe, it, expect } from "vitest";
import { checkSource, pTrue, type CheckReport } from "../index.ts";
import { withStdImport, stdOpts, STD_NUDO_SRC } from "./nudo-constraints.ts";

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
/**
 * @nudo:refine ms positive
 */
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
/**
 * @nudo:refine ms positive
 */
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
/**
 * @nudo:refine ms positive
 */
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
/**
 * @nudo:refine n percent
 */
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
/**
 * @nudo:refine n percent
 */
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
/**
 * @nudo:refine n percent
 */
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
/**
 * @nudo:refine port atLeast1 && port <= 65535
 */
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
/**
 * @nudo:refine port atLeast1 && port <= 65535
 */
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
/**
 * @nudo:refine i nonNeg
 */
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
/**
 * @nudo:refine i nonNeg
 */
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
/**
 * @nudo:refine n max100
 */
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
/**
 * @nudo:refine n max100
 */
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
/**
 * @nudo:refine x positive
 */
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
export default /**
 * @nudo:refine x positive
 */
function needsPositive(x) {
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
/**
 * @nudo:refine x positive
 */
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
/**
 * @nudo:refine x positive
 */
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
/**
 * @nudo:refine x positive
 */
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
/**
 * @nudo:refine x positive
 */
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
/**
 * @nudo:refine x positive
 */
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
/**
 * @nudo:refine x positive
 */
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
/**
 * @nudo:refine x positive
 */
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
/**
 * @nudo:refine x positive
 */
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
/**
 * @nudo:refine x positive
 */
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
/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
const api = { needsPositive };
api.needsPositive(5);
`,
    expect: "ok",
  },
  // --- 结构可赋值 ---
  {
    id: "assign-compatible-ok",
    origin: "结构赋值",
    source: `
let a = { x: 1 };
a = { x: 2 };
`,
    expect: "ok",
  },
  {
    id: "assign-missing-slot-violates",
    origin: "结构赋值",
    source: `
let a = { x: 1 };
a = { y: 2 };
`,
    expect: "violation",
    note: "缺 x；多 y 允许（宽度）",
  },
  {
    id: "assign-wider-ok",
    origin: "结构赋值",
    source: `
let a = { x: 1 };
a = { x: 2, z: "s" };
`,
    expect: "ok",
  },
  {
    id: "assign-prim-mismatch-violates",
    origin: "结构赋值",
    source: `
let n = 1;
n = "str";
`,
    expect: "violation",
  },
  // --- 传参结构 ---
  {
    id: "arg-structure-ok",
    origin: "传参结构",
    source: `
function readX(p) {
  return p.x;
}
readX({ x: 1 });
`,
    expect: "ok",
  },
  {
    id: "arg-missing-slot-ok",
    origin: "传参结构",
    source: `
function readXY(p) {
  return p.x + p.y;
}
readXY({ x: 1 });
`,
    expect: "ok",
    note: "C0.1：无显式契约时 body 访问不发明义务；缺字段仅在侧车/手写 shape 契约下报",
  },
  {
    id: "arg-extra-slot-ok",
    origin: "传参结构",
    source: `
function readX(p) {
  return p.x;
}
readX({ x: 1, z: 2 });
`,
    expect: "ok",
  },
  {
    id: "arg-same-name-params-isolated",
    origin: "传参结构·同名参数隔离",
    source: `
function readXY(p) {
  return p.x + p.y;
}
function readX(p) {
  return p.x;
}
readXY({ x: 1, y: 2 });
readX({ x: 1, z: 9 });
`,
    expect: "ok",
    note: "同名参数在兄弟函数里的访问不得互相污染（曾把 readXY 的 y 漏进 readX 的必填 slot）",
  },
  {
    id: "arg-ident-missing-slot-ok",
    origin: "传参结构·标识符",
    source: `
function readXY(p) {
  return p.x + p.y;
}
const o = { x: 1 };
readXY(o);
`,
    expect: "ok",
    note: "C0.1：标识符绑定同样不走 body 必填 slot",
  },
  {
    id: "arg-ident-ok",
    origin: "传参结构·标识符",
    source: `
function readX(p) {
  return p.x;
}
const o = { x: 1 };
readX(o);
`,
    expect: "ok",
  },
  // --- 递归：门禁必须可完成，截断只 warning ---
  {
    id: "recursion-fac-ok",
    origin: "递归·阶乘",
    source: `
function fac(n) {
  if (n <= 1) return 1;
  return n * fac(n - 1);
}
const x = fac(5);
`,
    expect: "ok",
    note: "递归截断记 warning，不得 error；check 不得栈溢出",
  },
  {
    id: "recursion-mutual-ok",
    origin: "递归·互递归",
    source: `
function isEven(n) {
  if (n === 0) return true;
  return isOdd(n - 1);
}
function isOdd(n) {
  if (n === 0) return false;
  return isEven(n - 1);
}
const e = isEven(4);
`,
    expect: "ok",
  },
  {
    id: "recursion-with-refine-ok",
    origin: "递归·有 return 契约",
    source: `
/**
 * @nudo:refine return positive
 */
function sumTo(n) {
  if (n <= 1) return 1;
  return n + sumTo(n - 1);
}
const s = sumTo(10);
`,
    expect: "ok",
    note: "截断后 conf 降级，不得把 opaque 误报成 constraint-violated",
  },
  // --- any：任意值 ≠ 分析失败 ---
  {
    id: "any-param-call-ok",
    origin: "any·无契约参数",
    source: `
function id(x) {
  return x;
}
id(1);
id("a");
`,
    expect: "ok",
  },
  {
    id: "any-assign-to-number-ok",
    origin: "any·源侧放行",
    source: `
/**
 * @nudo:refine n positive
 */
function needsPos(n) {
  if (n > 0) return n;
  return 0;
}
function wrap(v) {
  return needsPos(v);
}
`,
    expect: "ok",
    note: "any ≤ 任意目标：wrap 的 v 为 any，不构成 error（文档化语义）",
  },
  {
    id: "literal-still-violates-through-wrapper",
    origin: "any·不吞字面量违例",
    source: `
/**
 * @nudo:refine n positive
 */
function needsPos(n) {
  if (n > 0) return n;
  return 0;
}
function wrap(v) {
  return needsPos(v);
}
wrap(0);
`,
    expect: "violation",
    note: "经 wrapper 的字面量 0 仍须报 constraint-violated",
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
  /** 人工备注：case 语义或预期依据 */
  note?: string;
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
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine x positive
 */
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
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine x positive
 */
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
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine x positive
 */
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
/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine x positive
 */
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
export /// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
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
export /// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
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
export /// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
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
export /// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
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
export /// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
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
export /// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
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
export /// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:refine x positive
 */
function needsPositive(x) {
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
  return checkSource(`gold-${g.id}.js`, withStdImport(g.source), pTrue, stdOpts);
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
          r.issues.some(
            (i) =>
              i.severity === "error" &&
              (i.code === "nudo:constraint-violated" ||
                i.code === "nudo:assign-mismatch" ||
                i.code === "nudo:arg-structure"),
          ),
          `expected violation, got: ${r.issues.map((i) => `${i.code} ${i.message}`).join("; ") || "ok"}`,
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
        loadModule: (spec) => (spec.includes("std.nudo") ? STD_NUDO_SRC : g.modules[spec]),
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
        loadModule: (spec) => (spec.includes("std.nudo") ? STD_NUDO_SRC : g.modules[spec]),
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
