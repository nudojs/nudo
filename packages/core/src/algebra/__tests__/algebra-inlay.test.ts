/**
 * 模块套件：inlay 提示面。
 */
import { describe, it, expect } from "vitest";
import { collectAbsInlays, type AbsInlay } from "../format/inlay.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSource } from "../check/check.ts";
import { pTrue } from "../pred.ts";

// ---------------------------------------------------------------------------
// 同名导出槽不得串位渲染
// ---------------------------------------------------------------------------
describe("同名导出槽不得串位渲染", () => {
/**
 * LSP `textDocument/inlayHint` 在**同名导出槽**下渲染**别的函数**
 * 的计算式（IDE 里显示文件里根本不存在的表达式）。
 *
 * 根因：`inlay.ts` 的 `listFunctions` 逐节点取锚点，取值却走
 * `generalizeFromAst(name, …)`（`env.fns` 按名唯一）⇒ 同名槽下标签与锚点
 * 来自不同函数。
 *
 * 本钉：同名槽**不产 inlay**（宁可少一条提示，也不渲染别人的计算式）；
 * 不同名的对照仍正常。
 */



const CJS_SAME_NAME = `function f(a) {
  return a + 1;
}
exports.f = function (b) {
  return "S" + b;
};
`;

const CJS_DIFF_NAME = `function f(a) {
  return a + 1;
}
exports.g = function (b) {
  return "S" + b;
};
`;

const returnLabels = (inlays: AbsInlay[]): string[] =>
  inlays.filter((i) => i.kind === "type").map((i) => i.label);


  it("同名槽（`function f` + `exports.f`）不产返回 inlay（不渲染别的函数计算式）", () => {
    const labels = returnLabels(collectAbsInlays(CJS_SAME_NAME));
    // 文件里只有 `a + 1` 与 `"S" + b` —— `b + 1` 不存在
    expect(labels.join("\n")).not.toContain("b + 1");
    expect(labels).toEqual([]);
  });

  it("对照：改导出名后两条 inlay 都在，且各自是本函数的计算式", () => {
    const labels = returnLabels(collectAbsInlays(CJS_DIFF_NAME));
    expect(labels.length).toBe(2);
    expect(labels.join("\n")).toContain("a + 1");
    expect(labels.join("\n")).not.toContain("b + 1");
  });

  it("类实例方法与静态方法同名 ⇒ 同样不产 inlay", () => {
    const src = `export class C {
  m(a: any) {
    return a + 1;
  }
  static m(b: any) {
    return b + 1;
  }
}
`;
    const labels = returnLabels(collectAbsInlays(src));
    expect(labels).toEqual([]);
  });

});

// ---------------------------------------------------------------------------
// 匿名 default 导出的返回 inlay 不得消失
// ---------------------------------------------------------------------------
describe("匿名 default 导出的返回 inlay 不得消失", () => {
/**
 * LSP `textDocument/inlayHint` 对**匿名 default 导出**
 * （`export default (a) => …`）整段消失，而同文件 codeLens 却有类型 ⇒ inlay
 * 面自述的「枚举必须与导出面同口径」不变量被破。
 *
 * 根因：`inlay.ts` 的 `visitDecl` 只认 FunctionDeclaration / ClassDeclaration /
 * VariableDeclaration ⇒ 裸 ArrowFunctionExpression / FunctionExpression 全都
 * 不匹配 ⇒ 被丢弃。
 *
 * 本钉：匿名 default 形态也要有返回 inlay。
 */



const returnInlays = (src: string) =>
  collectAbsInlays(src, { fromFile: "/test/file.js" }).filter((i) => i.kind === "type");


  it("`export default (a) => a + 1` 有返回 inlay", () => {
    const inlays = returnInlays(`export default (a) => a + 1;\n`);
    expect(inlays.length).toBe(1);
    expect(inlays[0]!.label).toContain("a + 1");
  });

  it("`export default function (a) { … }`（匿名函数表达式）有返回 inlay", () => {
    const inlays = returnInlays(`export default function (a) {\n  return a + 1;\n}\n`);
    expect(inlays.length).toBe(1);
    expect(inlays[0]!.label).toContain("a + 1");
  });

  it("对照：具名 default 导出仍有一条 inlay（不回退）", () => {
    const inlays = returnInlays(`export default function named(a) {\n  return a + 1;\n}\n`);
    expect(inlays.length).toBe(1);
    expect(inlays[0]!.label).toContain("a + 1");
  });

});

// ---------------------------------------------------------------------------
// inlay 返回位必须消费用户公理（与 check 面同源）
// ---------------------------------------------------------------------------
describe("inlay 返回位必须消费用户公理（与 check 面同源）", () => {
/**
 * （inlay 面）—— 用户公理（`@nudo:invariant` / `@nudo:assume`）**只由
 * check 的动态域播种** ⇒ inlayHint 自算 generalize 时若不播种，IDE 角标印的是
 * 「**没有那条公理**的程序」的类型 ⇒ `nudo check`（CLI）与 IDE 角标跨面矛盾。
 *
 * 夹具（`tmp/repro//inv|ctrl/m1.js` 逐字）：同一函数体，只差
 * `@nudo:invariant dp[*] >= 0` 那一行。
 *
 * | 面 | 有公理 | 无公理（对照） |
 * |---|---|---|
 * | CLI `nudo check` 签名行 | `0 \| number` | `number` |
 * | IDE inlayHint | `: 0 \| number` | `: number` ← **改前逐字相同** |
 *
 * 修复后钉（本文件 = **inlay 面**；hover 面见 lsp 包的
 * `lsp-*`）：
 * 1. inlay 返回角标随公理那一行变化（`0 | number` ↔ `number`）；
 * 2. inlay 与 check 面**同源**：角标文本 == 签名行返回位文本（逐字）；
 * 3. 任何内部计数器 id（`inv#N` / `len#N`）不得上屏（同款口径）——
 * 公理折出的循环值参与算术时（`inv#2 + 1`）也必须退形状。
 */








/** 有公理：`tmp/repro//inv/m1.js` 逐字内容 */
const INV_SRC = `/**
 * @nudo:invariant dp[*] >= 0
 */
export function f(n) {
  const dp = [0];
  for (let i = 1; i < n; i++) {
    dp.push(dp[i - 1] + 1);
  }
  const out = dp[n - 1];
  if (out === undefined) return 0;
  return out;
}
`;

/** 对照组：同一函数体，只删掉 `@nudo:invariant` 那一行 */
const CTRL_SRC = `export function f(n) {
  const dp = [0];
  for (let i = 1; i < n; i++) {
    dp.push(dp[i - 1] + 1);
  }
  const out = dp[n - 1];
  if (out === undefined) return 0;
  return out;
}
`;

/** 公理折出的循环值**参与算术**（`inv#N + 1`）：内部 id 旧口径从这里漏上屏 */
const INV_TERM_SRC = `/**
 * @nudo:invariant dp[*] >= 0
 */
export function h(n) {
  const dp = [0];
  for (let i = 1; i < n; i++) {
    dp.push(dp[i - 1] + 1);
  }
  return dp[n - 1] + 1;
}
`;

type Faces = { inlay: string; check: string; issues: string[] };

/**
 * 同一份源码的**两个面**：
 * - `inlay` = `collectAbsInlays` 的返回角标（`: … · derived` → 返回位文本）
 * - `check` = `checkSource` 的 `NudoSig.display`（CLI 签名行返回位；去掉
 * ` throws …` 尾缀——那是 L2 域，不在本条的比较面）
 */
function facesOf(name: string, src: string): Faces {
  const dir = mkdtempSync(join(tmpdir(), `nudo-bug247-core-${name}-`));
  try {
    const file = join(dir, `${name}.js`);
    writeFileSync(file, src, "utf-8");
    const report = checkSource(file, src, pTrue, { fromFile: file });
    const sig = report.signatures.find((s) => s.name === (name.startsWith("h") ? "h" : "f"));
    expect(sig, `${name}: check 面没有签名`).toBeDefined();
    const inlays = collectAbsInlays(src, { fromFile: file });
    const ret = inlays.find((i) => i.kind === "type");
    expect(ret, `${name}: inlay 面没有返回角标`).toBeDefined();
    return {
      inlay: ret!.label
        .replace(/^:\s*/, "")
        .replace(/\s*·\s*derived\s*$/, "")
        .trim(),
      check: sig!.display.replace(/\s+throws\s+.*$/, "").trim(),
      issues: report.issues.map((i) => `${i.code}: ${i.message}`),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}


  it("有公理 ⇒ inlay `0 | number`；无公理 ⇒ `number`；两者不同", () => {
    const inv = facesOf("inv", INV_SRC);
    const ctrl = facesOf("ctrl", CTRL_SRC);

    // 改前：inlay 自算 generalize（未播种）⇒ 两版都是 `number`
    expect(inv.inlay).toBe("0 | number");
    expect(ctrl.inlay).toBe("number");
    // 差异**精确地由公理那一行引起**（不是面固有精度差）
    expect(inv.inlay).not.toBe(ctrl.inlay);
  });

  it("inlay 与 check 面逐字同源（同一 Abs 的两个渲染面）", () => {
    const inv = facesOf("inv", INV_SRC);
    const ctrl = facesOf("ctrl", CTRL_SRC);
    expect(inv.check).toBe("0 | number");
    expect(ctrl.check).toBe("number");
    // 跨面一致：IDE 角标 == CLI 签名行返回位
    expect(inv.inlay).toBe(inv.check);
    expect(ctrl.inlay).toBe(ctrl.check);
  });

  it("公理折出的循环值参与算术（inv#N + 1）⇒ 内部 id 不上屏、退 check 同款形状", () => {
    const f = facesOf("h", INV_TERM_SRC);
    // 改前：`: inv#2 + 1 | NaN · derived`（内部计数器 id 泄漏 + 与 check 面矛盾）
    expect(f.inlay).not.toMatch(/[a-z]+#\d+/);
    expect(f.inlay).toBe(f.check);
    expect(f.inlay).toContain("number");
  });

});

// ---------------------------------------------------------------------------
// 表达式体箭头函数的返回 inlay 锚点
// ---------------------------------------------------------------------------
describe("表达式体箭头函数的返回 inlay 锚点", () => {
/**
 * 返回 inlay 的锚点对**表达式体**箭头函数落在表达式**内部**
 * （把源码行劈开）。
 *
 * 改前：`collectAbsInlays` 无条件取 `fnNode.body?.loc.start` 作为返回 inlay
 * 的锚点。对**块体**它等于 `{` 的位置（正确）；对**表达式体**它等于**表达式
 * 的起点** ⇒ 标注被插到 `=>` 与表达式之间：
 *
 * export const arrow = (v) => : v * 2 · derived v * 2;
 *
 * 改后：块体 ⇒ `{` 位置（不变）；表达式体 ⇒ **整个表达式的结束**位置
 * （标注落在表达式之后，不劈开源码行；口径同 TypeScript 自身的返回类型
 * inlay —— 提示落在被标注表达式之后）。
 *
 * 既有 `inlay.test.ts` / `inlay-contract-tier.test.ts` 只断言 label **内容**，
 * **无任何落点位置断言** ⇒ 本钉补落点断言。
 */



const retInlay = (src: string) => {
  const inlays = collectAbsInlays(src, { fromFile: "/t/a.js" });
  const ret = inlays.find((i) => i.kind === "type");
  expect(ret).toBeDefined();
  return ret!;
};


  it("表达式体：锚点在表达式结束处（改前 = 表达式起点 ⇒ 劈开源码行）", () => {
    const src = `export const arrow = (v) => v * 2;`;
    const expr = "v * 2";
    const exprStart = src.indexOf(expr);
    const exprEnd = exprStart + expr.length;
    const ret = retInlay(src);

    expect(ret.line).toBe(1);
    // 落点 = 表达式结束列
    expect(ret.character).toBe(exprEnd);
    // 改前的落点（表达式起点）必须不再是落点
    expect(ret.character).not.toBe(exprStart);
    // 标注不得插在表达式内部
    expect(ret.character).toBeGreaterThan(exprStart);
    // 落点之前的源码文本必须**完整包含**该表达式（没被劈开）
    expect(src.slice(0, ret.character)).toContain(expr);
    // 返回计算形仍在（label 内容不被落点修复牵连）
    expect(ret.label).toContain("v * 2");
  });

  it("块体：锚点仍是 `{` 的位置（不变）", () => {
    const src = `export function plain(a, b) {\n  return a + b;\n}`;
    const ret = retInlay(src);
    expect(ret.line).toBe(1);
    expect(ret.character).toBe(src.indexOf("{"));
  });

  it("箭头块体：锚点仍是 `{` 的位置（不变）", () => {
    const src = `export const blk = (v) => {\n  return v * 2;\n}`;
    const ret = retInlay(src);
    expect(ret.line).toBe(1);
    expect(ret.character).toBe(src.indexOf("{"));
  });

  it("表达式体（对象字面量）：锚点在字面量之后（不插进字面量内部）", () => {
    const src = `export const mk = (v) => ({ v });`;
    // Babel 的 body 节点是 `ObjectExpression`（不含外层包裹括号）⇒ 锚点落在
    // 字面量末尾（包裹括号内），但**不在字面量内部**。
    const lit = "{ v }";
    const litStart = src.indexOf(lit);
    const ret = retInlay(src);
    expect(ret.character).toBeGreaterThanOrEqual(litStart + lit.length);
    expect(ret.character).not.toBe(litStart);
    expect(ret.character).not.toBe(src.indexOf("({ v })"));
  });

});

// ---------------------------------------------------------------------------
// 返回 inlay 不得上屏内部 term id
// ---------------------------------------------------------------------------
describe("返回 inlay 不得上屏内部 term id", () => {
/**
 * 返回 inlay 把**内部 term id**（`len#N`）当返回类型上屏。
 *
 * 改前：`formatReturnDisplay` 的 term 渲染路径直接吐 `termToString` 的内部串
 * ⇒ `len#N`（`exec/runtime/containers/arr-index.ts` 的**模块级自增**计数器
 * `lenVarSeq` 铸造）出现在 IDE 提示里：
 *
 * : len#0 · derived
 *
 * 而同一份源码的 hover / `nudo check` 面给的是 `number` ⇒ 三个面口径矛盾。
 *
 * 改后：内部 id 统一映射成**稳定可读**标识 `len`：
 *
 * : len · derived
 *
 * ⚠ 勘误（按实测）：报告称「同一份源码每次给出不同编号」——**不成立**：
 * `generalizeFromAst` 有源码级 memo ⇒ 完全相同的源码命中缓存、编号**稳定**；
 * 只有**缓存未命中**（源码改动 / 依赖指纹变化）才递增。
 * ⇒ 本钉断言「提示文本不得含内部 id」+「同一份源码多次调用文本逐字相同」，
 * **不**断言「同源码必漂移」。
 */



const retLabel = (src: string): string => {
  const inlays = collectAbsInlays(src, { fromFile: "/t/a.js" });
  const ret = inlays.find((i) => i.kind === "type");
  expect(ret).toBeDefined();
  return ret!.label;
};

const LEN_SRC = `export function restLen(...xs) {\n  return xs.length;\n}`;


  it("提示文本不含 `len#N` 这类内部 id", () => {
    const label = retLabel(LEN_SRC);
    expect(label).not.toMatch(/len#/);
    // 通用口径：任何 `<小写词>#<数字>` 形态的内部 id 都不许出现
    expect(label).not.toMatch(/[a-z]+#\d+/);
  });

  it("内部 id 换成稳定可读标识 `len`", () => {
    const label = retLabel(LEN_SRC);
    expect(label).toContain(": len");
    expect(label).not.toContain("len#");
  });

  it("同一份源码多次调用：提示文本逐字相同（稳定）", () => {
    const a = retLabel(LEN_SRC);
    const b = retLabel(LEN_SRC);
    const c = retLabel(LEN_SRC);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("缓存未命中（源码改动 ⇒ 计数器递增）时也不泄漏内部 id", () => {
    // 另一份源码 ⇒ `lenVarSeq` 递增（改前会给出 `len#1` / `len#2` …）
    const other = `export function otherLen(...ys) {\n  return ys.length;\n}`;
    const first = retLabel(LEN_SRC);
    const second = retLabel(other);
    expect(second).not.toMatch(/len#/);
    expect(second).toContain(": len");
    // 两份不同源码给出**逐字相同**的可读标识（不随内部计数器漂移）
    expect(second).toBe(first);
  });

});

// ---------------------------------------------------------------------------
// 返回 inlay 的 `-0` 保真 + union 成员不被去重丢掉
// ---------------------------------------------------------------------------
describe("返回 inlay 的 `-0` 保真 + union 成员不被去重丢掉", () => {
/**
 * 返回 inlay 把 `-0` 渲染成 `0`，并因此**丢掉一个 union 成员**。
 *
 * 改前：`formatReturnDisplay` 的 `memberPath` 字面量分支**自写**了一套字面量
 * 文本（`JSON.stringify(lv)`）⇒ `JSON.stringify(-0) === "0"` 抹掉负零符号；
 * 去重键 `lit:${String(lv)}` 让 `-0` 臂与 `0` 臂**键相同** ⇒ `seen` 集合把
 * 其中一条**整个丢掉**：
 *
 * negZero() → : 0 （应为 : -0）
 * zeroOrNeg() → : 0 （应为 : 0 | -0）
 *
 * 而 `nudo check` / `nudo test` 同一份源码给 `-0` / `0 | -0` ⇒ 面与面矛盾。
 *
 * 改后：字面量文本走仓库的**规范口径**（`term.ts` 的 `termToString` /
 * `litKeyString`，与 `format.ts` 的 `formatLitValue` 同口径），去重键与渲染
 * 文本**同源**（`lit:<typeof>:<litKeyString>`）⇒ `-0` 臂与 `0` 臂不再同键。
 */



const NEG_ZERO_SRC = `export function negZero() {\n  return -0;\n}\n\nexport function zeroOrNeg(x) {\n  return x ? 0 : -0;\n}\n`;

/** label 形如 `: 0 | -0 · derived ` ⇒ 取其中的展示文本 */
const displayOf = (label: string): string =>
  label
    .replace(/^:\s*/, "")
    .replace(/\s*·\s*derived\s*$/, "")
    .trim();

const displays = (src: string): string[] =>
  collectAbsInlays(src, { fromFile: "/t/a.js" })
    .filter((i) => i.kind === "type")
    .map((i) => displayOf(i.label));


  it("`-0` 不被渲染成 `0`", () => {
    const d = displays(NEG_ZERO_SRC);
    expect(d.length).toBe(2);
    expect(d[0]).toBe("-0");
    expect(d[0]).not.toBe("0");
  });

  it("union 的 `-0` 臂不被去重键吞掉（0 | -0 两个成员都在）", () => {
    const d = displays(NEG_ZERO_SRC);
    expect(d[1]).toBe("0 | -0");
    // 两个成员逐字都在
    expect(d[1]).toContain("-0");
    expect(d[1]).toContain("0");
  });

  it("`-0` 与 `0` 是不同成员（去重键同源于渲染文本）", () => {
    // 单独 `-0` 的展示文本 ≠ 单独 `0` 的展示文本
    const onlyNeg = displays(`export function n() {\n  return -0;\n}\n`);
    const onlyPos = displays(`export function p() {\n  return 0;\n}\n`);
    expect(onlyNeg[0]).toBe("-0");
    expect(onlyPos[0]).toBe("0");
    expect(onlyNeg[0]).not.toBe(onlyPos[0]);
  });

});
