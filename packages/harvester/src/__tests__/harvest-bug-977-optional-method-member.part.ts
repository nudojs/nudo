/**
 * Bug 977 回归（harvester 收割面）：可选**方法**成员的 `?` 丢失（同函数里的可选
 * **属性**却保住了）⇒ 成员被断言成「**必定存在**」⇒ `nudo check` 放行，
 * `tsc --strict` 报 **TS2722**（**假绿**）。
 *
 * 根因：`.d.ts` 的可选性标记挂在**成员节点**上（`member.questionToken`），属性与
 * 方法都是如此；harvester 的**属性**分支读了它、**方法**分支没读 ⇒ `m?(): void`
 * 的可省性被静默丢掉 ⇒ 收割出的形状把「可能不存在的方法」断言成「必定存在」。
 *
 * 改前（tmp/probe/fix-r27/h3/probe-h3b.ts，BEFORE 行）：
 *   brand Holder 槽位 m = () => undefined      ← 没有任何 optional 标记
 * 改后：
 *   brand Holder 槽位 m = (() => undefined) | undefined
 *   （与同接口的可选属性 p = number | undefined 同口径）
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h3/oracle/o977.ts）：
 *   `i.m()` ⇒ TS2722 "Cannot invoke an object which is possibly 'undefined'"
 *   ⇒ TS 侧 m 确实「可能不存在」⇒ 收割面不得断言它必定存在。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, type Abs } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug977-"));
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

/** 类型里是否含 undefined（可省性的建模口径） */
function hasUndefined(a: Abs | undefined): boolean {
  if (!a) return false;
  if (a.term?.op === "lit" && a.term.value === undefined) return true;
  const s = a.shape;
  if (s.k === "sum") return s.members.some(hasUndefined);
  return false;
}

// BUG-253：成员提升只对**模块作用域**成立（顶层值位置声明不得泄漏成全局）
const HOLDER = `declare module "holder" {
  export interface Holder { m?(): void; p?: number; q(): string; }
  export declare const h: Holder;
}
`;

describe("Bug 977 —— 可选方法成员与可选属性同口径", () => {
  it("可选方法的槽位含 undefined（可能不存在，不是必定存在）", () => {
    const p = writeTemp("holder.d.ts", HOLDER);
    const env = harvestDts([p]);
    const s = slots(env.modules.holder!.h!);
    expect(s.m).toBeDefined();
    expect(hasUndefined(s.m!)).toBe(true);
  });

  it("可选方法与可选属性的可省性口径一致（两者都含 undefined）", () => {
    const p = writeTemp("holder.d.ts", HOLDER);
    const env = harvestDts([p]);
    const s = slots(env.modules.holder!.h!);
    expect(hasUndefined(s.m!)).toBe(hasUndefined(s.p!));
    expect(formatShape(s.p!)).toBe("number | undefined");
  });

  it("必选方法不被加上 undefined", () => {
    const p = writeTemp("holder.d.ts", HOLDER);
    const env = harvestDts([p]);
    const s = slots(env.modules.holder!.h!);
    expect(hasUndefined(s.q!)).toBe(false);
    expect(s.q!.shape.k).toBe("fn");
  });

  it("提升面同口径（可选方法提升出的模块成员也含 undefined）", () => {
    const p = writeTemp("holder.d.ts", HOLDER);
    const env = harvestDts([p]);
    const promoted = env.modules.holder!.m!;
    expect(promoted).toBeDefined();
    expect(hasUndefined(promoted)).toBe(true);
  });

  it("对照：内联类型字面量的可选方法同口径（第二条成员收集路径）", () => {
    const p = writeTemp(
      "inline.d.ts",
      `export declare const inline: { m?(): void; p?: number };
`,
    );
    const env = harvestDts([p]);
    const s = slots(env.globals.inline!);
    expect(hasUndefined(s.m!)).toBe(true);
    expect(hasUndefined(s.p!)).toBe(true);
  });
});
