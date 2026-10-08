/**
 * entry-may-throw 误报回归（issue #97 / #98）。
 *
 * #97：对象 union 的 null 守卫后成员读不再报 may-throw。
 *   `p === null` 早退 / 内联三元 / `!p` / `!== null` 正分支 / `?. ??` 五形态
 *   全部误报 `property 'major' on null`，签名折成 `=> -1 throws TypeError`；
 *   原始对照（`"ab" | null` → `.length`）因 `.length` 特殊路径幸免。
 *   根因：`$fork` 只压路径 Φ，不剪分支值——守卫假臂里 p 仍含 null 臂，
 *   `$get(sum)` 逐臂递归撞 null 记 may-throw。修复：转译层守卫臂影子重绑
 *   `$removeNullish`（stmt-predicates.ts nullishGuardOf + expr/stmt 接线），
 *   `?.` 续体同样剪 nullish。
 *
 * #98：循环构建的二维数组，循环内嵌套索引读（`d[i-1][1]`）不再推 may-throw /
 *   折 never。根因群：非字面量下标在 $idx/$idxSet 被当「确定非下标键」折 exact
 *   undefined；OOB 越界读的 undefined 无标记，回写时被当真 undefined 硬抛；
 *   循环 widen 把 tuple-sum 折叠丢失元素域；`new Array(n)` 未知长度记 RangeError。
 *   修复：oobUndef 标记 + widenLoopJoin + `.length` 非负 pred + fill 全窗替换。
 * 契约场景（a/b: string）必须零误报；无契约 any 实参的 may-throw 是既定
 * policy（入口无约束 = any = 诚实 may-throw），不在本文件钉。
 *
 * #105：typeof 类型守卫后 builtin（RegExp.exec）调用不再报 may-throw。
 *   根因：$narrowTypeOf 只剪 sum 成员，裸 any（无约束入口参数）在守卫
 *   事实臂原样保留 → exec/test 的 subject ToString 档位按 any 记 may。
 *   修复：事实臂 any 窄化为对应 prim（string 守卫后 subject 全定）。
 *   无 typeof 守卫的 exec(any) 仍报（原生 exec(Symbol()) 抛，同 scale(x) 口径）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

function check(src: string) {
  return checkSource("/t/entry-may-throw-fp.js", withStdImport(src), pTrue, stdOpts);
}

/** L2 entry-may-throw 的 issue 数（按函数名过滤可选） */
function l2Count(r: ReturnType<typeof check>, fn?: string): number {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn)).length;
}

function sigOf(r: ReturnType<typeof check>, fn: string): string {
  return r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
}

const PARSE = `function parse(s) { if (s === 'x') return { major: 1 }; return null; }`;

describe("#97 null 守卫后的成员读不报 entry-may-throw", () => {
  const variants: Array<[string, string]> = [
    ["earlyReturn", `export function earlyReturn(s) { const p = parse(s); if (p === null) return -1; return p.major; }`],
    ["ternary", `export function ternary(s) { const p = parse(s); return p === null ? -1 : p.major; }`],
    ["notP", `export function notP(s) { const p = parse(s); if (!p) return -1; return p.major; }`],
    ["posBranch", `export function posBranch(s) { const p = parse(s); if (p !== null) return p.major; return -1; }`],
    ["optChain", `export function optChain(s) { const p = parse(s); return p?.major ?? -1; }`],
  ];

  it.each(variants)("%s：零 L2，签名精确", (name, fnSrc) => {
    const r = check(`${PARSE}\n${fnSrc}`);
    expect(l2Count(r)).toBe(0);
    expect(r.summary.errors).toBe(0);
    // 守卫假臂剪 null 后 p.major 折 1（此前是 -1 throws TypeError；臂序不定）
    expect(sigOf(r, name)).toMatch(/^(-1 \| 1|1 \| -1)\b/);
  });

  it("原始对照：string union 的 .length 保持干净", () => {
    const r = check(
      `function parseS(s) { if (s === 'x') return 'ab'; return null; }\nexport function s1(s) { const p = parseS(s); if (p === null) return -1; return p.length; }`,
    );
    expect(l2Count(r)).toBe(0);
    expect(r.summary.errors).toBe(0);
  });

  it("undefined 守卫同构：u === undefined 后成员读干净", () => {
    const r = check(
      `export function undefGuard(s) { const u = s === 'x' ? { v: 2 } : undefined; if (u === undefined) return 0; return u.v; }`,
    );
    expect(l2Count(r)).toBe(0);
    expect(sigOf(r, "undefGuard")).toMatch(/^0 \| 2\b/);
  });

  it("无守卫成员读仍报 L2（守卫剪枝不越界）", () => {
    const r = check(`${PARSE}\nexport function noGuard(s) { const p = parse(s); return p.major; }`);
    expect(l2Count(r, "noGuard")).toBeGreaterThan(0);
  });
});

describe("#98 循环构建二维数组的嵌套索引读不报 entry-may-throw", () => {
  const DP = `
export function lev(a, b) {
  const d = [];
  for (let i = 0; i <= a.length; i++) d[i] = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + cost);
    }
  }
  return d[a.length][b.length];
}`;

  it("完整 levenshtein（a/b: string 契约）零 L2", () => {
    const r = check(
      `/**\n * @nudo:contract a nonEmpty && b nonEmpty\n */\n${DP}`,
    );
    expect(l2Count(r, "lev")).toBe(0);
    expect(r.summary.errors).toBe(0);
    // 此前被折成 `never throws TypeError`；widen 后诚实值域。Bug 48 后
    // 内层循环对 d 的元素域（fill 0 → min 增长）按增长宽化到无上界
    // number——比旧 `0 | undefined` 更 sound（native lev("a","b")=1 ∉
    // {0,undefined}）；OOB undefined 臂保留（抽象下标不可证界内）
    expect(sigOf(r, "lev")).toMatch(/^number \| undefined\b/);
  });

  it("简化 DP（vLoop3）契约下零 L2", () => {
    const r = check(
      `/**\n * @nudo:contract a nonEmpty && b nonEmpty\n */\nexport function vLoop3(a, b) {\n  const d = [];\n  for (let i = 0; i <= a.length; i++) d[i] = new Array(b.length + 1).fill(0);\n  for (let i = 1; i <= a.length; i++) { d[i][1] = d[i-1][1] + 1; }\n  return d[a.length][b.length];\n}`,
    );
    expect(l2Count(r, "vLoop3")).toBe(0);
    expect(r.summary.errors).toBe(0);
  });

  it("只写不读的嵌套写（d[i][0] = i）契约下零 L2", () => {
    const r = check(
      `/**\n * @nudo:contract a nonEmpty && b nonEmpty\n */\nexport function vWrite(a, b) {\n  const d = [];\n  for (let i = 0; i <= a.length; i++) d[i] = new Array(b.length + 1).fill(0);\n  for (let i = 1; i <= a.length; i++) { d[i][0] = i; }\n  return d[a.length][0];\n}`,
    );
    expect(l2Count(r, "vWrite")).toBe(0);
    expect(r.summary.errors).toBe(0);
  });
});

describe("#105 typeof 守卫后 RegExp exec 不报 entry-may-throw", () => {
  const RE = `const VERSION_RE = /^(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z.-]+))?$/;`;

  it("npm-safe parseVersion 形态：typeof 守卫 + !m 守卫 + 捕获组读，零 L2", () => {
    const r = check(`${RE}
export function parseVersion(v) {
  if (typeof v !== 'string') return null;
  const m = VERSION_RE.exec(v);
  if (!m) return null;
  return { major: m[1], minor: m[2], patch: m[3] };
}`);
    expect(l2Count(r)).toBe(0);
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "parseVersion")).toMatch(/^null \| \{ major: string/i);
  });

  it("正向 typeof 守卫 + m.length 命名读，零 L2", () => {
    const r = check(`${RE}
export function lenOf(v) {
  if (typeof v === 'string') {
    const m = VERSION_RE.exec(v);
    if (m === null) return null;
    return m.length;
  }
  return 0;
}`);
    expect(l2Count(r)).toBe(0);
    expect(r.summary.errors).toBe(0);
  });

  it("守卫剪枝不越界：无 typeof 守卫的 exec(any) 仍报 L2", () => {
    const r = check(`${RE}
export function unguarded(v) {
  const m = VERSION_RE.exec(v);
  if (!m) return null;
  return m[0];
}`);
    // v:any 可能是 Symbol（原生 exec(Symbol()) 抛 TypeError）——与
    // check-gold 的 scale(x)（x+1 any 强转 may）同口径，诚实保留。
    expect(l2Count(r, "unguarded")).toBeGreaterThan(0);
  });
});

describe("#98 已知召回损失：无约束下标的真实 TypeError 穿门（oobUndef 按类压制）", () => {
  // h(i) 的 d[i] 是真实无约束下标：原生 h(5) 里 d[5] 读到 undefined，
  // 再读 [0] 必抛 TypeError——main 上此处报 nudo:entry-may-throw。
  // 本 PR 的 oobUndef 标记（shape unknown + lit undefined + conf partial）
  // 按类压制：下游对该 marker 的成员读/索引读写一律静默透传不记
  // may-throw，无法区分「循环不变量保证在界内」（#98 DP 表误报，本 PR
  // 要消除）与「真实无约束下标」（此处穿门漏报）。这是显式接受的召回
  // 损失；理想收窄 = Φ 可导出下标在界 pred（如 i < d.length 证据下恢复
  // may-throw），超出本 PR 范围。
  it("h(i)：零 L2（真实 TypeError 穿门），签名并入 undefined", () => {
    const r = check(`export function h(i) { const d = [[1],[2]]; return d[i][0]; }`);
    expect(l2Count(r)).toBe(0);
    expect(sigOf(r, "h")).toMatch(/^1 \| 2 \| undefined\b/);
  });
});
