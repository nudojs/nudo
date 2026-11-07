/**
 * Bug 541 — `nudo contract --emit` 给 **`.ts` 源**写出的 `*.nudo.ts` 段
 * **不带 builder 声明** → 产物**过不了 tsc**（TS2304: Cannot find name
 * 'lit' / 'fn'），而同命令的 `--draft` 产物带 import。
 *
 * 根因：`sectionText` 只生成「`@generated` 头 + export 行」，假定侧车是
 * `.js`（builder 名由装载期**裸注入**兜住）。而 core 的 sidecar-path 规定
 * `.ts` 源的侧车是 **`.nudo.ts`** —— 一个会被 tsc 编译的 TypeScript 文件，
 * 没有裸注入这条后路 ⇒ 段里的 builder 名全是未声明标识符。
 *
 * 修法：`.nudo.ts` 侧车补**纯类型**声明
 * `declare const X: typeof import("@nudojs/core").<导出名>;`
 * —— 不是 `import`：① 侧车装载期只注入**表面名**（lit/and），import 里的
 * core 导出名（litC/andC）不在注入表 ⇒ 装载期报「not an injected builder」
 * 并把绑定置 undefined；② core 的 `lit` 导出是 **Term 构造器**（约束构建器
 * 叫 litC），直接 import 会让 tsc 报 TS2322。
 *
 * 负控制：`.js` 源的侧车**不加**任何声明（裸注入已够，加了是无谓 diff）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitInterface } from "../interface-emitter.ts";
import { execNudoModule } from "@nudojs/core";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-541-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const TS_SRC = `export function add(a, b) { return a + b; }
/**
 * @nudo:case "c" (1, 2) => 3
 */
export function sub(a, b) { return a - b; }
`;

const JS_SRC = `/**
 * @nudo:case "c" (1, 2) => 3
 */
export function sub(a, b) { return a - b; }
`;

describe("Bug 541 — .ts 侧车带 builder 类型声明（产物可过 tsc）", () => {
  it("declares the builders used by the generated section in a .nudo.ts sidecar", async () => {
    const file = join(dir, "lib.ts");
    writeFileSync(file, TS_SRC);
    const r = await emitInterface(file, { mode: "update", all: true });
    expect(r.written).toContain("sub");

    const sidecar = join(dir, "lib.nudo.ts");
    const after = readFileSync(sidecar, "utf-8");
    // 生成段用到的 builder 必须有类型声明（否则 tsc: TS2304）
    expect(after).toContain("declare const fn: typeof import(\"@nudojs/core\").fn;");
    // core 的 `lit` 导出是 Term 构造器 ⇒ 约束构建器是 litC
    expect(after).toContain("declare const lit: typeof import(\"@nudojs/core\").litC;");
    expect(after).toContain("export const sub = fn({ a: lit(1), b: lit(2) }, lit(-1));");
  });

  it("the .nudo.ts sidecar is idempotent (second emit reports no change)", async () => {
    const file = join(dir, "lib.ts");
    writeFileSync(file, TS_SRC);
    await emitInterface(file, { mode: "update", all: true });
    const sidecar = join(dir, "lib.nudo.ts");
    const after = readFileSync(sidecar, "utf-8");
    const second = await emitInterface(file, { mode: "update", all: true });
    expect(second.changed).toBe(false);
    expect(readFileSync(sidecar, "utf-8")).toBe(after);
  });

  it("negative control: a .js sidecar gets no builder declaration (bare injection suffices)", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, JS_SRC);
    const r = await emitInterface(file, { mode: "update", all: true });
    expect(r.written).toContain("sub");
    const sidecar = join(dir, "lib.nudo.js");
    const after = readFileSync(sidecar, "utf-8");
    expect(after).not.toContain("declare const");
    expect(after).not.toContain("from \"@nudojs/core\"");
    // 裸注入下侧车仍可装载（契约生效）
    const exports = execNudoModule(after);
    expect(Object.keys(exports)).toContain("sub");
  });
});
