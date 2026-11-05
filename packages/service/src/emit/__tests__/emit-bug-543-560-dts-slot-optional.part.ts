/**
 * Bug 543 / Bug 560 —— dts 面的**对象槽可选性**渲染。
 *
 * 症状（旧口径 `k: T | undefined`）：
 * - TS 里 `{ id: number | undefined }` 是「**键必需**、值可为 undefined」；
 *   「键可省略」只有 `k?: T` 能表达 ⇒ 投影比契约 / zod / standard / check
 *   四个面都**严**（one-way 投影不得更严 ⇒ 方向反了）。
 * - 消费方按契约/zod 放行的值（缺可选键）在 `.d.ts` 下吃 TS2345 / TS2741。
 * - 同一份产物内部口径相反：顶层形参用 `?`，嵌套字段不用。
 *
 * 修法：`absToTSType` 的 obj 分支把 optional 槽渲染成 `k?: T`。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { abs, num, str, type Abs } from "@nudojs/core";
import { absToTSType } from "../dts-generator.ts";
import { tmpProject } from "../../__tests__/tmp-project.ts";

const objOf = (slots: Record<string, { value: Abs; optional?: boolean }>): Abs =>
  abs({ k: "obj", slots }, undefined, undefined, "exact");

/** tsc --noEmit --strict 实测（产物面必须真能编译） */
function tscNoEmit(files: Record<string, string>): { ok: boolean; stderr: string } {
  const dir = tmpProject("nudo-dts-slot-opt-");
  const paths: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    writeFileSync(p, content.endsWith("\n") ? content : content + "\n", "utf-8");
    paths.push(p);
  }
  try {
    execFileSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "--strict", "--skipLibCheck", "--ignoreConfig", ...paths],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, stderr: `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}` };
  }
}

describe("Bug 543 / 560 —— dts 槽位可选性", () => {
  it("optional 槽渲染成 TS 可选属性 `k?: T`（不再是 `k: T | undefined`）", () => {
    const ts = absToTSType(objOf({ a: { value: num(), optional: true }, b: { value: str() } }));
    expect(ts).toBe("{ a?: number; b: string }");
    expect(ts).not.toContain("| undefined");
  });

  it("负控制：必填槽仍是必填（不误伤 `k: T`）", () => {
    const ts = absToTSType(objOf({ a: { value: num() } }));
    expect(ts).toBe("{ a: number }");
  });

  it("两层嵌套的 optional 槽同样带 `?`（任意深度成立）", () => {
    const inner = objOf({ b: { value: num(), optional: true } });
    const ts = absToTSType(objOf({ a: { value: inner } }));
    expect(ts).toBe("{ a: { b?: number } }");
  });

  it("消费方省略可选键不再吃 TS2345 / TS2741（改前：键被声明为必需）", () => {
    const dts = "export declare function f(o: { id?: number }): number;\n";
    const check = tscNoEmit({
      "mod.d.ts": dts,
      // 契约 / zod / standard / check 四个面都放行 `{ o: {} }`
      "use.ts": 'import { f } from "./mod.js";\nexport const r = f({});\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("负控制：必填键缺失仍报 TS2345（可选性投影不得放宽必填键）", () => {
    const dts = "export declare function f(o: { id: number }): number;\n";
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import { f } from "./mod.js";\nexport const r = f({});\n',
    });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2345");
  });
});
