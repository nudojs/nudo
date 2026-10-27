/**
 * BUG-044 —— `nudo export` 把 `@nudo:case` 的**调试见证**发布成类型 ⇒ 四个
 * 产物面一致地拒绝**实现允许**的调用，且与 `nudo check` 的签名相反。
 *
 * 症状：`/** @nudo:case "dom" (number()) *\/ export function f(x) { return x + 1; }`
 * ⇒ dts `f(x: number): number`、zod `z.number()`、guard `typeof data === "number"`
 * 全被那条调试见证污染；而 `nudo check` 的签名是 `f(x: any) => number | string`
 * （门禁面以 caseMode "none" 调分析器，**永不**产出指令见证）。
 *
 * 修法：export 面与门禁面同口径（caseMode "none"）—— 发布面**不**消费
 * `@nudo:case`（文档：Cases are debug witnesses … not the contract product）。
 *
 * 钉：有 / 无那条调试见证时，dts 与 zod 两个面的投影**逐字相同**，且与
 * `nudo check` 的签名同口径。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const BODY = "export function f(x) {\n  return x + 1;\n}\n";
const PLAIN = BODY;
const WITH_WITNESS = `/**\n * @nudo:case "dom" (number())\n */\n${BODY}`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b044-"));
  dirs.push(dir);
  writeFileSync(join(dir, "plain.js"), PLAIN, "utf-8");
  writeFileSync(join(dir, "lib.js"), WITH_WITNESS, "utf-8");
  return dir;
}

/** 声明的形参类型（`export declare function f(<这里>): …`）。 */
function dtsParamType(stdout: string): string {
  const m = /^export declare function f\(([^)]*)\)/m.exec(stdout);
  expect(m).not.toBeNull();
  return m![1]!;
}

describe("BUG-044 — `@nudo:case` 调试见证不进发布面", () => {
  it("dts 面：有调试见证与无证据的投影相同（形参是 any，不是 number）", () => {
    const dir = fixture();
    const plain = runCliTsx(["export", join(dir, "plain.js"), "--format", "dts"]);
    const withCase = runCliTsx(["export", join(dir, "lib.js"), "--format", "dts"]);
    expect(plain.status).toBe(0);
    expect(withCase.status).toBe(0);

    expect(dtsParamType(withCase.stdout)).toBe(dtsParamType(plain.stdout));
    expect(dtsParamType(withCase.stdout)).toContain("any");
    expect(dtsParamType(withCase.stdout)).not.toContain("number");
  }, 60000);

  it("zod / guard 面：放宽到 unknown（不再按那一次调试调用收窄）", () => {
    const dir = fixture();
    const plain = runCliTsx(["export", join(dir, "plain.js"), "--format", "all"]);
    const withCase = runCliTsx(["export", join(dir, "lib.js"), "--format", "all"]);
    expect(withCase.status).toBe(0);

    expect(withCase.stdout).toContain("export const fInput = z.object({ x: z.unknown() })");
    expect(withCase.stdout).not.toContain("x: z.number()");
    // 与无证据的同形源一致
    expect(withCase.stdout).toContain("export const fInput = z.object({ x: z.unknown() })");
    expect(plain.stdout).toContain("export const fInput = z.object({ x: z.unknown() })");
  }, 60000);

  it("与 nudo check 的签名同口径（发布面 = 门禁面）", () => {
    const dir = fixture();
    const check = runCliTsx(["check", join(dir, "lib.js")]);
    const dts = runCliTsx(["export", join(dir, "lib.js"), "--format", "dts"]);
    expect(dts.status).toBe(0);
    // check 签名行：f(x: any) => number | string
    expect(check.stdout).toContain("f(x: any)");
    expect(dtsParamType(dts.stdout)).toContain("any");
    expect(dts.stdout).toContain("number | string");
  }, 60000);
});
