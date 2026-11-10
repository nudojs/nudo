/**
 * ABS-06：内建一致性矩阵（host oracle）。
 *
 * 口径：
 * - 每条探针是一段**隐式 return** 的语句体（与 differential 语料同形），
 *   由宿主 oracle（vm strict 原生执行）跑一遍、引擎跑一遍；
 * - 分类三档（**只有这三档**）：
 *   - `modeled`：引擎给出具体值与原生相等（抛域也相等）；
 *   - `unknown`：引擎给非具体 Abs（诚实的过近似），且**没有**声称不可能抛；
 *   - `wrong-exact`：具体值不等 / 引擎抛而原生不抛 / 原生抛而引擎给具体值 /
 *     原生抛而引擎声称「不会抛」（engineNoThrow）。**假精确是唯一门禁项**。
 *
 * 纪律：unknown 保持诚实，不为覆盖率造假精确；扩矩阵只加探针，不改分类判据。
 * 报告生成：`node --import tsx scripts/builtins-consistency-report.ts`（生成物，不手改）。
 */
import { probeBody } from "./differential/harness.ts";

export type ProbeVerdict = "modeled" | "unknown" | "wrong-exact";

export type Probe = {
  /** 报告里的稳定行名（ASCII） */
  name: string;
  /** 隐式 return 的语句体（与 differential 语料同形） */
  body: string;
  /** 说明：覆盖点 / 已知边界（报告列） */
  note?: string;
};

export type ProbeRow = Probe & {
  verdict: ProbeVerdict;
  /** native 渲染串（含 `THROW:` 前缀） */
  native: string;
  /** 引擎具体值 / 形状域（2 选 1，均可缺省） */
  engine?: string;
  engineThrows: boolean;
};

/**
 * 探针表（覆盖计划列出的长尾面）：JSON reviver、TypedArray、模板标签对象、
 * Intl / Proxy / accessor / descriptor、数组 / 字符串 / Object / Math / Number。
 */
export const PROBES: readonly Probe[] = [
  // --- JSON（callable reviver 值域） ---
  { name: "json.parse-plain", body: `return JSON.parse('{"a":1}')`, note: "plain parse" },
  {
    name: "json.parse-reviver",
    body: `return JSON.parse('{"a":1}', (k, v) => v)`,
    note: "callable reviver value domain",
  },
  { name: "json.stringify-object", body: `return JSON.stringify({ a: 1 })` },
  {
    name: "json.stringify-replacer-fn",
    body: `return JSON.stringify({ a: 1 }, (k, v) => v)`,
    note: "callable replacer",
  },
  // --- TypedArray（元素域 / 长度） ---
  { name: "uint8.length", body: `return new Uint8Array([1, 2, 3]).length` },
  { name: "uint8.index0", body: `return new Uint8Array([7, 8]).at(0)` },
  { name: "uint8.slice-len", body: `return new Uint8Array([1, 2, 3]).slice(1).length` },
  { name: "uint8.from-len", body: `return Uint8Array.from([1, 2]).length` },
  { name: "float64.named-len", body: `return new Float64Array(4).length` },
  { name: "uint8.map-instanceof", body: `return new Uint8Array([1]).map((v) => v + 1) instanceof Uint8Array` },
  // --- 模板标签对象（Array.isArray / 数组方法派发） ---
  {
    name: "template-tag-isarray",
    body: `return ((s) => Array.isArray(s))\`x\``,
    note: "template tag object: Array.isArray dispatch (modeled)",
  },
  {
    name: "template-tag-join",
    body: `return ((s) => s.join("|"))\`a\${1}b\``,
    note: "template tag object: array method dispatch (modeled)",
  },
  // --- Intl / Proxy / accessor / descriptor ---
  { name: "intl.numberformat", body: `return new Intl.NumberFormat("en-US").format(1234)` },
  { name: "intl.collator", body: `return new Intl.Collator("en").compare("a", "b")` },
  { name: "proxy-get", body: `const p = new Proxy({ a: 1 }, {}); return p.a` },
  {
    name: "proxy-trap-get",
    body: `const p = new Proxy({}, { get: () => 7 }); return p.anything`,
  },
  {
    name: "getter-read",
    body: `const o = { get x() { return 3; } }; return o.x`,
  },
  {
    name: "descriptor-enumerable",
    body: `const o = {}; Object.defineProperty(o, "a", { value: 1, enumerable: false }); return Object.keys(o).length`,
  },
  {
    name: "defineproperty-writable",
    body: `const o = {}; Object.defineProperty(o, "a", { value: 1, writable: false }); o.a = 2; return o.a`,
  },
  // --- Array ---
  { name: "array.map", body: `return [1, 2, 3].map((n) => n * 2)` },
  { name: "array.filter", body: `return [1, 2, 3].filter((n) => n > 1)` },
  { name: "array.reduce-sum", body: `return [1, 2, 3].reduce((a, b) => a + b, 0)` },
  { name: "array.some", body: `return [1, 2, 3].some((n) => n > 2)` },
  { name: "array.every", body: `return [1, 2, 3].every((n) => n > 0)` },
  { name: "array.find", body: `return [1, 2, 3].find((n) => n === 2)` },
  { name: "array.findindex", body: `return [1, 2, 3].findIndex((n) => n === 3)` },
  { name: "array.includes", body: `return [1, 2].includes(2)` },
  { name: "array.indexof", body: `return [1, 2].indexOf(2)` },
  { name: "array.slice", body: `return [1, 2, 3].slice(1)` },
  { name: "array.concat", body: `return [1].concat([2, 3])` },
  { name: "array.join", body: `return [1, 2].join("-")` },
  { name: "array.flat", body: `return [1, [2, [3]]].flat(2)` },
  { name: "array.at-negative", body: `return [1, 2, 3].at(-1)` },
  { name: "array.sort", body: `return [3, 1, 2].sort()` },
  { name: "array.reverse", body: `return [1, 2].reverse()` },
  { name: "array.fill", body: `return new Array(3).fill(0)` },
  { name: "array.from-map", body: `return Array.from([1, 2], (n) => n + 1)` },
  { name: "array.isarray", body: `return Array.isArray([1])` },
  { name: "array.length-holes", body: `const a = [1, , 3]; return [a.length, 1 in a]` },
  // --- String ---
  { name: "string.split", body: `return "a,b".split(",")` },
  { name: "string.indexof", body: `return "abc".indexOf("b")` },
  { name: "string.tofixed", body: `return (1.234).toFixed(1)` },
  { name: "string.padstart", body: `return "7".padStart(3, "0")` },
  { name: "string.match", body: `return "abc".match(/b/)` },
  { name: "string.replace-all", body: `return "a-b".replaceAll("-", "_")` },
  { name: "string.startswith", body: `return "abc".startsWith("ab")` },
  { name: "string.length", body: `return "abc".length` },
  { name: "string.template-concat", body: `const n = 2; return \`v=\${n}\`` },
  // --- Object ---
  { name: "object.keys", body: `return Object.keys({ a: 1, b: 2 })` },
  { name: "object.values", body: `return Object.values({ a: 1 })` },
  { name: "object.entries", body: `return Object.entries({ a: 1 })` },
  { name: "object.assign", body: `return Object.assign({}, { a: 1 }, { b: 2 })` },
  { name: "object.freeze-isFrozen", body: `return Object.isFrozen(Object.freeze({ a: 1 }))` },
  { name: "object.getownpropertynames", body: `return Object.getOwnPropertyNames({ a: 1, b: 2 })` },
  { name: "object.hasown", body: `return Object.hasOwn({ a: 1 }, "a")` },
  { name: "object.create-null-proto", body: `return Object.getPrototypeOf(Object.create(null))` },
  // --- Math / Number ---
  { name: "math.max", body: `return Math.max(1, 3, 2)` },
  { name: "math.min", body: `return Math.min(1, 3, 2)` },
  { name: "math.round", body: `return Math.round(1.5)` },
  { name: "math.trunc", body: `return Math.trunc(-1.9)` },
  { name: "math.sign", body: `return Math.sign(-3)` },
  { name: "math.hypot", body: `return Math.hypot(3, 4)` },
  { name: "number.isinteger", body: `return Number.isInteger(3)` },
  { name: "number.isfinite", body: `return Number.isFinite(Infinity)` },
  { name: "number.parseint", body: `return Number.parseInt("42px", 10)` },
  { name: "number.parsefloat", body: `return Number.parseFloat("1.5")` },
  { name: "number.tostring-radix", body: `return (255).toString(16)` },
  // --- 抛域探针（引擎不得声称不可能抛） ---
  {
    name: "throw.json-parse-bad",
    body: `return JSON.parse("{")`,
    note: "native throws SyntaxError",
  },
  {
    name: "throw.uint8-negative",
    body: `return new Uint8Array(-1).length`,
    note: "native throws RangeError",
  },
  {
    name: "throw.array-reduce-empty",
    body: `return [].reduce((a, b) => a + b)`,
    note: "native throws TypeError",
  },
];

export type MatrixResult = {
  rows: ProbeRow[];
  counts: Record<ProbeVerdict, number>;
  total: number;
};

export function classifyProbe(p: Probe): ProbeRow {
  const r = probeBody(p.body);
  const nativeThrows = r.native.startsWith("THROW:");
  const engineConcrete = r.engineConcrete;
  const engine = engineConcrete ?? r.engineDomain;
  const base = {
    ...p,
    native: r.native,
    ...(engine !== undefined ? { engine } : {}),
    engineThrows: r.engineThrows,
  };
  if (nativeThrows) {
    // 原生抛：引擎同抛 = 抛域对齐（值域不可比）；引擎给具体值 = 假精确；
    // 引擎声称不会抛（engineNoThrow）= 错误定论。
    if (r.engineThrows) return { ...base, verdict: "modeled" };
    if (engineConcrete !== undefined) return { ...base, verdict: "wrong-exact" };
    if (r.engineNoThrow) return { ...base, verdict: "wrong-exact" };
    return { ...base, verdict: "unknown" };
  }
  if (r.engineThrows) return { ...base, verdict: "wrong-exact" };
  if (engineConcrete === undefined) return { ...base, verdict: "unknown" };
  return {
    ...base,
    verdict: engineConcrete === r.native ? "modeled" : "wrong-exact",
  };
}

export function runMatrix(probes: readonly Probe[] = PROBES): MatrixResult {
  const rows = probes.map(classifyProbe);
  const counts: Record<ProbeVerdict, number> = {
    modeled: 0,
    unknown: 0,
    "wrong-exact": 0,
  };
  for (const r of rows) counts[r.verdict]++;
  return { rows, counts, total: rows.length };
}

/** Markdown 报告（生成物；数字全部来自 runMatrix，不手写）。 */
export function renderMatrixReport(result: MatrixResult): string {
  const pct = (n: number): string => `${((n / result.total) * 100).toFixed(1)}%`;
  const lines: string[] = [
    "# Builtin consistency matrix (host oracle)",
    "",
    "> Generated by `node --import tsx scripts/builtins-consistency-report.ts` from",
    "> `packages/core/src/algebra/__tests__/builtins-consistency-matrix.ts`.",
    "> Do not edit by hand — regenerate after changing the probe table.",
    "",
    "Each probe runs natively (vm, strict) and through the Abs evaluator; verdicts:",
    "`modeled` (concrete value equals native), `unknown` (honest over-approximation),",
    "`wrong-exact` (concrete value differs / throw domain lies). The gate is",
    "**zero wrong-exact** — coverage is not a goal.",
    "",
    "| verdict | count | share |",
    "|---|---:|---:|",
    `| modeled | ${result.counts.modeled} | ${pct(result.counts.modeled)} |`,
    `| unknown | ${result.counts.unknown} | ${pct(result.counts.unknown)} |`,
    `| wrong-exact | ${result.counts["wrong-exact"]} | ${pct(result.counts["wrong-exact"])} |`,
    `| **total** | **${result.total}** | 100% |`,
    "",
    "| probe | verdict | native | engine | note |",
    "|---|---|---|---|---|",
  ];
  const esc = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", " ");
  for (const r of result.rows) {
    lines.push(
      `| \`${r.name}\` | ${r.verdict} | \`${esc(r.native)}\` | \`${esc(r.engine ?? "—")}\` | ${esc(r.note ?? "")} |`,
    );
  }
  return lines.join("\n") + "\n";
}
