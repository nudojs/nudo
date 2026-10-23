/**
 * Bug 512 —— 生成的守卫 `.ts` **过不了 `tsc --noEmit --strict`**（TS7006
 * 隐式 any）⇒ 产物在 strict 工程里不可用。
 *
 * 根因：`guard-generator.ts` 的守卫签名**没有任何类型标注**
 * （`export function isXOutput(data) { … }`），而产物后缀是 `.ts`
 * （被工具链当 TypeScript 处理）⇒ strict 下 `data` 是隐式 any ⇒ TS7006。
 *
 * 修法：守卫签名补标注 —— 入参 `value: unknown`（守卫接受任意值，这是
 * 「类型守卫」的语义）、返回 `boolean`；体内用一个**按 Abs 形态选出的
 * 最窄类型**承接被检查值（`const data = value as <T>`）：
 * - prim / lit → 该原始类型（精确；也让 `data > 5` 这类关系谓词可编译）；
 * - 结构形态 → `Record<string, any>`（守卫读嵌套成员，槽位静态类型未跟踪）；
 * - sum → 各成员类型的并集。
 *
 * 本文件钉住：① 产物**真的**能过 `tsc --noEmit --strict`（真跑 tsc）；
 * ② 守卫的**运行时语义不变**（负控制）；③ 只用 TS 内建类型名（不引用
 * 用户类名 ⇒ 不会 TS2304）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abs, num, obj, str, type Abs } from "@nudojs/core";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const arrOf = (element: Abs): Abs => abs({ k: "arr", element }, undefined, undefined, "exact");
const unionOf = (...members: Abs[]): Abs => abs({ k: "sum", members }, undefined, undefined, "exact");
const numLit = (v: number): Abs => abs({ k: "prim", type: "number" }, { op: "lit", value: v }, undefined, "exact");
const brandOf = (name: string): Abs =>
  abs({ k: "brand", name, shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") }, undefined, undefined, "exact");

/** 真跑 tsc --noEmit --strict（产物必须过 strict 门） */
function tscStrict(source: string): { ok: boolean; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-guard-strict-"));
  dirs.push(dir);
  const p = join(dir, "guard.nudo.guard.ts");
  writeFileSync(p, source.endsWith("\n") ? source : source + "\n", "utf-8");
  try {
    execFileSync("pnpm", ["exec", "tsc", "--noEmit", "--strict", "--skipLibCheck", "--ignoreConfig", p], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, stderr: `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}` };
  }
}

describe("Bug 512 — 守卫产物必须过 tsc --noEmit --strict", () => {
  it("守卫签名带类型标注（入参 unknown / 返回 boolean）", () => {
    const g = generateGuardFunctionFromAbs("isStr", str());
    expect(g).toContain("export function isStr(value: unknown): boolean {");
    expect(g).not.toMatch(/export function isStr\(value\)/);
  });

  it(
    "各类形态的守卫产物写进同一模块也能过 strict 编译",
    () => {
      const shapes: Array<[string, Abs]> = [
        ["primString", str()],
        ["primNumber", num()],
        ["litNumber", numLit(42)],
        ["obj", obj({ name: { value: str() }, age: { value: num() } })],
        ["arr", arrOf(str())],
        ["union", unionOf(str(), num())],
        ["nestedObj", obj({ inner: { value: obj({ k: { value: num() } }) } })],
        ["brand", brandOf("Counter")],
      ];
      const src = shapes.map(([label, a]) => generateGuardFunctionFromAbs(`is${label}`, a)).join("\n\n");
      const check = tscStrict(src);
      expect(check.ok, check.stderr).toBe(true);
    },
    120_000,
  );

  it("负控制：守卫的运行时语义不变（谓词文本原样）", () => {
    expect(generateGuardFunctionFromAbs("isString", str())).toContain('typeof data === "string"');
    expect(generateGuardFunctionFromAbs("isNum", num())).toContain('typeof data === "number"');
    expect(generateGuardFunctionFromAbs("isUser", obj({ name: { value: str() } }))).toContain("data.name");
    expect(generateGuardFunctionFromAbs("isArr", arrOf(str()))).toContain("Array.isArray(data)");
    expect(generateGuardFunctionFromAbs("is42", numLit(42))).toContain("data === 42");
  });

  it("负控制：守卫产物不引用用户类名（不会 TS2304）", () => {
    const g = generateGuardFunctionFromAbs("isUser", brandOf("Counter"));
    // 口径更新（族 09 / Bug 407 —— 「brand 身份必须被投影」）：brand 的身份
    // 判定落进产物 ⇒ 品牌名以**字符串字面量**出现（`Reflect.get(globalThis,
    // "Counter")`），不再是「完全不出现」。但**裸标识符**（`instanceof
    // Counter`）仍然禁止 —— 那才是 TS2304 的来源。断言改为「剥掉字符串
    // 字面量后不得出现用户类名」⇒ 原口径的**不变量**不变（且更贴近它要防的
    // 东西）；真正的 strict 编译门在本文件上方那条用例里（brand 形态也在其中）。
    const withoutStringLiterals = g.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    expect(withoutStringLiterals).not.toContain("Counter");
    expect(g).toContain("as Record<string, any>");
  });
});
