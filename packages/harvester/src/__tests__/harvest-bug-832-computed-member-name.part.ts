/**
 * Bug 832 回归（harvester 收割面）：接口的**计算成员名**（`[Symbol.iterator]()`）
 * **整条丢弃** ⇒ 接口的**迭代协议整体丢失** ⇒ `for…of` 被判「对不可迭代值迭代」
 * ⇒ L2 假红（而 `tsc --strict` 对同一份代码 exit 0）。
 *
 * 根因：成员收集只处理**具名**成员（`memberName` 对计算属性名返回 undefined ⇒
 * `continue`），且没有任何诊断说「这条成员被丢了」。计算成员名是 **ES 规范的一等公民**
 * ——`[Symbol.iterator]` 是迭代协议的标准入口，丢弃它等于丢掉整个迭代协议。
 *
 * 改前（tmp/probe/fix-r27/h3/probe-h3b.ts，BEFORE 行）：brand Range 槽位 = { size }
 * 改后：brand Range 槽位 = { size, "@@iterator" }（引擎把 symbol 键投影成 `@@name`）
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h3/oracle/o832.ts）：exit=0
 *   ⇒ `for (const v of range)` 在 TS 侧完全合法。
 *
 * 产品面（`nudo check`，tmp/probe/fix-r27/h3/e2e/iter/）：
 *   改前 `drain() => number | string  throws TypeError`（L2 假红）
 *   改后 `drain() => number | string`（无 throws）
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Abs } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug832-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** brand → inner obj → 槽位（值） */
function slots(a: Abs): Record<string, Abs> {
  const s = a.shape;
  if (s.k === "obj") {
    const out: Record<string, Abs> = {};
    for (const [k, slot] of Object.entries(s.slots)) out[k] = slot.value;
    return out;
  }
  if (s.k === "brand") return slots(s.shape);
  return {};
}

const ITER = `export interface Range { [Symbol.iterator](): Iterator<number>; size: number; }
export declare const range: Range;
`;

describe("Bug 832 —— 计算成员名（[Symbol.iterator]）不得整条丢弃", () => {
  it("迭代协议成员进入实例模型（@@iterator 槽存在且可调用）", () => {
    const p = writeTemp("iter.d.ts", ITER);
    const env = harvestDts([p]);
    const s = slots(env.globals.range!);
    expect(Object.keys(s)).toContain("@@iterator");
    expect(s["@@iterator"]!.shape.k).toBe("fn");
  });

  it("具名成员不受影响（对照组：只有计算成员名被丢）", () => {
    const p = writeTemp("iter.d.ts", ITER);
    const env = harvestDts([p]);
    expect(Object.keys(slots(env.globals.range!))).toContain("size");
  });

  it("异步迭代协议同样保留（@@asyncIterator）", () => {
    const p = writeTemp(
      "asynciter.d.ts",
      `export interface ARange { [Symbol.asyncIterator](): AsyncIterator<number>; size: number; }
export declare const arange: ARange;
`,
    );
    const env = harvestDts([p]);
    expect(Object.keys(slots(env.globals.arange!))).toContain("@@asyncIterator");
  });

  it("不可静态判定的计算成员名被跳过（不产出错误成员名，也不崩）", () => {
    const p = writeTemp(
      "dyn.d.ts",
      `export interface Dyn { [key]: number; size: number; }
export declare const dyn: Dyn;
`,
    );
    const env = harvestDts([p]);
    const names = Object.keys(slots(env.globals.dyn!));
    expect(names).toContain("size");
    expect(names).not.toContain("key");
  });

  it("计算成员名不影响具名成员的类型（不被覆盖成 unknown）", () => {
    const p = writeTemp("iter.d.ts", ITER);
    const env = harvestDts([p]);
    const s = slots(env.globals.range!);
    expect(s.size!.shape.k).toBe("prim");
    expect(s.size!.shape.k === "prim" ? s.size!.shape.type : "").toBe("number");
  });
});
