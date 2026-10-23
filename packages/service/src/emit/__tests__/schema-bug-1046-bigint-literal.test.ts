/**
 * Bug 1046 —— **契约申报的** bigint 字面量在 **zod 面被静默放宽成 `z.unknown()`**、
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
 *   **不含** `z.unknown()`；
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
import { describe, it, expect } from "vitest";
import { abs, constraintToEntryAbs, litC, obj, type Abs } from "@nudojs/core";
import {
  absToSchemaNode,
  absToSchemaSource,
  absToZodSchemaModule,
  schemaNodeToZodProjection,
} from "../schema-generator.ts";
import { absToStandardSchemaModule } from "../standard-schema.ts";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";
import { loadGeneratedModule } from "./fixtures.ts";

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

describe("Bug 1046 — 契约申报的 bigint 字面量在 zod 面不得被静默放宽", () => {
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
    expect(node).toEqual({ k: "unknown" });
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
