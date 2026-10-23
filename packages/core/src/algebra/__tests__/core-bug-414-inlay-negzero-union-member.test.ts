/**
 * Bug 414 —— 返回 inlay 把 `-0` 渲染成 `0`，并因此**丢掉一个 union 成员**。
 *
 * 改前：`formatReturnDisplay` 的 `memberPath` 字面量分支**自写**了一套字面量
 * 文本（`JSON.stringify(lv)`）⇒ `JSON.stringify(-0) === "0"` 抹掉负零符号；
 * 去重键 `lit:${String(lv)}` 让 `-0` 臂与 `0` 臂**键相同** ⇒ `seen` 集合把
 * 其中一条**整个丢掉**：
 *
 *   negZero()   → : 0      （应为 : -0）
 *   zeroOrNeg() → : 0      （应为 : 0 | -0）
 *
 * 而 `nudo check` / `nudo test` 同一份源码给 `-0` / `0 | -0` ⇒ 面与面矛盾。
 *
 * 改后：字面量文本走仓库的**规范口径**（`term.ts` 的 `termToString` /
 * `litKeyString`，与 `format.ts` 的 `formatLitValue` 同口径），去重键与渲染
 * 文本**同源**（`lit:<typeof>:<litKeyString>`）⇒ `-0` 臂与 `0` 臂不再同键。
 */
import { describe, it, expect } from "vitest";
import { collectAbsInlays } from "../inlay.ts";

const NEG_ZERO_SRC = `export function negZero() {\n  return -0;\n}\n\nexport function zeroOrNeg(x) {\n  return x ? 0 : -0;\n}\n`;

/** label 形如 `: 0 | -0  · derived  ` ⇒ 取其中的展示文本 */
const displayOf = (label: string): string =>
  label
    .replace(/^:\s*/, "")
    .replace(/\s*·\s*derived\s*$/, "")
    .trim();

const displays = (src: string): string[] =>
  collectAbsInlays(src, { fromFile: "/t/a.js" })
    .filter((i) => i.kind === "type")
    .map((i) => displayOf(i.label));

describe("Bug 414：返回 inlay 的 `-0` 保真 + union 成员不被去重丢掉", () => {
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
