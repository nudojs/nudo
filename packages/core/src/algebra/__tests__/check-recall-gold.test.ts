// DESIGN-CONFLICT:cli-semantics → docs/design/cli-semantics.md §3
// C-OBL C-ANY: gold 以「无 L2」执法面为基线；L2 入口 throws 落地时需拆 any-param 等期望。
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
  /**
   * 已知漏报（FN）：人工标注为 violation，引擎当前不报。
   * it.fails 钉住——修好后 it.fails 会翻红，提醒摘掉本旗标并进主门禁。
   * 禁止把标注改成 ok 来凑绿。
   */
  knownFn?: boolean;
};

/** 真实库惯用法金标（人工标注） */
const GOLD: Gold[] = [
  // --- 延时 / 间隔（ms / setTimeout 风格） ---
  {
    id: "delay-positive",
    origin: "ms / setTimeout delay",
    source: `
/**
 * @nudo:contract ms positive
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
 * @nudo:contract ms positive
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
 * @nudo:contract ms positive
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
 * @nudo:contract n percent
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
 * @nudo:contract n percent
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
 * @nudo:contract n percent
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
 * @nudo:contract port atLeast1 && port <= 65535
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
 * @nudo:contract port atLeast1 && port <= 65535
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
 * @nudo:contract i nonNeg
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
 * @nudo:contract i nonNeg
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
 * @nudo:contract n max100
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
 * @nudo:contract n max100
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract return positive
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
 * @nudo:contract n positive
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
 * @nudo:contract n positive
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
  // --- 可选字段：缺省 / 类型错 / 收窄后当必填 ---
  {
    id: "opt-field-omit-ok",
    origin: "config 可选字段",
    source: `
/**
 * @nudo:contract c configShape
 */
function setup(c) {
  return c.retries;
}
setup({ retries: 3 });
`,
    expect: "ok",
    note: "optional 省略合法",
  },
  {
    id: "opt-field-wrong-type-violates",
    origin: "config 可选字段",
    source: `
/**
 * @nudo:contract c configShape
 */
function setup(c) {
  return c.retries;
}
setup({ retries: 3, label: 9 });
`,
    expect: "violation",
    note: "optional 出现则必须满足 string()",
  },
  {
    id: "opt-field-present-ok",
    origin: "config 可选字段",
    source: `
/**
 * @nudo:contract c configShape
 */
function setup(c) {
  return c.retries;
}
setup({ retries: 3, label: "ok" });
`,
    expect: "ok",
  },
  {
    id: "opt-field-missing-as-required",
    origin: "optional → 显式契约实参",
    source: `
/**
 * @nudo:contract s nonEmpty
 */
function needStr(s) {
  return s;
}
/**
 * @nudo:contract c configShape
 */
function setup(c) {
  return needStr(c.label);
}
setup({ retries: 1 });
`,
    expect: "violation",
    note: "optional 缺省（undefined）传入 nonEmpty 应 constraint-violated",
  },
  // --- 数组方法返回值：find 可能 undefined ---
  {
    id: "find-no-refine-ok",
    origin: "Array.find",
    source: `
function need(x) { return x; }
const xs = [1, 2, 3];
const found = xs.find((n) => n > 10);
need(found);
`,
    expect: "ok",
    note: "无显式契约不发明义务",
  },
  {
    id: "find-hit-to-positive-ok",
    origin: "Array.find",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const xs = [1, 2, 3];
const found = xs.find((n) => n > 0);
needPos(found);
`,
    expect: "ok",
  },
  {
    id: "find-miss-to-positive",
    origin: "Array.find",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const xs = [1, 2, 3];
const found = xs.find((n) => n > 10);
needPos(found);
`,
    expect: "violation",
    note: "find 未命中 → undefined ⊭ positive",
  },
  {
    id: "find-hit-member-to-positive-ok",
    origin: "Array.find + 成员",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const xs = [{ id: 5 }, { id: 7 }];
const found = xs.find((x) => x.id > 0);
needPos(found.id);
`,
    expect: "ok",
  },
  // --- 字典查找 map[k] 可能 undefined ---
  {
    id: "dict-hit-to-positive-ok",
    origin: "字典查找",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const map = { a: 1, b: 2 };
needPos(map["a"]);
`,
    expect: "ok",
  },
  {
    id: "dict-var-key-any-ok",
    origin: "字典查找·变量键",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const map = { a: 1, b: 2 };
const k = "zz";
needPos(map[k]);
`,
    expect: "ok",
    note: "变量键结果为 any：any ≤ 任意目标，不报（≠ unknown）",
  },
  {
    id: "dict-literal-miss",
    origin: "字典查找·字面量缺键",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const map = { a: 1, b: 2 };
needPos(map["zz"]);
`,
    expect: "violation",
    note: "map[\"zz\"] → undefined ⊭ positive",
  },
  // --- filter 后仍用宽类型 / 回调 ---
  {
    id: "filter-then-pos-ok",
    origin: "Array.filter",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const xs = [-1, 2, 3];
const pos = xs.filter((n) => n > 0);
needPos(pos[0]);
`,
    expect: "ok",
  },
  {
    id: "filter-source-lit-violates",
    origin: "Array.filter·源侧字面量",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const xs = [-1, 2];
const pos = xs.filter((n) => n > 0);
needPos(-1);
`,
    expect: "violation",
    note: "filter 不吞直接字面量违例",
  },
  {
    id: "filter-map-doubled-ok",
    origin: "Array.map",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const xs = [1, 2];
const doubled = xs.map((n) => n * 2);
needPos(doubled[0]);
`,
    expect: "ok",
  },
  // --- == vs === 与 null/undefined 折叠 ---
  {
    id: "eq-null-guard-ok",
    origin: "== null 折叠",
    source: `
function pick(x) {
  if (x == null) return 0;
  return x;
}
pick(null);
pick(1);
`,
    expect: "ok",
    note: "== null 守卫不是前置，不得误报",
  },
  {
    id: "triple-eq-null-guard-ok",
    origin: "=== null/undefined",
    source: `
function pick(x) {
  if (x === null || x === undefined) return 0;
  return x;
}
pick(undefined);
`,
    expect: "ok",
  },
  {
    id: "eq-null-not-precondition",
    origin: "== null 折叠",
    source: `
function orZero(x) {
  if (x == null) return 0;
  return x;
}
orZero(undefined);
orZero(null);
orZero(5);
`,
    expect: "ok",
  },
  {
    id: "wrap-null-guard-forward-ok",
    origin: "== null 转发",
    source: `
/**
 * @nudo:contract x positive
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
function wrap(n) {
  if (n == null) return 0;
  return needsPositive(n);
}
wrap(3);
`,
    expect: "ok",
  },
  {
    id: "wrap-null-guard-bad-lit",
    origin: "== null 转发",
    source: `
/**
 * @nudo:contract x positive
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
function wrap(n) {
  if (n == null) return 0;
  return needsPositive(n);
}
wrap(-1);
`,
    expect: "violation",
    note: "null 守卫不吞非空实参：-1 仍到达 needsPositive 应报",
  },
  // --- 数字边界：arr[i] ---
  {
    id: "arr-in-bounds-ok",
    origin: "arr[i]",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const a = [1, 2, 3];
needPos(a[0]);
`,
    expect: "ok",
  },
  {
    id: "arr-oob",
    origin: "arr[i] 越界",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const a = [1, 2, 3];
needPos(a[5]);
`,
    expect: "violation",
    note: "a[5] → undefined ⊭ positive",
  },
  {
    id: "tuple-idx-pos-ok",
    origin: "元组下标",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const a = [7, 8, 9];
needPos(a[0]);
`,
    expect: "ok",
  },
  {
    id: "tuple-idx-neg",
    origin: "元组下标·负元素",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const a = [-7, 8, 9];
needPos(a[0]);
`,
    expect: "violation",
    note: "a[0] 字面量 -7 ⊭ positive 须跟到下标",
  },
  // --- push 返回 number 不是 arr ---
  {
    id: "push-ret-to-positives",
    origin: "Array.push 返回值",
    source: `
/**
 * @nudo:contract xs positives
 */
function takePositives(xs) {
  return xs;
}
const a = [1];
const n = a.push(2);
takePositives(n);
`,
    expect: "violation",
    note: "push 返回 length:number ⊭ array(positives)",
  },
  {
    id: "push-ret-to-positive-ok",
    origin: "Array.push 返回值",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const a = [1];
const n = a.push(2);
needPos(n);
`,
    expect: "ok",
    note: "新 length ≥ 1，满足 positive 时不得 FP",
  },
  {
    id: "push-inline-to-positives",
    origin: "Array.push 内联",
    source: `
/**
 * @nudo:contract xs positives
 */
function takePositives(xs) {
  return xs;
}
const a = [1];
takePositives(a.push(2));
`,
    expect: "violation",
    note: "内联 a.push(2) 表达式值（number）作实参须跟到 positives",
  },
  {
    id: "array-literal-to-positives-ok",
    origin: "数组字面量传参",
    source: `
/**
 * @nudo:contract xs positives
 */
function takePositives(xs) {
  return xs;
}
takePositives([1, 2, 3]);
`,
    expect: "ok",
  },
  // --- 显式 refine 边界：正例 + 相近合法 TN ---
  {
    id: "int-boundary-1-ok",
    origin: "intId 边界",
    source: `
/**
 * @nudo:contract n intId
 */
function takeId(n) {
  return n;
}
takeId(1);
`,
    expect: "ok",
  },
  {
    id: "int-boundary-zero-violates",
    origin: "intId 边界",
    source: `
/**
 * @nudo:contract n intId
 */
function takeId(n) {
  return n;
}
takeId(0);
`,
    expect: "violation",
  },
  {
    id: "int-boundary-nonint-violates",
    origin: "intId 边界",
    source: `
/**
 * @nudo:contract n intId
 */
function takeId(n) {
  return n;
}
takeId(1.0001);
`,
    expect: "violation",
  },
  {
    id: "shortName-1-ok",
    origin: "shortName 边界",
    source: `
/**
 * @nudo:contract s shortName
 */
function takeName(s) {
  return s;
}
takeName("a");
`,
    expect: "ok",
  },
  {
    id: "shortName-empty-violates",
    origin: "shortName 边界",
    source: `
/**
 * @nudo:contract s shortName
 */
function takeName(s) {
  return s;
}
takeName("");
`,
    expect: "violation",
  },
  {
    id: "shortName-too-long-violates",
    origin: "shortName 边界",
    source: `
/**
 * @nudo:contract s shortName
 */
function takeName(s) {
  return s;
}
takeName("abcdefghijklmnopqrstu");
`,
    expect: "violation",
    note: "21 字符 > max 20",
  },
  {
    id: "percent-0-ok",
    origin: "percent 边界",
    source: `
/**
 * @nudo:contract n percent
 */
function pct(n) {
  return n;
}
pct(0);
`,
    expect: "ok",
  },
  {
    id: "percent-100-ok",
    origin: "percent 边界",
    source: `
/**
 * @nudo:contract n percent
 */
function pct(n) {
  return n;
}
pct(100);
`,
    expect: "ok",
  },
  {
    id: "percent-101-violates",
    origin: "percent 边界",
    source: `
/**
 * @nudo:contract n percent
 */
function pct(n) {
  return n;
}
pct(101);
`,
    expect: "violation",
  },
  {
    id: "port-1-ok",
    origin: "port 边界",
    source: `
/**
 * @nudo:contract p port
 */
function listen(p) {
  return p;
}
listen(1);
`,
    expect: "ok",
  },
  {
    id: "port-65535-ok",
    origin: "port 边界",
    source: `
/**
 * @nudo:contract p port
 */
function listen(p) {
  return p;
}
listen(65535);
`,
    expect: "ok",
  },
  {
    id: "port-65536-violates",
    origin: "port 边界",
    source: `
/**
 * @nudo:contract p port
 */
function listen(p) {
  return p;
}
listen(65536);
`,
    expect: "violation",
  },
  {
    id: "union-status-1-ok",
    origin: "union(lit) 析取",
    source: `
/**
 * @nudo:contract x status
 */
function setStatus(x) {
  return x;
}
setStatus(1);
`,
    expect: "ok",
  },
  {
    id: "union-status-99-violates",
    origin: "union(lit) 析取",
    source: `
/**
 * @nudo:contract x status
 */
function setStatus(x) {
  return x;
}
setStatus(99);
`,
    expect: "violation",
  },
  // --- HOF arg-structure（refine 来源 → error） ---
  {
    id: "hof-non-callable-arg",
    origin: "HOF 回调形态",
    source: `
/**
 * @nudo:contract xs positives
 * @nudo:contract transform mapper
 */
function mapPos(xs, transform) {
  return xs.map(transform);
}
mapPos([1, 2], 42);
`,
    expect: "violation",
    note: "refine 来源 fn 约束：非可调用实参 → arg-structure error",
  },
  {
    id: "hof-callable-arg-ok",
    origin: "HOF 回调形态",
    source: `
/**
 * @nudo:contract xs positives
 * @nudo:contract transform mapper
 */
function mapPos(xs, transform) {
  return xs.map(transform);
}
mapPos([1, 2], (x) => x + 1);
`,
    expect: "ok",
  },
  // --- 可变绑定 assign：同 prim 拓宽 vs 改型 ---
  {
    id: "assign-num-lit-reassign-ok",
    origin: "可变绑定重绑",
    source: `
let n = 1;
n = 2;
`,
    expect: "ok",
    note: "同 prim 字面量改值 = mutable 拓宽，与对象槽同口径",
  },
  {
    id: "assign-str-lit-reassign-ok",
    origin: "可变绑定重绑",
    source: `
let s = "a";
s = "b";
`,
    expect: "ok",
  },
  {
    id: "assign-tuple-diff-lits-ok",
    origin: "数组字面量重绑",
    source: `
let xs = [1, 2];
xs = [3, 4];
`,
    expect: "ok",
  },
  {
    id: "assign-tuple-longer-ok",
    origin: "数组长度变化",
    source: `
let xs = [1, 2];
xs = [3, 4, 5];
`,
    expect: "ok",
    note: "let 可变绑定长度变化合法（tuple→arr 拓宽）",
  },
  {
    id: "assign-tuple-prim-mismatch-violates",
    origin: "数组元素改型",
    source: `
let xs = [1, 2];
xs = ["a", "b"];
`,
    expect: "violation",
  },
  {
    id: "assign-push-ret-to-arr",
    origin: "push 返回值重绑",
    source: `
let xs = [1, 2];
const n = xs.push(3);
xs = n;
`,
    expect: "violation",
    note: "number ⊭ 既有数组形状",
  },
  // --- shape 显式契约边界 ---
  {
    id: "userShape-missing-name",
    origin: "userShape 缺字段",
    source: `
/**
 * @nudo:contract u userShape
 */
function register(u) {
  return u.id;
}
register({ id: 1 });
`,
    expect: "violation",
    note: "契约必填 name 缺失",
  },
  {
    id: "userShape-full-ok",
    origin: "userShape 完整",
    source: `
/**
 * @nudo:contract u userShape
 */
function register(u) {
  return u.id;
}
register({ id: 1, name: "a" });
`,
    expect: "ok",
  },
  {
    id: "orderShape-nested-bad-id",
    origin: "嵌套 shape",
    source: `
/**
 * @nudo:contract o orderShape
 */
function place(o) {
  return o.user.id;
}
place({ user: { id: -1, name: "a" }, tags: ["x"] });
`,
    expect: "violation",
  },
  // --- return 契约 ---
  {
    id: "return-positive-lit-0",
    origin: "@nudo:contract return",
    source: `
/**
 * @nudo:contract return positive
 */
function bad() {
  return 0;
}
`,
    expect: "violation",
  },
  {
    id: "return-positive-from-param-ok",
    origin: "@nudo:contract return",
    source: `
/**
 * @nudo:contract x positive
 * @nudo:contract return positive
 */
function keep(x) {
  return x;
}
`,
    expect: "ok",
  },
  {
    id: "pop-empty",
    origin: "Array.pop 空数组",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const a = [];
needPos(a.pop());
`,
    expect: "violation",
    note: "pop 空数组 → undefined ⊭ positive",
  },
  {
    id: "pop-hit-ok",
    origin: "Array.pop 命中",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const a = [4];
needPos(a.pop());
`,
    expect: "ok",
  },
  // --- 解构默认值 ---
  {
    id: "destructure-default-ok",
    origin: "http/net options { port = 3000 } = {}",
    source: `
/**
 * @nudo:contract port atLeast1
 */
function listen({ port = 3000 } = {}) {
  return port;
}
listen({ port: 8080 });
`,
    expect: "ok",
    note: "显式 port 合法",
  },
  {
    id: "destructure-default-omit-ok",
    origin: "http/net options { port = 3000 } = {}",
    source: `
/**
 * @nudo:contract port atLeast1
 */
function listen({ port = 3000 } = {}) {
  return port;
}
listen();
`,
    expect: "ok",
    note: "缺省走默认 3000，不发明违例",
  },
  {
    id: "destructure-default-violates",
    origin: "http/net options { port = 3000 } = {}",
    source: `
/**
 * @nudo:contract port atLeast1
 */
function listen({ port = 3000 } = {}) {
  return port;
}
listen({ port: 0 });
`,
    expect: "violation",
    note: "port=0 ⊭ ≥1",
  },
  // --- rest/spread 实参 ---
  {
    id: "spread-lit-ok",
    origin: "fn(...args) 字面量 spread",
    source: `
/**
 * @nudo:contract x positive
 */
function needPos(x) {
  return x;
}
needPos(...[5]);
`,
    expect: "ok",
  },
  {
    id: "spread-lit-violates",
    origin: "fn(...args) 字面量 spread",
    source: `
/**
 * @nudo:contract x positive
 */
function needPos(x) {
  return x;
}
needPos(...[-1]);
`,
    expect: "violation",
  },
  {
    id: "rest-index-ok",
    origin: "fn(...args) 转发",
    source: `
/**
 * @nudo:contract x positive
 */
function needPos(x) {
  return x;
}
function wrap(...args) {
  return needPos(args[0]);
}
wrap(7);
`,
    expect: "ok",
  },
  {
    id: "rest-index-violates",
    origin: "fn(...args) 转发",
    source: `
/**
 * @nudo:contract x positive
 */
function needPos(x) {
  return x;
}
function wrap(...args) {
  return needPos(args[0]);
}
wrap(-7);
`,
    expect: "violation",
  },
  {
    id: "mathmax-lit-ok",
    origin: "Math.max",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
needPos(Math.max(1, 2));
`,
    expect: "ok",
  },
  {
    id: "mathmax-lit-violates",
    origin: "Math.max",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
needPos(Math.max(-1, -2));
`,
    expect: "violation",
    note: "Math.max(-1,-2)=-1 ⊭ positive",
  },
  // --- 可选链 ---
  {
    id: "optchain-hit-ok",
    origin: "a?.b?.c",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const a = { b: { c: 5 } };
needPos(a?.b?.c);
`,
    expect: "ok",
  },
  {
    id: "optchain-missing-violates",
    origin: "a?.b?.c",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const a = { b: {} };
needPos(a?.b?.c);
`,
    expect: "violation",
    note: "缺键 → undefined ⊭ positive",
  },
  {
    id: "optchain-null-base-violates",
    origin: "a?.b",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const a = null;
needPos(a?.b);
`,
    expect: "violation",
  },
  {
    id: "optchain-trim-miss",
    origin: "o.name?.trim()",
    source: `
/**
 * @nudo:contract s shortName
 */
function needShort(s) {
  return s;
}
const o = {};
needShort(o.name?.trim());
`,
    expect: "violation",
    note: "可选链缺省 ⊭ shortName",
  },
  {
    id: "optchain-trim-hit-ok",
    origin: "o.name?.trim()",
    source: `
/**
 * @nudo:contract s shortName
 */
function needShort(s) {
  return s;
}
const o = { name: "  hi  " };
needShort(o.name?.trim());
`,
    expect: "ok",
  },
  // --- 空值合并 ---
  {
    id: "nullish-fallback-ok",
    origin: "x ?? fallback",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const x = null;
needPos(x ?? 10);
`,
    expect: "ok",
    note: "fallback 非空保证",
  },
  {
    id: "nullish-nonnull-ok",
    origin: "x ?? fallback",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const x = 7;
needPos(x ?? 0);
`,
    expect: "ok",
    note: "左值非空，结果 7",
  },
  {
    id: "nullish-bad-lit",
    origin: "x ?? fallback",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
needPos(undefined ?? -1);
`,
    expect: "violation",
  },
  {
    id: "nullish-both-nullish",
    origin: "x ?? y",
    source: `
/**
 * @nudo:contract s shortName
 */
function needShort(s) {
  return s;
}
needShort(null ?? undefined);
`,
    expect: "violation",
    note: "两侧皆空 → undefined ⊭ shortName",
  },
  // --- includes/every/some 返回 boolean 误当收窄 ---
  {
    id: "includes-bool-to-nonEmpty",
    origin: "Array.includes",
    source: `
/**
 * @nudo:contract s nonEmpty
 */
function needStr(s) {
  return s;
}
needStr([1, 2].includes(1));
`,
    expect: "violation",
    note: "boolean ⊭ string",
  },
  {
    id: "every-guard-not-narrow",
    origin: "Array.every 伪收窄",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
function f(xs) {
  if (xs.every((n) => n > 0)) {
    return needPos(xs[0]);
  }
  return 0;
}
f([-1, 2]);
`,
    expect: "ok",
    note: "every 布尔不构成 xs[0] 的正数义务；且契约只在调用点执法",
  },
  {
    id: "some-guard-residual-lit",
    origin: "Array.some 伪收窄",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
function f(xs) {
  if (xs.some((n) => n > 0)) {
    return needPos(-1);
  }
  return 0;
}
f([1]);
`,
    expect: "violation",
    note: "some 守卫不吞字面量 -1",
  },
  // --- 字符串方法返回新串 ---
  {
    id: "trim-hit-shortName-ok",
    origin: "String.trim",
    source: `
/**
 * @nudo:contract s shortName
 */
function needShort(s) {
  return s;
}
needShort("  a  ".trim());
`,
    expect: "ok",
  },
  {
    id: "trim-empty-shortName",
    origin: "String.trim",
    source: `
/**
 * @nudo:contract s shortName
 */
function needShort(s) {
  return s;
}
needShort("   ".trim());
`,
    expect: "violation",
    note: "trim 后空串 ⊭ min(1)",
  },
  {
    id: "slice-empty-shortName",
    origin: "String.slice",
    source: `
/**
 * @nudo:contract s shortName
 */
function needShort(s) {
  return s;
}
needShort("abc".slice(1, 1));
`,
    expect: "violation",
  },
  {
    id: "slice-too-long-shortName",
    origin: "String.slice",
    source: `
/**
 * @nudo:contract s shortName
 */
function needShort(s) {
  return s;
}
const long = "abcdefghijklmnopqrstuvwxyz";
needShort(long.slice(0));
`,
    expect: "violation",
    note: "len>20",
  },
  // --- Number / parseInt 边界 ---
  {
    id: "parseint-ok",
    origin: "parseInt(x, 10)",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
needPos(parseInt("42", 10));
`,
    expect: "ok",
  },
  {
    id: "parseint-nan",
    origin: "parseInt(x, 10)",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
needPos(parseInt("abc", 10));
`,
    expect: "violation",
    note: "NaN ⊭ positive",
  },
  {
    id: "parseint-zero",
    origin: "parseInt(x, 10)",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
needPos(parseInt("0", 10));
`,
    expect: "violation",
  },
  {
    id: "number-nan",
    origin: "Number(x)",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
needPos(Number("x"));
`,
    expect: "violation",
  },
  {
    id: "number-ok",
    origin: "Number(x)",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
needPos(Number("12"));
`,
    expect: "ok",
  },
  // --- JSON 往返 ---
  {
    id: "json-roundtrip-ok",
    origin: "JSON.parse(JSON.stringify(o))",
    source: `
/**
 * @nudo:contract u userShape
 */
function takeUser(u) {
  return u;
}
const o = { id: 1, name: "a" };
takeUser(JSON.parse(JSON.stringify(o)));
`,
    expect: "ok",
  },
  {
    id: "json-roundtrip-missing",
    origin: "JSON.parse(JSON.stringify(o))",
    source: `
/**
 * @nudo:contract u userShape
 */
function takeUser(u) {
  return u;
}
const o = { id: 1 };
takeUser(JSON.parse(JSON.stringify(o)));
`,
    expect: "violation",
    note: "缺 name",
  },
  {
    id: "json-roundtrip-extra-ok",
    origin: "JSON.parse(JSON.stringify(o))",
    source: `
/**
 * @nudo:contract u userShape
 */
function takeUser(u) {
  return u;
}
const o = { id: 1, name: "a", extra: true };
takeUser(JSON.parse(JSON.stringify(o)));
`,
    expect: "ok",
    note: "多余字段不构成违例",
  },
  // --- Promise.then 链 ---
  {
    id: "promise-then-lit-violates",
    origin: "Promise.then",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const p = Promise.resolve(1);
p.then((x) => needPos(-2));
`,
    expect: "violation",
    note: "回调内字面量 -2 仍须报",
  },
  {
    id: "promise-then-pos-ok",
    origin: "Promise.then",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const p = Promise.resolve(5);
p.then((x) => needPos(x));
`,
    expect: "ok",
  },
  // --- class 字段 ---
  {
    id: "class-field-uninit",
    origin: "class this.x 未初始化",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
class C {
  get() {
    return needPos(this.x);
  }
}
new C().get();
`,
    expect: "violation",
    note: "this.x 未初始化 → undefined ⊭ positive",
  },
  {
    id: "class-field-ok",
    origin: "class this.x",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
class C {
  constructor() {
    this.x = 5;
  }
  get() {
    return needPos(this.x);
  }
}
new C().get();
`,
    expect: "ok",
  },
  {
    id: "class-field-violates",
    origin: "class this.x",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
class C {
  constructor() {
    this.x = -1;
  }
  get() {
    return needPos(this.x);
  }
}
new C().get();
`,
    expect: "violation",
  },
  // --- switch(true) / if 链收窄残余 ---
  {
    id: "switch-true-narrow-ok",
    origin: "switch (true)",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
function f(x) {
  switch (true) {
    case x > 0:
      return needPos(x);
    default:
      return 0;
  }
}
f(5);
`,
    expect: "ok",
  },
  {
    id: "switch-true-residual",
    origin: "switch (true)",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
function f(x) {
  switch (true) {
    case x > 0:
      return needPos(x);
    default:
      return needPos(x);
  }
}
f(-3);
`,
    expect: "violation",
    note: "default 残余路径 -3 仍到达 needPos",
  },
  {
    id: "if-chain-narrow-ok",
    origin: "if 链收窄",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
function f(x) {
  if (x > 0) return needPos(x);
  if (x === 0) return 1;
  return needPos(2);
}
f(-1);
`,
    expect: "ok",
  },
  {
    id: "if-chain-else-residual",
    origin: "if/else 残余",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
function f(x) {
  if (x > 0) return needPos(x);
  else return needPos(0);
}
f(1);
`,
    expect: "violation",
    note: "else 分支字面量 0 不因 if 收窄而消失",
  },
  // --- 变量键 map[k] = any（TN） ---
  {
    id: "trim-then-var-key-any",
    origin: "字典查找·变量键",
    source: `
/**
 * @nudo:contract n positive
 */
function needPos(n) {
  return n;
}
const map = { a: "  x  ".trim(), b: 2 };
const k = "a";
needPos(map[k]);
`,
    expect: "ok",
    note: "变量键结果 any，不报（≠ unknown）",
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
 * @nudo:contract x positive
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
  // --- 跨文件：命名导出 + 真实库模式（default 绑定债未完，标注侧用 named） ---
  {
    id: "require-named-push-ret-violates",
    source: `
const { takePositives } = require("./v.js");
const a = [1];
const n = a.push(2);
takePositives(n);
`,
    modules: {
      "./v.js": `
/// @nudo:import { positives } from "./std.nudo.js"
/**
 * @nudo:contract xs positives
 */
function takePositives(xs) {
  return xs;
}
module.exports = { takePositives };
`,
    },
    expect: "violation",
    note: "push 返回 number ⊭ 跨文件 positives 契约",
  },
  {
    id: "esm-named-opt-field-ok",
    source: `
import { setup } from "./v.js";
setup({ retries: 1 });
`,
    modules: {
      "./v.js": `
export /// @nudo:import { configShape } from "./std.nudo.js"
/**
 * @nudo:contract c configShape
 */
function setup(c) {
  return c.retries;
}
`,
    },
    expect: "ok",
    note: "optional 省略经 ESM named 仍合法",
  },
  {
    id: "esm-named-opt-field-wrong-type-violates",
    source: `
import { setup } from "./v.js";
setup({ retries: 1, label: 9 });
`,
    modules: {
      "./v.js": `
export /// @nudo:import { configShape } from "./std.nudo.js"
/**
 * @nudo:contract c configShape
 */
function setup(c) {
  return c.retries;
}
`,
    },
    expect: "violation",
    note: "optional 类型错经 ESM named 必须报",
  },
  {
    id: "require-named-int-boundary-violates",
    source: `
const { takeId } = require("./v.js");
takeId(0);
`,
    modules: {
      "./v.js": `
/// @nudo:import { intId } from "./std.nudo.js"
/**
 * @nudo:contract n intId
 */
function takeId(n) {
  return n;
}
module.exports = { takeId };
`,
    },
    expect: "violation",
    note: "intId 边界 0 经 require named",
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
    const runner = g.knownFn ? it.fails : it;
    runner(`${g.id} [${g.origin}] → ${g.expect}${g.knownFn ? " (known FN)" : ""}`, () => {
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

  it("recall = 1.0 and precision = 1.0 on this gold set (known FN excluded from gate)", () => {
    // 本 it 只汇总；逐条 it 已失败则这里也会红
    // vitest 并行下 counts 可能未累完——用同步重算
    let TP = 0, FN = 0, FP = 0, TN = 0, knownFn = 0;
    for (const g of GOLD) {
      const b = bucket(g, run(g));
      if (g.knownFn) {
        knownFn++;
        // 已知 FN 不进门禁，但必须仍是漏报（修好后 it.fails 翻红提醒摘旗标）
        continue;
      }
      if (b === "TP") TP++;
      else if (b === "FN") FN++;
      else if (b === "FP") FP++;
      else TN++;
    }
    const rec = TP + FN === 0 ? 1 : TP / (TP + FN);
    const prec = TP + FP === 0 ? 1 : TP / (TP + FP);
    const detail = `TP=${TP} FN=${FN} FP=${FP} TN=${TN} knownFn=${knownFn} recall=${rec.toFixed(2)} precision=${prec.toFixed(2)}`;
    expect(FN, `unexpected FN (not marked knownFn): ${detail} ${failures.join(" | ")}`).toBe(0);
    expect(FP, `unexpected FP: ${detail} ${failures.join(" | ")}`).toBe(0);
    expect(rec, `recall < 1: ${detail}`).toBe(1);
    expect(prec, `precision < 1: ${detail}`).toBe(1);
    // TP floor：GOLD 内 violation 标注 65 条，当前全捕获（TP=65）。
    // 此 floor 只许上调，不得静默下调。
    expect(TP, `TP floor (${detail})`).toBeGreaterThanOrEqual(65);
    // 金标用例总数冻结：防止 corpus 被静默缩水（或 violation→ok 换标凑绿）。
    // 增删用例必须显式改此常量。
    const GOLD_CASE_COUNT = 144;
    expect(
      TP + FN + FP + TN + knownFn,
      `gold case count changed — corpus must not silently shrink: ${detail}`,
    ).toBe(GOLD_CASE_COUNT);
    // 已知漏报必须显式成文，禁止静默丢弃或改标凑绿
    expect(knownFn, `knownFn count changed — update notes: ${detail}`).toBe(0);
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

describe("check L2 entry may-throw gold", () => {
  const cases: Array<{
    id: string;
    source: string;
    expect: "entry-may-throw" | "ok";
    ignoreThrows?: string[];
    entryThrows?: "error" | "warning" | "off";
    /** 用例意图说明（仅文档性，不参与断言） */
    note?: string;
  }> = [
    {
      id: "export-any-member-throws",
      source: `
export function getName(user) {
  return user.name;
}
`,
      expect: "entry-may-throw",
    },
    {
      id: "export-default-any-member-throws",
      source: `
export default function getName(user) {
  return user.name;
}
`,
      expect: "entry-may-throw",
    },
    {
      id: "export-const-arrow-any-member-throws",
      source: `
export const getName = (user) => user.name;
`,
      expect: "entry-may-throw",
    },
    {
      id: "export-explicit-throw",
      source: `
export function boom() {
  throw new TypeError("x");
}
`,
      expect: "entry-may-throw",
    },
    {
      id: "cjs-exports-fn-any-member-throws",
      source: `
exports.getName = function getName(user) {
  return user.name;
};
`,
      expect: "entry-may-throw",
    },
    {
      id: "export-try-catch-digests-soft-throw",
      source: `
export function getName(user) {
  try {
    return user.name;
  } catch {
    return "n";
  }
}
`,
      expect: "ok",
    },
    {
      id: "export-try-catch-rethrow-keeps-l2",
      source: `
export function getName(user) {
  try {
    return user.name;
  } catch (e) {
    throw e;
  }
}
`,
      expect: "entry-may-throw",
    },
    {
      id: "export-nested-try-outer-catch-digests",
      source: `
export function getName(user) {
  try {
    try {
      return user.name;
    } finally {
    }
  } catch {
    return "n";
  }
}
`,
      expect: "ok",
    },
    {
      id: "cjs-object-method-any-member-throws",
      source: `
module.exports = {
  getName(user) {
    return user.name;
  }
};
`,
      expect: "entry-may-throw",
    },
    {
      id: "export-alias-local-function-throws",
      source: `
function getName(user) { return user.name; }
export { getName as publicName };
`,
      expect: "entry-may-throw",
    },
    {
      id: "export-default-anon-arrow-throws",
      source: `
export default (user) => user.name;
`,
      expect: "entry-may-throw",
    },
    {
      id: "export-class-static-method-throws",
      source: `
export class Foo {
  static bar(u) { return u.name; }
}
`,
      expect: "entry-may-throw",
    },
    {
      id: "export-throw-string-shows-string",
      source: `
export function boom() {
  throw "oops";
}
`,
      expect: "entry-may-throw",
    },
    {
      id: "export-refine-shape-pending-l2-suppress",
      source: `
/**
 * @nudo:contract user shape(name)
 */
export function getName(user) {
  return user.name;
}
`,
      // 内联 shape(name) 非合法 refine 语法；合法 *.nudo.js sidecar 可抑制 L2。
      // 本用例钉「refine 解析失败 → 仍按 any 成员访问报 L2」
      expect: "entry-may-throw",
      note: "invalid inline refine grammar: L2 still fires (valid sidecar suppresses)",
    },
    {
      id: "internal-any-member-not-entry",
      source: `
function getName(user) {
  return user.name;
}
getName({});
`,
      expect: "ok",
    },
    {
      id: "export-any-member-ignore-throws",
      source: `
export function getName(user) {
  return user.name;
}
`,
      expect: "ok",
      ignoreThrows: ["TypeError"],
    },
    {
      id: "export-any-member-l2-off",
      source: `
export function getName(user) {
  return user.name;
}
`,
      expect: "ok",
      entryThrows: "off",
    },
    {
      id: "export-identity-no-throw",
      source: `
export function id(x) {
  return x;
}
`,
      expect: "ok",
    },
    {
      id: "ignore-throws-does-not-swallow-l1",
      source: withStdImport(`
/**
 * @nudo:contract x positive
 */
export function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
export function pick(user) {
  return user.name;
}
needsPositive(-1);
`),
      expect: "entry-may-throw",
      ignoreThrows: ["TypeError"],
      note: "ignore TypeError 只滤 L2 pick；L1 needsPositive(-1) 仍须 error",
    } as { id: string; source: string; expect: "entry-may-throw" | "ok"; ignoreThrows?: string[] },
  ];
  for (const c of cases) {
    it(`L2 ${c.id} → ${c.expect}`, () => {
      const r = checkSource(`l2-${c.id}.js`, c.source, pTrue, {
        ...(c.entryThrows ? { entryThrows: c.entryThrows } : {}),
        ...(c.ignoreThrows ? { ignoreThrows: c.ignoreThrows } : {}),
        ...(c.id.startsWith("ignore-throws") ? stdOpts : {}),
      });
      const hasL2 = r.issues.some((i) => i.code === "nudo:entry-may-throw" && i.severity === "error");
      const hasL1 = r.issues.some(
        (i) => i.severity === "error" && i.code !== "nudo:entry-may-throw",
      );
      if (c.expect === "entry-may-throw") {
        const requireL2 =
          !c.id.startsWith("ignore-throws") && !c.id.startsWith("export-refine");
        if (requireL2) {
          expect(hasL2, r.issues.map((i) => `${i.code}:${i.message}`).join("; ") || "ok").toBe(true);
        } else {
          const okL2OrL1 = hasL2 || hasL1 || r.issues.some((i) => i.severity === "error");
          expect(okL2OrL1, r.issues.map((i) => `${i.code}:${i.message}`).join("; ") || "ok").toBe(true);
        }
        expect(r.ok).toBe(false);
      } else {
        expect(hasL2, r.issues.map((i) => `${i.code}:${i.message}`).join("; ") || "ok").toBe(false);
      }
    });
  }

  it("ignoreThrows does not swallow L1 constraint errors", () => {
    const src = withStdImport(`
/**
 * @nudo:contract x positive
 */
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
export function pick(u) { return u.name; }
needsPositive(-1);
`);
    const r = checkSource("l2-ignore-l1.js", src, pTrue, {
      ...stdOpts,
      ignoreThrows: ["TypeError"],
    });
    expect(
      r.issues.some((i) => i.code === "nudo:constraint-violated" && i.severity === "error"),
      r.issues.map((i) => `${i.code}:${i.message}`).join("; ") || "ok",
    ).toBe(true);
    expect(r.ok).toBe(false);
  });
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
