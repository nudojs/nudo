/**
 * Bug 540 — 侧车发射把 **CRLF** 侧车写成**混合行尾**（`file(1)` 报
 * “with CRLF, LF line terminators”）→ 手写段保持 CRLF、新追加的 `@generated`
 * 段是**裸 LF**。
 *
 * 根因：基底用 `src.slice` 原样保留（CRLF 不变），生成段由
 * `normalizeSection` / `joinSections` 用**硬编码的 "\n"** 拼出来（永远 LF），
 * 最后 `writeFileSync` 不做行尾归一 ⇒ 追加即引入混排。
 *
 * 本文件钉住写盘端的**字节保真**（三种源文件都要过）：
 * ① CRLF 侧车 → 发射后仍是纯 CRLF；② UTF-8 BOM 侧车 → BOM 保留（且零改动
 * 不判「有改动」）；③ 末尾无换行的侧车 → 发射后仍可装载且幂等。
 * 负控制：LF 侧车的行为不变。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitInterface } from "../interface-emitter.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-540-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// BUG-035：`@nudo:case` 的**纯点观测见证**（实参全是字面量、无断言）不是契约
// 产物 ⇒ 夹具的 case 改为**带断言的域声明**（`=> 期望值`），契约内容
// （`fn({ x: lit(1) }, lit(2))`）与字节保真语义不变。
const SRC = `/**
 * @nudo:case "c" (1) => 2
 */
export function h(x) { return x + 1; }
`;

const HANDWRITTEN_LF = `import { fn, number } from "@nudojs/core";\n\nexport const other = fn({ x: number() }, number());\n`;
const HANDWRITTEN_CRLF = HANDWRITTEN_LF.replace(/\n/g, "\r\n");

const countEols = (s: string): { crlf: number; lf: number } => ({
  crlf: (s.match(/\r\n/g) ?? []).length,
  lf: (s.match(/(?<!\r)\n/g) ?? []).length,
});

describe("Bug 540 — 侧车写盘的字节保真（行尾 / BOM / 末尾换行）", () => {
  it("keeps a CRLF sidecar pure CRLF (no mixed line terminators)", async () => {
    const file = join(dir, "h.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "h.nudo.js");
    writeFileSync(sidecar, HANDWRITTEN_CRLF);

    const r = await emitInterface(file, { fnNames: ["h"], mode: "update" });
    expect(r.written).toEqual(["h"]);
    const after = readFileSync(sidecar, "utf-8");
    const eols = countEols(after);
    // 生成段也必须是 CRLF（裸 LF 会让 file(1) 报 "CRLF, LF"）
    expect(eols.lf).toBe(0);
    expect(eols.crlf).toBeGreaterThan(0);
    expect(after).toContain("export const h = fn({ x: lit(1) }, lit(2));");
  });

  it("keeps a UTF-8 BOM sidecar's BOM and reports no change on a no-op emit", async () => {
    const file = join(dir, "h.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "h.nudo.js");
    const bom = "\uFEFF";
    writeFileSync(sidecar, bom + HANDWRITTEN_LF);

    // 零契约变化的 emit 不得判「有改动」（BOM 被吃掉 ⇒ 假 diff）
    const noop = await emitInterface(file, { fnNames: ["other"], mode: "update" });
    expect(noop.changed).toBe(false);
    expect(readFileSync(sidecar, "utf-8").startsWith(bom)).toBe(true);

    const r = await emitInterface(file, { fnNames: ["h"], mode: "update" });
    expect(r.changed).toBe(true);
    const after = readFileSync(sidecar, "utf-8");
    expect(after.startsWith(bom)).toBe(true);
    expect(countEols(after).lf).toBeGreaterThan(0);
  });

  it("handles a sidecar without a trailing newline (idempotent, still loadable)", async () => {
    const file = join(dir, "h.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "h.nudo.js");
    writeFileSync(sidecar, HANDWRITTEN_LF.replace(/\n$/, ""));

    const first = await emitInterface(file, { fnNames: ["h"], mode: "update" });
    expect(first.changed).toBe(true);
    const after = readFileSync(sidecar, "utf-8");
    expect(after).toContain("export const h = fn({ x: lit(1) }, lit(2));");
    // 写两次 ⇒ 第二次必须报「无改动」且不写盘
    const second = await emitInterface(file, { fnNames: ["h"], mode: "update" });
    expect(second.changed).toBe(false);
    expect(readFileSync(sidecar, "utf-8")).toBe(after);
  });

  it("negative control: an LF sidecar keeps LF (no CRLF introduced)", async () => {
    const file = join(dir, "h.js");
    writeFileSync(file, SRC);
    const sidecar = join(dir, "h.nudo.js");
    writeFileSync(sidecar, HANDWRITTEN_LF);
    await emitInterface(file, { fnNames: ["h"], mode: "update" });
    const after = readFileSync(sidecar, "utf-8");
    const eols = countEols(after);
    expect(eols.crlf).toBe(0);
    expect(eols.lf).toBeGreaterThan(0);
  });
});
