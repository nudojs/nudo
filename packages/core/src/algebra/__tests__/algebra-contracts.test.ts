/**
 * 模块套件：契约/sidecar/有效契约面。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue, formatGithubAnnotations, formatGitlabCodeQuality, serializeCheckJson } from "../index.ts";
import { takeRefineDiags, extractRefineReturnFromSource, extractRefinesFromSource, setRefineDiagCollector } from "../refine.ts";
import { takeContractDiags } from "../contract/contract.ts";
import { makeFiles, sidecarOpts } from "./nudo-constraints.ts";
import { resetEngineCaches } from "./eval-helpers.ts";
import { resetCheckSourceMemo, checkSource as checkSource_____check_check_ts } from "../check/check.ts";
import { resetGeneralizeMemo, generalizeFromAst, buildArgsFromAssume } from "../generalize.ts";
import { assertImplies } from "../postcondition.ts";
import { absLit } from "../abs.ts";
import { pTrue as pTrue_____pred_ts, predToString, gtNum, geNum, type Pred } from "../pred.ts";
import { checkSource as checkSource___nudojs_core, pTrue as pTrue___nudojs_core, resetCheckSourceMemo as resetCheckSourceMemo___nudojs_core, resetGeneralizeMemo as resetGeneralizeMemo___nudojs_core } from "@nudojs/core";
import type { CheckIssue } from "../check/check-report.ts";
import { v } from "../term.ts";

// ---------------------------------------------------------------------------
// 结构型合取不得静默丢掉另一侧的义务
// ---------------------------------------------------------------------------
describe("结构型合取不得静默丢掉另一侧的义务", () => {
/**
 * 契约合取的**结构型义务被静默丢掉** ⇒ 门禁**假绿**。
 *
 * 位置：packages/core/src/algebra/contract.ts 的 `conjoinOrConflict`——任一侧是
 * 结构型就直接 `return prev` ⇒ 另一侧的结构义务**整条蒸发**。
 *
 * 现象：源码契约 `shape({id: number()})` + 侧车契约 `shape({id: number(),
 * name: string()})` ⇒ `name` 义务被丢掉 ⇒ 契约面比声明面**宽松** ⇒ 传
 * `name: 123` 的调用**不被判违约**（违约代码被放过）。
 *
 * 修法：**字段级合并**（两侧都有的字段递归合取；只有一侧有的字段保留）——
 * 两边的义务都在；合不了的形态组合（union / fn …）⇒ 显式报「不可判定」
 * （不得静默宽松）。
 *
 * 本文件钉住：
 * - 侧车的 `name` 义务**不被丢掉**（调用点可见违例）；
 * - 合法合取（两侧同形）⇒ 不得被判成 conflict（零假红，口径）；
 * - 合不了的形态组合 ⇒ 显式诊断（不静默）。
 */







beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

/** 侧车：同名 fn 约束（p: shape{id,name}）+ 源码指令用的 shape（p: shape{id}） */
const STD = `import { shape, number, string, fn } from "@nudojs/core";
export const srcShape = shape({ id: number() });
export const f = fn({ p: shape({ id: number(), name: string() }) });
`;

function check(src: string, files: Record<string, string> = { "/t/src.nudo.js": STD }) {
  const { loadModule } = makeFiles(files);
  return checkSource("/t/src.js", src, pTrue, { loadModule, fromFile: "/t/src.js" });
}


  it("侧车的 name 义务不被丢掉（调用点可见违例）", () => {
    const r = check(`/// @nudo:import { srcShape } from "./src.nudo.js"
/**
 * @nudo:contract p srcShape
 */
export function f(p) {
  return p;
}
f({ id: 1, name: 123 });
`);
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
  });

  it("合法合取（两侧同形）⇒ 不得被判 conflict（零假红，Bug 340 口径）", () => {
    const files = {
      "/t/src.nudo.js": `import { shape, number, fn } from "@nudojs/core";
export const srcShape = shape({ id: number() });
export const f = fn({ p: shape({ id: number() }) });
`,
    };
    const r = check(
      `/// @nudo:import { srcShape } from "./src.nudo.js"
/**
 * @nudo:contract p srcShape
 */
export function f(p) {
  return p;
}
`,
      files,
    );
    expect(r.issues.filter((i) => i.code === "nudo:contract-conflict")).toEqual([]);
  });

  it("合法合取（两侧同形）⇒ 义务照常执法（不因合并而失效）", () => {
    const files = {
      "/t/src.nudo.js": `import { shape, number, fn } from "@nudojs/core";
export const srcShape = shape({ id: number() });
export const f = fn({ p: shape({ id: number() }) });
`,
    };
    const r = check(
      `/// @nudo:import { srcShape } from "./src.nudo.js"
/**
 * @nudo:contract p srcShape
 */
export function f(p) {
  return p;
}
f({ id: "not-a-number" });
`,
      files,
    );
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBeGreaterThan(0);
  });

  it("合不了的形态组合 ⇒ 显式诊断（不得静默丢掉那一侧）", () => {
    const files = {
      "/t/src.nudo.js": `import { union, lit, number, fn } from "@nudojs/core";
export const srcUnion = union(lit(0), lit(1));
export const f = fn({ p: number() });
`,
    };
    const r = check(
      `/// @nudo:import { srcUnion } from "./src.nudo.js"
/**
 * @nudo:contract p srcUnion
 */
export function f(p) {
  return p;
}
`,
      files,
    );
    // 结构型组合（union ∧ 标量）合不出来 ⇒ 必须**显式**说出来
    const reported = r.issues.filter((i) => i.code === "nudo:contract-conflict");
    expect(reported.length).toBeGreaterThan(0);
  });

});

// ---------------------------------------------------------------------------
// @nudo:contract 返回段的文法判据
// ---------------------------------------------------------------------------
describe("@nudo:contract 返回段的文法判据", () => {
/**
 * `@nudo:contract` 的**返回位**约束名写成 **builder 调用**
 * （`return number()`）⇒ 整条契约被**静默丢弃**、零诊断 ⇒ 声明的后置条件
 * 从未执法（假绿）；而**参数位**同款写法有 `nudo:contract-syntax` 警告
 * ⇒ 两处判据不对称。
 *
 * 根因：`refine.ts` 的返回段守卫判的是「**有没有第二个 token**」
 * （`!/^return\s+\S+$/.test(part)`）而不是「第二个 token 是不是合法约束名」
 * ⇒ `return number()` 恰好有 token ⇒ 不报诊断 ⇒ `continue`。
 *
 * 钉：返回位非法形态必须报 `nudo:contract-syntax`（与参数位同口径）；
 * 合法绑定名写法仍然正常工作（不被新守卫误伤）。
 */







beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  setRefineDiagCollector(null);
  takeRefineDiags();
});


  it("return number()（builder 调用）⇒ 发 nudo:contract-syntax（不再静默丢弃）", () => {
    const src = `/**
 * @nudo:contract return number()
 */
export function f(x) { return "s"; }`;
    takeRefineDiags();
    const got = extractRefineReturnFromSource(src, "f", {
      loadModule: () => `export const number = 1;`,
      fromFile: "/t/f.js",
    });
    const diags = takeRefineDiags();
    expect(got).toBeUndefined();
    expect(diags.some((d) => d.code === "nudo:contract-syntax" && d.message.includes("return number()"))).toBe(true);
  });

  it("返回位与参数位同款写法的诊断集一致（两处判据对称）", () => {
    const src = `/**
 * @nudo:contract x number()
 * @nudo:contract return number()
 */
export function f(x) { return x; }`;
    takeRefineDiags();
    extractRefinesFromSource(src, "f", { loadModule: () => undefined, fromFile: "/t/f.js" });
    extractRefineReturnFromSource(src, "f", { loadModule: () => undefined, fromFile: "/t/f.js" });
    const messages = takeRefineDiags()
      .filter((d) => d.code === "nudo:contract-syntax")
      .map((d) => d.message);
    expect(messages.some((m) => m.includes("segment 'x number()'"))).toBe(true);
    expect(messages.some((m) => m.includes("return segment 'return number()'"))).toBe(true);
  });

  it("合法绑定名写法不被误伤（对照）：return positive 仍然执法", () => {
    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().ge(0);\n`,
    });
    const r = checkSource(
      "/t/f.js",
      `
/// @nudo:import { positive } from "./f.nudo.js"

/**
 * @nudo:contract return positive
 */
export function f() {
  return "s";
}
`,
      pTrue,
      { loadModule, fromFile: "/t/f.js" },
    );
    expect(r.issues.filter((i) => i.code === "nudo:contract-syntax")).toEqual([]);
    const violated = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(violated).toBeDefined();
    expect(violated!.severity).toBe("error");
  });

});

// ---------------------------------------------------------------------------
// fn 形态的返回义务
// ---------------------------------------------------------------------------
describe("fn 形态的返回义务", () => {
/**
 * 回归：源码 `@nudo:contract return <fn 形态模板>` 的返回义务
 * **整条不被执法**——返回槽装的是整个 fn 约束，而 postcondition 的 fn 分支
 * 把 fn 形态直接判「已证明」⇒ 零诊断假绿。
 *
 * 修法（不改公开返回型，仍是**单条**返回槽）：
 * - `refine.ts` 的 return 段提取：fn 形态模板取其 `fn.returns`（**真正的返回
 * 义务**）——与侧车口径（`sidecarFn?.fn.returns`）一致；
 * - `postcondition.ts`：fn 形态**无法执法**时不再返回 `proved()`，返回
 * `unprovable`（无法证明 ≠ 已证明 ⇒ 出 warning `nudo:unproven-return`）。
 */






beforeEach(() => {
  setRefineDiagCollector(null);
  takeRefineDiags();
});

const RETFN_SIDECAR = `
import { fn, number } from "@nudojs/core";
export const retfn = fn({ d: number().ge(0) }, number().ge(0).le(1));
`;

const SRC = `
/// @nudo:import { retfn } from "./retfn.nudo.js"
/**
 * @nudo:contract return retfn
 */
export function other(d) {
  return 999;
}
`;


  it("返回槽取 fn.returns（不是整个 fn 约束）", () => {
    const { loadModule } = makeFiles({
      "/t/retfn.nudo.js": RETFN_SIDECAR,
    });
    const ret = extractRefineReturnFromSource(SRC, "other", {
      loadModule,
      fromFile: "/t/other.js",
    });
    expect(ret).toBeDefined();
    expect(ret!.name).toBe("retfn");
    // fn 形态被拆成它的 returns（标量），不再是 fn 约束本身
    expect(ret!.constraint.fn).toBeUndefined();
  });

  it("返回义务真被执法：999 ⊭ number().ge(0).le(1)", () => {
    const { loadModule } = makeFiles({
      "/t/retfn.nudo.js": RETFN_SIDECAR,
    });
    const ret = extractRefineReturnFromSource(SRC, "other", {
      loadModule,
      fromFile: "/t/other.js",
    });
    expect(ret).toBeDefined();
    const proof = assertImplies(absLit(999), ret!.constraint);
    expect(proof.status).toBe("disproved");
  });

  it("postcondition：fn 形态不再被直接判「已证明」", () => {
    const fnConstraint = {
      __nudoConstraint: true as const,
      prim: "number" as const,
      preds: [],
      fn: {
        params: {},
        returns: undefined,
      },
    };
    const proof = assertImplies(absLit(1), fnConstraint as never);
    expect(proof.status).toBe("unprovable");
  });

});

// ---------------------------------------------------------------------------
// assume-relied 归因只认真正消费过的引理
// ---------------------------------------------------------------------------
describe("assume-relied 归因只认真正消费过的引理", () => {
/**
 * 回归钉 —— `nudo:assume-relied` 审计标注**误归因**。
 *
 * 症状：审计归因用的是「**函数上有没有**这条引理」这个代理量，而不是
 * 「**证明链上真正消费了**哪条引理」⇒ 只要返回契约证得（proof.status ===
 * "proved"）且函数带 `@nudo:assume`，就宣称「proved via @nudo:assume X」
 * ——哪怕函数体压根没用这条引理（`return 0` 也能"证得"）。
 *
 * 修法（族 07 片 S4）：代数核在**引理消费点**（div / sub 的同名相关性折叠）
 * 记「本次证明消费过的引理」，check 面取快照回传给审计标注 ⇒ 归因只认
 * **真正产出了界**的那条引理。
 *
 * 钉：
 * ① 引理未被消费 ⇒ **不得**出现 `nudo:assume-relied`（改前必然出现 ⇒ 反向闸红）；
 * ② 引理真被消费（`1 - d/max` 的相关性折叠）⇒ 仍要出现（不得把审计面砍空）；
 * ③ 两条引理只消费一条 ⇒ 只宣称消费过的那条。
 */



/** 侧车：`sim` 的返回契约 `number().ge(0).le(1)`，形参 d ≥ 0 / max ≥ 1 */
const sidecar = `import { fn, number } from "@nudojs/core";
export const sim = fn({ d: number().ge(0), max: number().ge(1) }, number().ge(0).le(1));
`;

const opts = (file: string) => ({
  loadModule: (spec: string): string | undefined =>
    spec.endsWith(".nudo.js") ? sidecar : undefined,
  fromFile: file,
});


  it("① 引理未被消费（函数体不用它）⇒ 不得宣称 proved via @nudo:assume", () => {
    const r = checkSource(
      "/t/bug367-a.js",
      `
/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1;
}
`,
      pTrue,
      opts("/t/bug367-a.js"),
    );
    // 返回契约仍证得（1 ∈ [0,1]）——但引理没参与 ⇒ 不得宣称依赖引理
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:assume-relied")).toBe(false);
  });

  it("② 引理真被消费（d/max 的相关性折叠）⇒ 仍要宣称（审计面不得砍空）", () => {
    const r = checkSource(
      "/t/bug367-b.js",
      `
/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
`,
      pTrue,
      opts("/t/bug367-b.js"),
    );
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(false);
    const relied = r.issues.find((i) => i.code === "nudo:assume-relied");
    expect(relied).toBeDefined();
    expect(relied!.severity).toBe("info");
    expect(relied!.fn).toBe("sim");
    expect(relied!.message).toContain("proved via @nudo:assume d <= max");
  });

  it("③ 两条引理只消费一条 ⇒ 只宣称消费过的那条", () => {
    const r = checkSource(
      "/t/bug367-c.js",
      `
/**
 * @nudo:assume d <= max
 * @nudo:assume d <= lim
 */
export function sim(d, max, lim) {
  return max === 0 ? 1 : 1 - d / max;
}
`,
      pTrue,
      opts("/t/bug367-c.js"),
    );
    const relied = r.issues.find((i) => i.code === "nudo:assume-relied");
    expect(relied).toBeDefined();
    expect(relied!.message).toContain("d <= max");
    expect(relied!.message).not.toContain("d <= lim");
  });

});

// ---------------------------------------------------------------------------
// 返回契约类诊断带 line/column
// ---------------------------------------------------------------------------
describe("返回契约类诊断带 line/column", () => {
/**
 * 回归钉 —— 返回契约类诊断**不带 `line` / `column`** ⇒ LSP 把诊断画在
 * **第 1 行第 0 列**、vite 打印 `:1:0`、JSON 里 `line=null`。
 *
 * 根因（族 07 片 S4 实测）：`checkReturnConstraint` 的 `push` 构造 issue 时只带
 * `fn`，**位置信息在 issue 构造处就丢了** ⇒ 消费面（LSP / vite / GHA / GitLab /
 * JSON）一律兜底到首行。**不是**消费面算错（同一文件里带位置的
 * `nudo:entry-may-throw` 定位正确）。
 *
 * 修法：issue 构造处补上**被违约函数的声明位置**（line 1 基 / column 0 基，
 * 与 core 其它 issue 同口径 ⇒ 消费面各自换算）。
 *
 * 钉：函数在第 10 行 ⇒ 返回契约违例的 issue 必须带 `line: 10` / `column: 7`
 * （改前 `line` / `column` 皆 undefined ⇒ 反向闸红）。
 */



/** 前 9 行是注释 ⇒ 函数声明落在第 10 行（与 tmp/probe/fix-r57/fx/gha/h.js 同形） */
const SRC = `// line 1
// line 2
// line 3
// line 4
// line 5
// line 6
// line 7
// line 8
// line 9
export function deep(x) {
  return x - 1;
}
`;

/** 侧车：`deep` 的返回契约 `number().gt(0)`（`x - 1` 违例） */
const sidecar = `import { fn, number } from "@nudojs/core";
export const deep = fn({ x: number().gt(0) }, number().gt(0));
`;

const opts = {
  loadModule: (spec: string): string | undefined =>
    spec.endsWith(".nudo.js") ? sidecar : undefined,
  fromFile: "/t/bug369.js",
};


  it("L1 违例 issue 带函数声明位置（不得是首行 / 不得缺字段）", () => {
    const r = checkSource("/t/bug369.js", SRC, pTrue, opts);
    const violated = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(violated).toBeDefined();
    expect(violated!.line).toBe(10);
    expect(violated!.column).toBe(7);
  });

  it("返回契约**证得**时的公理审计标注也带位置", () => {
    const src = `// 1
// 2
// 3
// 4
// 5
// 6
// 7
// 8
// 9
/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
`;
    const sc = `import { fn, number } from "@nudojs/core";
export const sim = fn({ d: number().ge(0), max: number().ge(1) }, number().ge(0).le(1));
`;
    const r = checkSource(
      "/t/bug369-info.js",
      src,
      pTrue,
      {
        loadModule: (spec: string): string | undefined =>
          spec.endsWith(".nudo.js") ? sc : undefined,
        fromFile: "/t/bug369-info.js",
      },
    );
    const relied = r.issues.find((i) => i.code === "nudo:assume-relied");
    expect(relied).toBeDefined();
    expect(relied!.line).toBe(13);
    expect(relied!.column).toBe(7);
  });

});

// ---------------------------------------------------------------------------
// L1 违例诊断的 CI 注解面 / JSON 机器契约面落真实行
// ---------------------------------------------------------------------------
describe("L1 违例诊断的 CI 注解面 / JSON 机器契约面落真实行", () => {
/**
 * 回归钉 —— L1 契约违约诊断（`nudo:constraint-violated`）不带行号
 * ⇒ **GitHub Actions 注解 / GitLab Code Quality / JSON 机器契约**三个面全部把
 * 错误定位到文件**第 1 行第 1 列**（实测函数在第 10 行）。
 *
 * 与 同根因（issue 构造处丢位置），但**验收面不同**：369 = LSP 单面；
 * 372 = **issue 字段 + CI 注解面**（GHA `::error …,line=…,col=…` / GitLab
 * `location.lines.begin` / `--json` 的 `line` / `column` 字段）。
 *
 * 钉：三个消费面都必须落在真实行（第 10 行），不得是第 1 行。
 */



/** 前 9 行是注释 ⇒ 函数声明落在第 10 行 */
const SRC = `// line 1
// line 2
// line 3
// line 4
// line 5
// line 6
// line 7
// line 8
// line 9
export function deep(x) {
  return x - 1;
}
`;

const sidecar = `import { fn, number } from "@nudojs/core";
export const deep = fn({ x: number().gt(0) }, number().gt(0));
`;

const opts = {
  loadModule: (spec: string): string | undefined =>
    spec.endsWith(".nudo.js") ? sidecar : undefined,
  fromFile: "/proj/src/deep.js",
};


  it("issue 字段带 line / column（第 10 行）", () => {
    const r = checkSource("/proj/src/deep.js", SRC, pTrue, opts);
    const violated = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(violated).toBeDefined();
    expect(violated!.line).toBe(10);
    expect(violated!.column).toBe(7);
  });

  it("GHA 行内注解的 line/col 落在真实行（改前是 line=1,col=1）", () => {
    const r = checkSource("/proj/src/deep.js", SRC, pTrue, opts);
    const ann = formatGithubAnnotations(r, { workspaceRoot: "/proj" });
    expect(ann).toContain("line=10");
    expect(ann).toContain("col=8");
    expect(ann).not.toContain("line=1,");
  });

  it("GitLab Code Quality 的 lines.begin 落在真实行（改前是 1）", () => {
    const r = checkSource("/proj/src/deep.js", SRC, pTrue, opts);
    const rows = formatGitlabCodeQuality(r, { workspaceRoot: "/proj" });
    const row = rows.find((x) => x.check_name === "nudo:constraint-violated");
    expect(row).toBeDefined();
    expect(row!.location.lines.begin).toBe(10);
  });

  it("JSON 机器契约面的 line / column 不是 null", () => {
    const r = checkSource("/proj/src/deep.js", SRC, pTrue, opts);
    const json = serializeCheckJson(r);
    const violated = json.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(violated).toBeDefined();
    expect(violated!.line).toBe(10);
    expect(violated!.column).toBe(7);
  });

});

// ---------------------------------------------------------------------------
// 返回契约文案反映真实约束来源
// ---------------------------------------------------------------------------
describe("返回契约文案反映真实约束来源", () => {
/**
 * 回归钉 —— 返回契约的诊断文案**硬指 `@nudo:contract return`** ⇒
 * 约束来源是**侧车 `fn()` 返回槽**时也被说成「源码里那条指令」⇒ 源文件里
 * **根本没有**这条指令，而同一条诊断的 `fix:` 提示又说「emit a sidecar
 * draft」⇒ 一条诊断里两处归因互相矛盾。
 *
 * 修法（族 07 片 S4）：文案反映**真实约束来源**——
 * - 源码里有 `@nudo:contract return <name>` ⇒ 仍说 `@nudo:contract return <name>`；
 * - 约束来自侧车 `fn({...}, <ret>)` 的返回槽 ⇒ 说 `sidecar fn() return slot (...)`。
 *
 * 钉：侧车来源 ⇒ 消息**不得**出现 `@nudo:contract return`；源码指令来源 ⇒ 消息
 * **必须**仍是 `@nudo:contract return <name>`（对照组，防过度改写）。
 */



/** 侧车：只有 `fn()` 返回槽有约束，源码里没有 `@nudo:contract` */
const sidecarOnly = `import { fn, number } from "@nudojs/core";
export const bad = fn({}, number().gt(0));
`;


  it("侧车 fn() 返回槽来源 ⇒ 消息说 sidecar，不得说源码指令", () => {
    const r = checkSource(
      "/t/bug378-sidecar.js",
      `export function bad() {
  return -1;
}
`,
      pTrue,
      {
        loadModule: (spec: string): string | undefined =>
          spec.endsWith(".nudo.js") ? sidecarOnly : undefined,
        fromFile: "/t/bug378-sidecar.js",
      },
    );
    const violated = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(violated).toBeDefined();
    expect(violated!.message).toContain("sidecar fn() return slot");
    expect(violated!.message).not.toContain("@nudo:contract return");
  });

  it("源码 @nudo:contract return 来源 ⇒ 消息仍是 @nudo:contract return <name>（对照组）", () => {
    const r = checkSource(
      "/t/bug378-directive.js",
      `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract return positive
 */
export function bad() {
  return -1;
}
`,
      pTrue,
      {
        loadModule: (spec: string): string | undefined =>
          spec.endsWith("std.nudo.js")
            ? `export const positive = number().gt(0);`
            : undefined,
        fromFile: "/t/bug378-directive.js",
      },
    );
    const violated = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(violated).toBeDefined();
    expect(violated!.message).toContain("@nudo:contract return positive");
    expect(violated!.message).not.toContain("sidecar fn() return slot");
  });

});

// ---------------------------------------------------------------------------
// 未契约的兄弟绑定不进形参形状
// ---------------------------------------------------------------------------
describe("未契约的兄弟绑定不进形参形状", () => {
/**
 * 对象解构形参：**未契约的兄弟绑定**被整个丢弃 ⇒ 合成出的形参
 * 形状是**闭对象** ⇒ 读兄弟绑定得 **exact `undefined`**（自信的错值；native
 * 是实值）。
 *
 * 根因：`generalize.ts` 的 `patternFields` 袋子只收**契约命中的字段** ⇒ 没有
 * 契约的兄弟绑定从头到尾不进袋子 ⇒ `buildPatternObjAbs` 把袋子原样变成形参
 * 的 obj shape ⇒ 形参类型写成 `{ a: number }`（源码里的 `{ a, b }` 只剩 a），
 * 函数体读 `b` 得 exact `undefined`。
 *
 * 修法（族 08 · AGENT-CONTEXT §4 裁决）：按「闭对象 → unknown」的语义补 ——
 * 合成前把该 pattern 的**全部顶层绑定**都放进袋子（未契约的用 `unknown`）。
 *
 * 反向钉：HEAD（未修）上形参类型是 `{ a: number }`、返回值是
 * `[number, undefined]` ⇒ 本文件在 HEAD 上**必失败**。
 */





const TPL = `export const positive = number().gt(0);\n`;

/** 只契约 a 的解构形参 */
const PARTIAL = `/// @nudo:import { positive } from "./tpl.nudo.js"
/**
 * @nudo:contract a positive
 */
export function f({ a, b }) {
  return [a, b];
}
`;

/** 对照组：两个字段都有契约 */
const FULL = `/// @nudo:import { positive } from "./tpl.nudo.js"
/**
 * @nudo:contract a positive
 * @nudo:contract b positive
 */
export function f({ a, b }) {
  return [a, b];
}
`;

function checkOf(src: string): {
  paramTypes: string[];
  display: string;
  abs: unknown;
} {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  const r = checkSource_____check_check_ts("/t/f.js", src, pTrue_____pred_ts, {
    loadModule: (spec: string) => (spec.includes("tpl.nudo.js") ? TPL : undefined),
    fromFile: "/t/f.js",
    autoBind: true,
  });
  const sig = r.signatures.find((s) => s.name === "f")!;
  return {
    paramTypes: sig.paramTypes ?? [],
    display: sig.display,
    abs: sig.abs,
  };
}


  it("只契约 a：形参形状含 b（unknown），不是闭对象", () => {
    const r = checkOf(PARTIAL);
    expect(r.paramTypes[0]).toContain("b");
    expect(r.paramTypes[0]).toContain("unknown");
  });

  it("只契约 a：读兄弟绑定 b 折 unknown（不是 exact undefined）", () => {
    const r = checkOf(PARTIAL);
    // 返回面：{ a, b } ⇒ [number, unknown]（此前是 [number, undefined]）
    expect(r.display).toContain("unknown");
    expect(r.display).not.toContain("undefined");
  });

  it("形参 obj shape 的槽位数 ≥ 该 pattern 的绑定数（兜底自检）", () => {
    resetGeneralizeMemo();
    const g = generalizeFromAst("f", PARTIAL, {
      refine: {
        loadModule: (spec: string) => (spec.includes("tpl.nudo.js") ? TPL : undefined),
        fromFile: "/t/f.js",
        autoBind: true,
      },
    })!;
    const formal = g.formals!.find((f) => f.kind === "pattern")!;
    expect(formal.kind).toBe("pattern");
    if (formal.kind !== "pattern") return;
    const shape = g.typeParams[formal.index]!.value.shape as {
      k: string;
      slots?: Record<string, unknown>;
    };
    expect(shape.k).toBe("obj");
    expect(Object.keys(shape.slots ?? {}).length).toBeGreaterThanOrEqual(
      formal.bound.length,
    );
  });

  it("对照组：两个字段都有契约 ⇒ 形状不变（{ a: number, b: number }）", () => {
    const r = checkOf(FULL);
    expect(r.paramTypes[0]).toContain("a: number");
    expect(r.paramTypes[0]).toContain("b: number");
    expect(r.paramTypes[0]).not.toContain("unknown");
  });

});

// ---------------------------------------------------------------------------
// —— 非标量实参撞标量 / union 契约不再零义务
// ---------------------------------------------------------------------------
describe("—— 非标量实参撞标量 / union 契约不再零义务", () => {
/**
 * —— **非标量实参**撞标量 / union 契约时的义务（假绿那一半）。
 *
 * 症状（族 11 / S6 修前实测，闸① oracle）：
 * - `union(number(), string())` 收到 `{}` ⇒ 0 违例（**假绿**）
 * - `union(number(), string())` 收到 `[]` ⇒ 0 违例（**假绿**）
 * - `lit(1n)` 收到 `{}` ⇒ 0 违例（**假绿**）
 * - `lit(1n)` 收到 `[]` ⇒ 0 违例（**假绿**）
 * - `union(lit(1), lit(2))` 收到 `{}` ⇒ 0 违例（**假绿**）
 *
 * 根因：`scan/literal-shapes.ts` 的 `checkReqs` 里 `lv` **值类型门**
 * （`if (lv === undefined) continue;` + `typeof lv === number|string|boolean`）
 * 把对象 / 数组 / bigint 实参挡在 eq / or 分支外 ⇒ 那些实参对 `lit(...)`
 * 契约**零义务**。
 *
 * ⚠ **区分「不可判定」与「确定违例」**：对象 / 数组 / 函数实参对**标量**
 * 字面量契约是**确定违例**（`{}` 永远不是 `1`），不是「不知道」⇒ 不能因为
 * 取不到标量值就跳过（那是假绿）。
 *
 * 修法（S6）：
 * - `eq` 分支：实参是精确字面量 ⇒ 按**字面量同一性**比；实参不是字面量
 * 但**形态确定** ⇒ **类型级**判定（形态 ≠ 字面量端类型 ⇒ 确定违例）。
 * - `or` 分支：`or` 聚合臂**移出** `lv` 值类型门（对所有实参可达）⇒
 * `typeof` 成员 / nullish 成员 / 字面量成员都能参与逐支求值。
 *
 * ── 任务③：`or` 聚合臂的 `unknown` 语义收紧 ─────────────────────────────
 * 聚合规则从「含 undefined 不猜」收紧为「**全部成员都判不了**才算不可判定」：
 * 只要**有一个成员能判为 false** ⇒ 确定违例（要报）。
 * ⇒ `union(number(), lit(null))` 收到 `{}`：`typeof` 成员判 false（object ≠
 * number）、`lit(null)` 成员判不了 ⇒ **仍然报违例**。
 */





const SIDE = `import { number, string, lit, union } from "@nudojs/core";
export const numOrStr = union(number(), string());
export const litOneN = lit(1n);
export const litUnion1 = union(lit(1), lit(2));
export const numOrNull = union(number(), lit(null));
`;

const IMP = `/// @nudo:import { numOrStr, litOneN, litUnion1, numOrNull } from "./std431.nudo.js"\n`;

const FILE = "/t/std431.js";

/** 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本 */
function check(src: string) {
  resetCheckSourceMemo___nudojs_core();
  resetGeneralizeMemo___nudojs_core();
  return checkSource___nudojs_core(FILE, IMP + src, pTrue___nudojs_core, sidecarOpts("std431", SIDE, FILE));
}

/** 调用点前置条件违例（nudo:constraint-violated） */
function violated(r: { issues: CheckIssue[] }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

/** 带指定契约的调用（契约写在形参 x 上） */
function call(contract: string, arg: string): string {
  return `/** @nudo:contract x ${contract} */
export function f(x) { return x; }
export function use() { return f(${arg}); }`;
}

describe("— 非标量实参撞标量 / union 契约不再零义务", () => {
  it("union(number(), string()) 收到对象 ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("numOrStr", "{}"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe('(typeof x = "number" ∨ typeof x = "string")');
  });

  it("union(number(), string()) 收到数组 ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("numOrStr", "[]"));
    expect(violated(r).length).toBe(1);
  });

  it("lit(1n) 收到对象 ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("litOneN", "{}"));
    const vs = violated(r);
    // 族 48（主 agent 追认，2026-10-23）：bigint 字面量契约**补齐了缺失的
    // `typeof` 类型义务** ⇒ 与 number/string/boolean 兄弟 prim **同款**
    // ⇒ 首条消息由 `x = 1n` 变为 `typeof x = "bigint"`。
    // 本用例的**核心主张**（对象实参违反 lit(1n) 契约 ⇒ 必判违例）**不变**，
    // **违例条数不变**（仍是 1 条）—— 变的只是**首条消息的措辞**。
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe('typeof x = "bigint"');
  });

  it("lit(1n) 收到数组 ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("litOneN", "[]"));
    expect(violated(r).length).toBe(1);
  });

  it("union(lit(1), lit(2)) 收到对象 ⇒ 判违例（改前 0 违例 = 假绿）", () => {
    const r = check(call("litUnion1", "{}"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x = 1 ∨ x = 2)");
  });

  it("任务③：一个成员判 false、其余判不了 ⇒ 仍判违例（unknown 语义收紧）", () => {
    // `typeof` 成员判 false（object ≠ number）、`lit(null)` 成员判不了
    const r = check(call("numOrNull", "{}"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe('(typeof x = "number" ∨ x = null)');
  });

  it("负控制：union(number(), string()) 收到 number ⇒ 放行", () => {
    const r = check(call("numOrStr", "1"));
    expect(violated(r).length).toBe(0);
  });

  it("负控制：union(number(), string()) 收到 string ⇒ 放行", () => {
    const r = check(call("numOrStr", '"s"'));
    expect(violated(r).length).toBe(0);
  });

  it("负控制：union(lit(1), lit(2)) 收到 1 ⇒ 放行", () => {
    const r = check(call("litUnion1", "1"));
    expect(violated(r).length).toBe(0);
  });

  it("负控制：union(lit(1), lit(2)) 收到 3 ⇒ 判违例（两个成员都判 false）", () => {
    const r = check(call("litUnion1", "3"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x = 1 ∨ x = 2)");
  });

  it("负控制：union(number(), lit(null)) 收到 null ⇒ 放行（null 成员为真）", () => {
    const r = check(call("numOrNull", "null"));
    expect(violated(r).length).toBe(0);
  });

  it("负控制：没有契约的形参收到对象 ⇒ 零违例（违例来自契约，不是引擎噪声）", () => {
    const r = check(`export function f(x) { return x; }
export function use() { return f({}); }`);
    expect(violated(r).length).toBe(0);
  });
});
});

// ---------------------------------------------------------------------------
// assume 的界落进形参 pred（core 半）
// ---------------------------------------------------------------------------
describe("assume 的界落进形参 pred（core 半）", () => {
/**
 * （core 半）—— `buildArgsFromAssume` 把被假设形参的**前提硬编码成
 * `x > 0`** ⇒ `--assume` 的**非正界**（`x>-5` / `x>-100`）被静默替换成
 * `x>0` ⇒ 引擎**过度收窄** ⇒ 合法分支被剪掉（错值 / 假绿）。
 *
 * 根因：core 这一面只收到 id 集合（`assumeIds`），拿不到用户声明的界 ⇒ 写死
 * `>0` 成了「唯一可用假设」；CLI 那一面把用户界只放进 Φ ⇒ 两路合取
 * （`x>0 ∧ x>-5` = `x>0`）把负界吃掉。
 *
 * 修法（族 08 · AGENT-CONTEXT §4 裁决 + 报告 fix）：core 接收**形参 → 界**的
 * 映射，把用户声明的界直接落进形参的 `pred`；**没有声明界时不写界**（不替
 * 用户发明一个更强的默认界）⇒ Φ 只承担跨变量 / 额外前提。
 *
 * 反向钉：HEAD（未修）上 pred 恒为 `x > 0` ⇒ 本文件在 HEAD 上**必失败**。
 */





const SRC = `export function k(x) {
  if (x < 0) {
    return "neg";
  }
  return "pos";
}
`;

const assumeIds = new Set(["x"]);


  it("没有声明界 ⇒ 不写界（不得替用户发明 x > 0）", () => {
    const args = buildArgsFromAssume(SRC, "k", assumeIds);
    expect(args.length).toBe(1);
    expect(args[0]!.pred).toBeUndefined();
  });

  it("声明的界直接落进形参 pred（严格 >）", () => {
    const bounds: Map<string, Pred> = new Map([["x", gtNum(v("x"), -5)]]);
    const args = buildArgsFromAssume(SRC, "k", assumeIds, bounds);
    expect(args[0]!.pred).toBeDefined();
    expect(predToString(args[0]!.pred!)).toBe("x > -5");
  });

  it("声明的界直接落进形参 pred（非严格 >=）", () => {
    const bounds: Map<string, Pred> = new Map([["x", geNum(v("x"), 1)]]);
    const args = buildArgsFromAssume(SRC, "k", assumeIds, bounds);
    expect(predToString(args[0]!.pred!)).toBe("x ≥ 1");
  });

  it("未被 assume 的形参仍是 any（不写界）", () => {
    const src = `export function k2(x, y) { return x + y; }\n`;
    const args = buildArgsFromAssume(src, "k2", new Set(["x"]), new Map([["x", gtNum(v("x"), 0)]]));
    expect(args.length).toBe(2);
    expect(args[0]!.pred).toBeDefined();
    expect(args[1]!.pred).toBeUndefined();
    expect(args[1]!.shape.k).toBe("any");
  });

});
