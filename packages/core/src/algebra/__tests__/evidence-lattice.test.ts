/**
 * ADR 0001 阶段 0 · Evidence 优先级格与 fail-closed 边界（纯单元测试）。
 *
 * 阶段 0 不接产品面：本文件验证 D2 的类型与决议语义本身，不改变任何
 * `check` / `export` / dts 行为。对应 / 014 / 021 / 030 / 008。
 */
import { describe, it, expect } from "vitest";
import { DIAG } from "../diagnostics/diag-codes.ts";
import {
  declaredOf,
  observedOf,
  degradedOf,
  resolvePublicType,
  publicName,
  isPlaceholder,
  publishBlockedBy,
  type ModuleForm,
} from "../diagnostics/evidence.ts";

/** 测试用的最小 join：字符串域的并（真实产品面由 Abs 的 join 提供）。 */
const joinUnion = (a: string, b: string): string =>
  a === b ? a : [a, b].sort().join(" | ");

describe("Evidence · 优先级格（ADR D2）", () => {
  it("declared 胜过 observed：注解不被初始化器窄化（BUG-014）", () => {
    const e = resolvePublicType<string>(
      [observedOf("number"), declaredOf("number | null", "annotation")],
      joinUnion,
    );
    expect(e).toEqual({ kind: "declared", value: "number | null", from: "annotation" });
  });

  it("多条 observed 走 join：内部单次构造点不钉死公开类型（BUG-007）", () => {
    const e = resolvePublicType<string>(
      [observedOf("undefined"), observedOf("number", 2)],
      joinUnion,
    );
    expect(e.kind).toBe("observed");
    if (e.kind === "observed") {
      expect(e.paths).toBe(3);
      expect(e.value).toContain("undefined");
      expect(e.value).toContain("number");
      expect(e.value).not.toBe("undefined");
    }
  });

  it("degraded 只在无其它来源时出现，且不带值（无「降级成 any」构造子）", () => {
    const e = degradedOf<string>(DIAG.contractLoad);
    expect(e).toEqual({ kind: "degraded", reason: DIAG.contractLoad });
    expect("value" in e).toBe(false);
    const mixed = resolvePublicType<string>(
      [degradedOf(DIAG.internal), observedOf("number")],
      joinUnion,
    );
    expect(mixed.kind).toBe("observed");
  });

  it("空证据 ⇒ degraded(nudo:unknown-inference)，不是静默 any", () => {
    const e = resolvePublicType<string>([], joinUnion);
    expect(e).toEqual({ kind: "degraded", reason: DIAG.unknownInference });
  });

  it("复用现有诊断码：按来源分派，未新增码（决议 2）", () => {
    // `degradedOf` 的返回类型是 `Evidence<T>` 联合 ⇒ 直接读 `.reason` 在
    // 类型面不成立（只有 degraded 分支才有该字段）。这里整体比较结构：断言
    // 更强（码 + kind 一起钉），也不依赖窄化顺序。
    expect(degradedOf(DIAG.contractLoad)).toEqual({ kind: "degraded", reason: DIAG.contractLoad });
    expect(degradedOf(DIAG.internal)).toEqual({ kind: "degraded", reason: DIAG.internal });
    expect(degradedOf(DIAG.unknownInference)).toEqual({
      kind: "degraded",
      reason: DIAG.unknownInference,
    });
  });
});

describe("Evidence · 发布门与公开名边界", () => {
  it("申报过契约 + degraded ⇒ 阻断并返回可上屏的码（BUG-021，按语义不按码表）", () => {
    expect(publishBlockedBy(degradedOf(DIAG.contractLoad), true)).toBe(DIAG.contractLoad);
    expect(publishBlockedBy(degradedOf(DIAG.internal), false)).toBeUndefined();
    expect(publishBlockedBy(observedOf("number"), true)).toBeUndefined();
    expect(publishBlockedBy(declaredOf("number", "annotation"), true)).toBeUndefined();
  });

  it("内部求值占位名不得成为公共键（BUG-030）", () => {
    expect(isPlaceholder("_p0")).toBe(true);
    expect(isPlaceholder("_p0_1")).toBe(true);
    expect(isPlaceholder("card")).toBe(false);
    expect(() => publicName("_p0")).toThrow(/internal placeholder/);
    expect(publicName("card")).toBe("card");
  });

  it("ModuleForm 一等容纳 CJS export =（BUG-008）", () => {
    const forms: ModuleForm[] = [
      { kind: "esm" },
      { kind: "cjs", exportEquals: null },
    ];
    expect(forms.map((f) => f.kind)).toEqual(["esm", "cjs"]);
  });
});
