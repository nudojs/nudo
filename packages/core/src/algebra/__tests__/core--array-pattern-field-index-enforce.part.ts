/**
 * 分册 03 · Bug 8 —— 数组解构形参的契约被投影成**对象槽** ⇒ 合法调用报
 * `missing field x`（假红），元素值从未与界比对（真违例也被误伤）。
 *
 * 根因：`locateContractParam` 对数组 pattern 只给 `fieldIndex`、不给
 * `fieldPath`；`scan-literal-calls.ts` 的 `contractToIndexed` 此前把「没有
 * `fieldPath`」退回 `[hit.field]`（对象槽路径）⇒ `projectAbsPath(数组,
 * ["x"])` 必然取不到。模型层产出的 `fieldIndex` 从没被读。
 *
 * 修法：把 `fieldIndex` 一路传到 `checkReqs` / `checkShapeReqs`，按 tuple
 * 元素下标投影（对象解构的 `fieldPath` 口径不变）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDE = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;
const IMP = `/// @nudo:import { positive } from "./std8.nudo.js"\n`;
const FILE = "/t/bug8.js";

const DECL = `${IMP}/** @nudo:contract x positive */
export function f([x]) { return x; }
`;

function check(body: string) {
  return checkSource(FILE, DECL + body, pTrue, sidecarOpts("std8", SIDE, FILE));
}

function violations(r: { issues: Array<{ code: string; expected?: string; actual?: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

describe("Bug 8 · 数组解构契约按元素下标执法", () => {
  it("f([5]) 合法 ⇒ 零违例（改前报 missing field x）", () => {
    const r = check(`export function ok() { return f([5]); }`);
    expect(violations(r)).toHaveLength(0);
    expect(r.issues.some((i) => (i.expected ?? "").includes("missing field"))).toBe(false);
  });

  it("f([-1]) 违例 ⇒ 报 x > 0，actual 是元素值 -1（不是整只数组）", () => {
    const r = check(`export function bad() { return f([-1]); }`);
    const v = violations(r);
    expect(v).toHaveLength(1);
    expect(v[0]!.expected).toBe("x > 0");
    expect(v[0]!.actual).toContain("-1");
  });

  it("不再出现 missing field x 文案", () => {
    const r = check(`export function ok() { return f([5]); }
export function bad() { return f([-1]); }`);
    expect(r.issues.some((i) => (i.expected ?? "").includes("missing field"))).toBe(false);
  });
});
