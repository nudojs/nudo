/**
 * 模块套件：schema 投影面（zod / standard / guard 跨面一致性）。
 *
 * bigint 字面量、-0 保真、bound/length 锚定与标准 schema 的 -0 口径归并；
 * 断言与生成产物执行断言逐字保留。
 */
import { describe, it, expect } from "vitest";
import { abs, constraintToEntryAbs, litC, obj, type Abs, app, eq, lit, v, ge, gt, SELF, numLit } from "@nudojs/core";
import { absToSchemaNode, absToSchemaSource, absToZodSchemaModule, schemaNodeToZodProjection, projectAbsToSchema } from "../schema-generator.ts";
import { absToStandardSchemaModule, absToStandardSchema, validateSchemaNode } from "../standard-schema.ts";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";
import { loadGeneratedModule } from "./fixtures.ts";

// ---------------------------------------------------------------------------
// 契约申报的 bigint 字面量在 zod 面不得被静默放宽
// ---------------------------------------------------------------------------
describe("契约申报的 bigint 字面量在 zod 面不得被静默放宽", () => {
/**
 * **契约申报的** bigint 字面量在 **zod 面被静默放宽成 `z.unknown()`**、
 * 且**零台账** ⇒ 与 standard / guard 面**接受集自相矛盾**（假绿）。
 *
 * 病灶（改前）：`packages/service/src/emit/schema-generator.ts` 的 zod 渲染臂
 * `case "lit"` **没有 bigint 分支** ⇒ 落到兜底 `z.unknown()`。
 *
 * 为什么是「零台账」：契约路径的 Abs 形态是 core 的
 * `constraintToEntryAbs(litC(10n), "return")` —— 字面量住在 **pred** 里
 * （`eq(self, lit(10n))`）、不在 term 里 ⇒ 节点层（`absToSchemaNode`）认为
 * 「投影成功」（节点 = `{k:"lit", value:10n}`）⇒ **不进 dropped** ⇒ 用户只看到
 * `z.unknown()`，产物里**没有任何痕迹**。
 *
 * 改后：zod 面渲染 `z.literal(10n)` —— zod 的 `z.literal` **原生支持 bigint**
 * （zod v3/v4 皆可；真 zod v4.6.7 实测：`safeParse(10n)=true`、
 * `safeParse(10|42|"x"|null|undefined)=false`）⇒ zod 面的接受集 == standard 面
 * （`{"k":"lit","value":10n}`）的接受集 ⇒ 跨面自相矛盾消失。
 *
 * 本文件钉住：
 * - 契约申报的 bigint 字面量（返回面 + 形参面）⇒ zod 源码是 `z.literal(10n)`，
 * **不含** `z.unknown()`；
 * - **跨面一致**：zod 面的接受集与 standard 面（**真执行生成产物**）逐值一致；
 * - **负控**：确实无法投影的形态仍降级，但**留痕可见**（既有 dropped 通道）。
 *
 * ~~已知偏差（core 层，族外）~~ **已由族 48 收口（2026-10-23）**：
 * 原先 guard 面渲染 `typeof data === "number" && data === 10n` ⇒ `guard(10n) === false`
 * （**假红**：拒收契约申报的唯一合法值）。根因在 core：`litC(bigint)` 不给 prim
 * （`PrimName` 有 "bigint" 但 `litC` 不用）⇒ `constraintOnTermAbs` 落到
 * 「有界但无 prim ⇒ 按 number 处理」的兜底 ⇒ Abs 的 shape 说 number、pred 说 bigint。
 * 族 48 给 `litC(bigint)` 补上 `prim: "bigint"` ⇒ shape 条款变成
 * `typeof data === "bigint"` ⇒ `guard(10n) === true` ⇒ 三面接受集一致。
 * 下方的 `it.fails` 旗标已随之**翻成真断言**（主 agent 追认）。
 */







/**
 * 契约申报的 bigint 字面量（侧车 `fn({}, lit(10n))` 的返回域 Abs 形态）。
 * 字面量在 pred 里（`eq(self, lit(10n))`）——这正是「节点层认为投影成功、
 * 渲染层却认不出」的错配入口。
 */
const contractBigInt = (): Abs => constraintToEntryAbs(litC(10n), "return");

/** 被校验的候选值：契约申报的唯一合法值 + 各种违约值。 */
const CANDIDATES: readonly unknown[] = [10n, 10, 42, "x", null, undefined];

/**
 * zod 面的接受集（按 zod 的 `z.literal` 语义求值）。
 *
 * zod 的 `z.literal(v)` 语义 = **严格相等** ⇒ 接受集恰为 `{v}`。真 zod v4.6.7
 * 实测：`z.literal(10n)` 收 10n、拒 10 / 42 / "x" / null / undefined。
 * （service 包不依赖 zod ⇒ 这里按 zod 的**原生语义**建模，不引入新依赖；
 * 真 zod 的对拍取证在 `tmp/probe/fix-r95/S3/`。）
 */
function zodLiteralAccepts(source: string, value: unknown): boolean {
  const m = /^z\.literal\((-?\d+)n\)$/.exec(source);
  if (!m) return false;
  return value === BigInt(m[1]!);
}


  it("返回面：zod 源码是 z.literal(10n)（不是 z.unknown()）", () => {
    const source = absToSchemaSource(contractBigInt());
    expect(source).toBe("z.literal(10n)");
    expect(source).not.toContain("z.unknown()");
  });

  it("形参面：契约申报的 bigint 形参同样投影成 z.literal(10n)", () => {
    const input = obj({ x: { value: constraintToEntryAbs(litC(10n), "x") } });
    expect(absToSchemaSource(input)).toBe("z.object({ x: z.literal(10n) })");
  });

  it("跨面一致：zod 面的接受集 == standard 面（真执行生成产物）", async () => {
    const contract = contractBigInt();
    const zodSource = absToSchemaSource(contract);

    // standard 面：真执行**生成产物**里的内联校验器（不是只比对节点形态）
    const stdMod = await loadGeneratedModule(
      absToStandardSchemaModule({ retBigIntOutput: contract }).source,
    );
    const stdVerdicts = CANDIDATES.map(
      (v) => stdMod.retBigIntOutput!["~standard"].validate(v).issues === undefined,
    );

    // zod 面：按 zod 的 literal 语义（严格相等）求值
    const zodVerdicts = CANDIDATES.map((v) => zodLiteralAccepts(zodSource, v));

    // 契约申报的唯一合法值被收；违约值（10 / 42 / "x" / null / undefined）全被拒
    expect(stdVerdicts).toEqual([true, false, false, false, false, false]);
    expect(zodVerdicts).toEqual(stdVerdicts);
  });

  it("guard 面的字面量条款保真（data === 10n）", () => {
    const guardSrc = generateGuardFunctionFromAbs("isretBigIntOutput", contractBigInt());
    expect(guardSrc).toContain("data === 10n");
  });

  it(
    "跨面一致：guard 面也接受契约申报的 10n（族 48 已修 core 层 prim 兜底缺陷）",
    async () => {
      const guardSrc = generateGuardFunctionFromAbs("isretBigIntOutput", contractBigInt());
      const guardMod = (await loadGeneratedModule(guardSrc)) as unknown as Record<
        string,
        (v: unknown) => boolean
      >;
      // 改前：guard(10n) === false —— shape 条款 `typeof data === "number"`
      // 来自 core 的「无 prim ⇒ number」兜底 ⇒ 恒假 ⇒ **假红**（拒收合法值）。
      // 族 48 修后：core 的 `litC(bigint)` 给出 `prim: "bigint"` ⇒
      // shape 条款变成 `typeof data === "bigint"` ⇒ guard(10n) === true。
      // （旗标翻转：**它.fails → 真断言**，由主 agent 追认，2026-10-23）
      expect(guardMod.isretBigIntOutput!(10n)).toBe(true);
    },
  );

  it("契约 bigint 路径不再是降级 ⇒ 不产生台账条目（零台账的根因已消除）", () => {
    const { node, dropped } = absToSchemaNode(contractBigInt());
    expect(node).toEqual({ k: "lit", value: 10n });
    expect(dropped).toEqual([]);

    const mod = absToZodSchemaModule({ retBigIntOutput: contractBigInt() });
    expect(mod.dropped).toEqual([]);
    expect(mod.source).not.toContain("dropped");
    expect(mod.source).toContain("export const retBigIntOutput = z.literal(10n);");
  });

  it("负控：观测路径（源码级 bigint）仍留痕（同口径：降级必有台账）", () => {
    const observed = abs(
      { k: "prim", type: "bigint" },
      { op: "lit", value: 10n },
      undefined,
      "exact",
    );
    const { node, dropped } = absToSchemaNode(observed);
    // 观测路径的 bigint 字面量改保**基类型**（`{k:"prim",type:"bigint"}`
    // ⇒ `z.bigint()`）；改前是 `{k:"unknown"}` ⇒ 校验器接受**任何**值
    // （字符串 / 对象 / 数字都行），与 guard 面 `data === 10n` 接受集不相交。
    expect(node).toEqual({ k: "prim", type: "bigint", refinements: [] });
    expect(dropped.some((d) => d.includes("bigint"))).toBe(true);
  });

  it("负控：确实无法投影的形态仍降级，但留痕可见（既有 dropped 通道）", () => {
    // 用户类 brand：zod 产物只 import zod ⇒ 名字不在模块作用域 ⇒ 不可 z.instanceof
    const brand = abs(
      { k: "brand", name: "Counter", shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") },
      undefined,
      undefined,
      "exact",
    );
    const mod = absToZodSchemaModule({ makeCounterOutput: brand });
    expect(mod.source).toContain("z.unknown()");
    expect(mod.source).not.toContain("z.instanceof(Counter)");
    expect(mod.dropped.some((d) => d.includes("brand not projected"))).toBe(true);
    // 台账进产物（用户可见）
    expect(mod.source).toContain("// dropped preds (not projected into zod):");
  });

  it("负控：渲染层降级必须留痕（方言层不得静默放宽成 z.unknown()）", () => {
    // 类型外的字面量值（运行期可能出现）⇒ 兜底降级 + **台账**
    const r = schemaNodeToZodProjection({ k: "lit", value: Symbol("nope") } as never);
    expect(r.source).toBe("z.unknown()");
    expect(r.dropped.some((d) => d.includes("lit not projected"))).toBe(true);
  });

});

// ---------------------------------------------------------------------------
// zod 产物面必须保真写 -0（不许静默放宽成 0）
// ---------------------------------------------------------------------------
describe("zod 产物面必须保真写 -0（不许静默放宽成 0）", () => {
/**
 * zod 产物面把 `lit(-0)` 写成 `z.literal(0)` ⇒ **比门禁宽** ⇒ 假绿。
 *
 * 改前：`schemaNodeToZod` 的 `case "lit"` 数字分支用模板串 `z.literal(${v})`
 * ⇒ `String(-0) === "0"` ⇒ 负号被抹掉 ⇒ 产物写 `z.literal(0)`：
 *
 * export const fInput = z.object({ o: z.object({ v: z.literal(0) }) });
 * export const fOutput = z.literal(0);
 *
 * 门禁（`nudo check`）按侧车的 `lit(-0)` 判红、zod 产物却放行 `0`
 * ⇒ 消费方拿到一个**比 CI 门禁宽松**的校验器 ⇒ 假绿。
 *
 * 改后：**保真**写 `z.literal(-0)`（不许静默放宽成 `0`）。
 * ⚠ zod 的 literal 走 `===` 口径 ⇒ `-0` 与 `0` 在运行时**不可区分**
 * ⇒ 该处**已知有损** ⇒ 产物就地标注（消费方看得见），不许无声无息。
 * （zod 的运行时行为本次**未独立复现**——环境无 zod 依赖 ⇒ 本钉只断言
 * **产物文本**，不断言 zod 的运行时接受集。）
 *
 * ⚠ 范围：只改 `schema-generator.ts` 的 `case "lit"` 数字分支。
 */




const litNeg0: Abs = abs({ k: "prim", type: "number" }, { op: "lit", value: -0 }, undefined, "exact");
const lit42: Abs = abs({ k: "prim", type: "number" }, { op: "lit", value: 42 }, undefined, "exact");


  it("lit(-0) 渲染成 z.literal(-0)，不是 z.literal(0)", () => {
    const source = absToSchemaSource(litNeg0);
    expect(source).toContain("z.literal(-0)");
    expect(source).not.toContain("z.literal(0)");
  });

  it("该处标注「已知有损」（zod 的 === 口径区分不了 -0 与 0）", () => {
    expect(absToSchemaSource(litNeg0)).toContain("known lossy");
  });

  it("产物是可执行的 JS，且字面量值确实是 -0（Object.is）", () => {
    const source = absToSchemaSource(litNeg0);
    const z = { literal: (v: unknown) => ({ lit: v }) };
    const out = new Function("z", `return ${source};`)(z) as { lit: unknown };
    expect(Object.is(out.lit, -0)).toBe(true);
  });

  it("模块产物（export --format schema）同样保真", () => {
    const { source } = absToZodSchemaModule({ f: litNeg0 });
    expect(source).toContain("z.literal(-0)");
    expect(source).not.toContain("z.literal(0)");
  });

  it("负控制：普通数字字面量不受牵连（逐字 z.literal(42)，无多余注释）", () => {
    expect(absToSchemaSource(lit42)).toBe("z.literal(42)");
  });

});

// ---------------------------------------------------------------------------
// schema length/bound anchoring
// ---------------------------------------------------------------------------
describe("schema length/bound anchoring", () => {
/**
 * schema 投影的 pred 必须锚定 self。回归背景：lengthBound 只认 `fn==="length"`、
 * numericBound 把任意 var 当 self——`length(other)>=1` / `gt(other,0)` 会被
 * 投影成字符串 min(1) / 数字 gt(0)，把无关变量的约束盖到当前值上。
 * 主路径 absToConstraint 会拒掉未锚定项（返回 undefined）；错在 fallback。
 *
 * eq 同类：eqLitValue 曾把裸 `op==="app"` 当已锚定——`eq(length(s),5)` 被投影成
 * `z.literal(5)`（数字字面量盖到字符串上），dropped 仍为空。锚定与 core
 * anchoredEqLit 同口径：只认 self var。
 */




const strWith = (pred: Parameters<typeof abs>[2]) =>
  abs({ k: "prim", type: "string" }, { op: "var", id: "s" }, pred, "exact");
const numWith = (pred: Parameters<typeof abs>[2]) =>
  abs({ k: "prim", type: "number" }, { op: "var", id: "x" }, pred, "exact");

/** Abs 的 number prim 域 = 全部 JS number（含 NaN / ±Infinity）⇒ zod 侧放宽 */
const WIDE_NUMBER = "z.number().or(z.nan()).or(z.literal(Infinity)).or(z.literal(-Infinity))";


  it("length(other) is not a string min", () => {
    const a = strWith(ge(app("length", [v("other")]), lit(1)));
    expect(absToSchemaSource(a)).toBe("z.string()");
    expect(projectAbsToSchema(a).source).toBe("z.string()");
  });

  it("gt(other, 0) is not a number bound", () => {
    const a = numWith(gt(v("other"), lit(0)));
    expect(absToSchemaSource(a)).toBe(WIDE_NUMBER);
    expect(projectAbsToSchema(a).source).toBe(WIDE_NUMBER);
  });

  it("length(self var) still projects min", () => {
    // fallback 路径（absToConstraint 对 length(s) 会改写为 __nudo_self__；
    // 这里直接断言锚定 length(s) 仍可投影）
    const a = strWith(ge(app("length", [v("s")]), lit(1)));
    // 长度界按 **UTF-16 码元** 判定（refine），不映射 zod 的码点 API
    expect(absToSchemaSource(a)).toBe("z.string().refine((s) => s.length >= 1)");
  });

  it("length(__nudo_self__) projects min (constraint path)", () => {
    const a = strWith(ge(app("length", [v(SELF)]), lit(1)));
    // 长度界按 **UTF-16 码元** 判定（refine），不映射 zod 的码点 API
    expect(absToSchemaSource(a)).toBe("z.string().refine((s) => s.length >= 1)");
  });

  it("gt(self var) still projects bound", () => {
    const a = numWith(gt(v("x"), lit(0)));
    expect(absToSchemaSource(a)).toBe("z.number().gt(0).or(z.literal(Infinity))");
  });

  // --- eq 路径（与 anchoredEqLit 同口径：只认 self var 锚定）---

  it("eq(length(self), 5) is not z.literal(5)", () => {
    const a = strWith(eq(app("length", [v("s")]), lit(5)));
    expect(absToSchemaSource(a)).toBe("z.string()");
    const p = projectAbsToSchema(a);
    expect(p.source).toBe("z.string()");
    expect(p.dropped.length).toBeGreaterThan(0);
    expect(p.dropped.join("\n")).toContain("pred not projected");
  });

  it("eq(5, length(self)) reverse is not z.literal(5)", () => {
    const a = strWith(eq(lit(5), app("length", [v("s")])));
    expect(absToSchemaSource(a)).toBe("z.string()");
    expect(projectAbsToSchema(a).source).toBe("z.string()");
  });

  it("eq(length(other), 5) is not a literal", () => {
    const a = strWith(eq(app("length", [v("other")]), lit(5)));
    expect(absToSchemaSource(a)).toBe("z.string()");
    expect(projectAbsToSchema(a).source).toBe("z.string()");
  });

  it("eq(get(self,\"x\"), 5) is not z.literal(5)", () => {
    const a = numWith(eq(app("get", [v("x"), lit("y")]), lit(5)));
    expect(absToSchemaSource(a)).toBe(WIDE_NUMBER);
    expect(projectAbsToSchema(a).source).toBe(WIDE_NUMBER);
  });

  it("eq(self, lit) still projects literal", () => {
    expect(absToSchemaSource(strWith(eq(v("s"), lit("ada"))))).toBe('z.literal("ada")');
    expect(absToSchemaSource(numWith(eq(v("x"), lit(42))))).toBe("z.literal(42)");
    expect(absToSchemaSource(strWith(eq(lit("ada"), v("s"))))).toBe('z.literal("ada")');
  });

  it("eq(__nudo_self__, lit) still projects literal (constraint path)", () => {
    expect(absToSchemaSource(strWith(eq(v(SELF), lit("ada"))))).toBe('z.literal("ada")');
    expect(absToSchemaSource(numWith(eq(v(SELF), lit(42))))).toBe("z.literal(42)");
  });

});

// ---------------------------------------------------------------------------
// 生成产物内联副本必须与库函数版同口径处理 -0
// ---------------------------------------------------------------------------
describe("生成产物内联副本必须与库函数版同口径处理 -0", () => {
/**
 * standard-schema 生成产物**内联副本**的 `__nudoDescribe` 未处理
 * `-0` ⇒ 与**库函数副本**（`describeValue`）口径分叉。
 *
 * 修前：库函数版给 `expected 1, got -0`；生成产物内联版给 `expected 1, got 0`
 * （`String(-0) === "0"`）⇒ 同一 schema 在「库校验」与「产物自校验」两个面
 * 上给出**不一致的消息**。
 *
 * 同文件三份副本的现状（本用例的判据）：
 * - `describeValue`（库函数版，:107）——已处理 `-0` ✅
 * - `__nudoDescribe`（生成产物内联版，:365）——修前**未**处理 ❌ ⇒ 本次补
 * - `literalValueSource`（字面量序列化，:538）——已处理 `-0` ✅（无需同步）
 *
 * 断言形态：**逐字相同**（两份实现的结果必须完全一致）。
 */







  it("库函数版与生成产物版对 -0 给出逐字相同的消息", async () => {
    const { node } = absToSchemaNode(numLit(1));
    const { source } = absToStandardSchema(numLit(1), { name: "one" });
    const mod = await loadGeneratedModule(source);

    const lib = validateSchemaNode(node, -0);
    const prod = mod.one!["~standard"].validate(-0);
    // 两份实现逐字一致（修前：库函数 "-0" / 产物 "0" ⇒ 这里挂）
    expect(JSON.stringify(prod)).toBe(JSON.stringify(lib));
    // 且消息必须保真到 -0（字面量保真：-0 与 0 在除法 / Math.sign / Object.is 上可观察）
    expect(prod.issues?.[0]?.message).toContain("got -0");
    expect(lib.issues?.[0]?.message).toContain("got -0");
  });

  it("负控制：期望值本身是 -0 时两份实现都放行（不得把 -0 当成不匹配）", async () => {
    const { node } = absToSchemaNode(numLit(-0));
    const { source } = absToStandardSchema(numLit(-0), { name: "zero" });
    const mod = await loadGeneratedModule(source);

    const lib = validateSchemaNode(node, -0);
    const prod = mod.zero!["~standard"].validate(-0);
    expect(JSON.stringify(prod)).toBe(JSON.stringify(lib));
    expect(prod.issues).toBeUndefined();
  });

});
