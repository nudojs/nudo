/**
 * BUG-246：可选槽（`slot.optional`）必须吸收源值里的 `undefined`。
 *
 * TS 默认 `exactOptionalPropertyTypes: false` 下 `{ a?: string }` 的槽类型是
 * `string | undefined` ⇒ `{ a: undefined }` 合法。修前 `leqShape` 的 obj 分支
 * **只在源槽缺失时**看 `slot.optional`（`if (slot.optional) continue`），源槽
 * 存在但值可能 undefined 时直接拿槽值比目标槽值 ⇒ `undefined ⊭ string` 假红。
 *
 * 修复把可选性写成**一条对称规则**：目标槽 optional ⇔ 源侧「缺失 or undefined」
 * 可赋。这里逐条钉住矩阵，重点是对照组：必填目标槽**仍须判红**，且
 * `number | undefined` 不得被 optional `string` 槽放过（不能整体放宽）。
 */
import { describe, it, expect } from "vitest";
import { leqAbs } from "../leq.ts";
import { constraintToEntryAbs, derefConstraint, shape, string } from "../constraint.ts";
import { abs, absLit, num, type Abs } from "../abs.ts";
import { getSlot, makeSum } from "../objects.ts";
import { checkSource, pTrue } from "../index.ts";
import type { CheckIssue } from "../check-report.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

/** 结构化对象 Abs（测试侧最小构造）。 */
function obj(slots: Record<string, { value: Abs; optional?: boolean }>): Abs {
  return abs({ k: "obj", slots }, undefined, undefined, "exact");
}

/** 契约 builder → 参数入口 Abs（槽上带锚在 `o.a` 上的 typeof 谓词）。 */
function contract(b: unknown): Abs {
  return constraintToEntryAbs(derefConstraint(b as never), "o");
}

/** 取对象 Abs 的槽值（保留该槽自带的谓词/项）。 */
function slotValue(a: Abs, key: string): Abs {
  const s = a.shape;
  if (s.k !== "obj") throw new Error("expected obj abs");
  const slot = getSlot(s.slots, key);
  if (!slot) throw new Error(`missing slot ${key}`);
  return slot.value;
}

const OPTIONAL = contract(shape({ a: string().optional() }));
const REQUIRED = contract(shape({ a: string() }));
/** 契约槽自带的 string 形态（谓词锚在 `o.a` 上）——并集源的 string 臂用它。 */
const OPTIONAL_STRING = slotValue(OPTIONAL, "a");

const sourceWithA = (value: Abs, optional?: boolean): Abs =>
  obj({ a: { value, ...(optional ? { optional: true } : {}) } });

describe("BUG-246 可选槽吸收 undefined（对称规则）", () => {
  it("可选契约 + 源槽存在且为 undefined ⇒ 可赋", () => {
    expect(leqAbs(sourceWithA(absLit(undefined)), OPTIONAL).ok).toBe(true);
  });

  it("对照：必填契约 + 同一源 ⇒ 仍判红", () => {
    const r = leqAbs(sourceWithA(absLit(undefined)), REQUIRED);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/slot a:/);
  });

  it("可选契约 + 源值 string | undefined ⇒ 可赋（undefined 臂被吸收）", () => {
    const src = sourceWithA(makeSum(OPTIONAL_STRING, absLit(undefined)));
    expect(leqAbs(src, OPTIONAL).ok).toBe(true);
  });

  it("不得整体放宽：number | undefined ⊄ optional string", () => {
    const src = sourceWithA(makeSum(num(), absLit(undefined)));
    expect(leqAbs(src, OPTIONAL).ok).toBe(false);
  });

  it("null 不被可选槽吸收（strictNullChecks）", () => {
    expect(leqAbs(sourceWithA(absLit(null)), OPTIONAL).ok).toBe(false);
  });

  it("源槽标 optional 时：可赋给可选目标槽，不可赋给必填目标槽", () => {
    expect(leqAbs(sourceWithA(OPTIONAL_STRING, true), OPTIONAL).ok).toBe(true);
    const r = leqAbs(sourceWithA(OPTIONAL_STRING, true), REQUIRED);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/optional ⊭ required/);
  });

  it("源槽缺失：可选目标槽放行、必填目标槽判红（既有口径）", () => {
    expect(leqAbs(obj({}), OPTIONAL).ok).toBe(true);
    expect(leqAbs(obj({}), REQUIRED).ok).toBe(false);
  });

  it("非空值仍按谓词判定（可选槽不是无条件放行）", () => {
    expect(leqAbs(sourceWithA(OPTIONAL_STRING), OPTIONAL).ok).toBe(true);
    expect(leqAbs(sourceWithA(num()), OPTIONAL).ok).toBe(false);
  });

  it("undefined 只在槽内被吸收：`{ a: string } | undefined` ⊄ `{ a?: string }`", () => {
    // 整体可缺省 ≠ 某一槽可缺省——目标对象本身不可缺省。
    const optionalObj = constraintToEntryAbs(
      derefConstraint(shape({ a: string() }).optional() as never),
      "o",
    );
    expect(leqAbs(optionalObj, OPTIONAL).ok).toBe(false);
  });
});

// ── L1 契约门禁（`nudo check` 的判定面）────────────────────────────────────
// 同一事实在**两个面**都不得判红：`leqAbs`（代数原语）与 `checkShapeAgainstAbs`
// （L1 字面量实参通道，`nudo:constraint-violated` 的产生处）。这批用例走真实
// `checkSource` + 侧车 `fn()` 契约，即 `nudo check` 的同一代码路径（CLI 只是
// 把 issues 渲染成 exit code：error ⇒ 1，无 error ⇒ 0）。

const OPTIONAL_SIDECAR = `
import { fn, shape, string } from "@nudojs/core";
export const f = fn({ o: shape({ a: string().optional() }) });
`;
const REQUIRED_SIDECAR = `
import { fn, shape, string } from "@nudojs/core";
export const g = fn({ o: shape({ a: string() }) });
`;
const BODY = `export function PLACEHOLDER(o) { return o.a; }`;

function gate(sidecar: string, name: string, calls: string) {
  const opts = sidecarOpts(`${name}.nudo.js`, sidecar, `/t/${name}.js`);
  return checkSource(
    `/t/${name}.js`,
    `${BODY.replace("PLACEHOLDER", name)}\n${calls}\n`,
    pTrue,
    opts,
  );
}

function violations(r: { issues: CheckIssue[] }, fn: string): CheckIssue[] {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated" && i.fn === fn);
}

/** 签名面形参类型（`nudo check` 的 `o: { a?: string }` 就由它渲染）。 */
function paramTypesOf(
  r: { signatures: { name: string; paramTypes?: string[] }[] },
  fn: string,
): string[] {
  return r.signatures.find((s) => s.name === fn)?.paramTypes ?? [];
}

describe("BUG-246 L1 契约门禁与 leqAbs 同口径", () => {
  it("optional 契约 + `{ a: undefined }` / `{}` / `{ a: 'x' }` 全部放行", () => {
    const r = gate(OPTIONAL_SIDECAR, "f", `f({ a: undefined });\nf({ a: "x" });\nf({});`);
    expect(violations(r, "f")).toHaveLength(0);
    // 签名面同样是可选位（两面不得自相矛盾）
    expect(paramTypesOf(r, "f")).toEqual(["{ a?: string }"]);
  });

  it("required 契约 + `{ a: undefined }` 仍判红（对照）", () => {
    const r = gate(REQUIRED_SIDECAR, "g", `g({ a: undefined });`);
    const vs = violations(r, "g");
    expect(vs).toHaveLength(1);
    expect(vs[0]!.expected).toBe('typeof o.a = "string"');
  });

  it("required 契约 + `{ a: 'x' }` 放行（对照的正例）", () => {
    const r = gate(REQUIRED_SIDECAR, "g", `g({ a: "x" });`);
    expect(violations(r, "g")).toHaveLength(0);
  });

  it("optional 契约不吸收 null / 错 prim（不整体放宽）", () => {
    expect(violations(gate(OPTIONAL_SIDECAR, "f", `f({ a: null });`), "f")).toHaveLength(1);
    expect(violations(gate(OPTIONAL_SIDECAR, "f", `f({ a: 1 });`), "f")).toHaveLength(1);
  });
});

// ── `@nudo:case` 见证面（第三个面）──────────────────────────────────────────
// `check-case-scan.ts` 的 `witnessViolations` 有自己的一套字段对账，同样要吸收
// undefined（共享同一 helper），否则同一个 `{ a: undefined }` 在 `nudo check`
// 放行、在 `nudo test` / case 见证面报 `nudo:case-inconsistency`。

function caseGate(sidecar: string, name: string, doc: string) {
  const opts = sidecarOpts(`${name}.nudo.js`, sidecar, `/t/${name}.js`);
  return checkSource(
    `/t/${name}.js`,
    `/**\n * ${doc}\n */\nexport function ${name}(o) { return o.a; }\n`,
    pTrue,
    opts,
  );
}

function caseInconsistency(r: { issues: CheckIssue[] }): CheckIssue[] {
  return r.issues.filter((i) => i.code === "nudo:case-inconsistency");
}

describe("BUG-246 `@nudo:case` 见证面与 leqAbs / L1 同口径", () => {
  it("optional 契约 + 见证 `{ a: undefined }` ⇒ 不报 case-inconsistency", () => {
    const r = caseGate(OPTIONAL_SIDECAR, "f", `@nudo:case "u" ({ a: undefined }) => undefined`);
    expect(caseInconsistency(r)).toHaveLength(0);
  });

  it("required 契约 + 同一见证 ⇒ 仍报 case-inconsistency（对照）", () => {
    const r = caseGate(REQUIRED_SIDECAR, "g", `@nudo:case "u" ({ a: undefined }) => undefined`);
    const vs = caseInconsistency(r);
    expect(vs).toHaveLength(1);
    expect(vs[0]!.fn).toBe("g");
  });

  it("optional 契约：见证 `{ a: 'x' }` 放行、`{ a: 1 }` / `{ a: null }` 仍报", () => {
    expect(
      caseInconsistency(caseGate(OPTIONAL_SIDECAR, "f", `@nudo:case "u" ({ a: "x" }) => "x"`)),
    ).toHaveLength(0);
    expect(
      caseInconsistency(caseGate(OPTIONAL_SIDECAR, "f", `@nudo:case "u" ({ a: 1 }) => 1`)),
    ).toHaveLength(1);
    expect(
      caseInconsistency(caseGate(OPTIONAL_SIDECAR, "f", `@nudo:case "u" ({ a: null }) => null`)),
    ).toHaveLength(1);
  });
});
