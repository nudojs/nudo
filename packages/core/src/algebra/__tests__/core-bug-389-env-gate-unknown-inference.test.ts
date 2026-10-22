/**
 * Bug 389 —— 一个**没生效**的 `@nudo:env` 指令会把唯一能提示「推断失败」的
 * `nudo:unknown-inference` **警告降级成 `nudo:opaque-result` 信息**。
 *
 * 根因：env 门禁（`generalize.ts` 的 `envGatedSource`）按**源码文本**判定
 * ⇒ env 名拼错时函数体 fail-closed ⇒ 符号面 `conf = opaque` ⇒ `check.ts` 的
 * `budgetExplained` 因 `conf === "opaque"` 成立 ⇒ **「推断失败」的警告被吞**，
 * 取而代之的是一条把它引向 `@nudo:case` 的 info（指错方向）。
 *
 * 修法（族 08 · AGENT-CONTEXT §4 裁决）：门禁的事实（`envGated`）要让诊断层
 * 看得见 ⇒ `budgetExplained` 不得把「因 env 门禁而 opaque」当作「已解释」，
 * 且那条 opaque-result info 对 env 门禁的函数不再发（正确信号是
 * `nudo:unknown-inference` warning）。
 *
 * 反向钉：HEAD（未修）上 env 门禁的函数只发 `nudo:opaque-result` ⇒ 本文件在
 * HEAD 上**必失败**。
 */
import { describe, it, expect } from "vitest";
import { checkSource, resetCheckSourceMemo } from "../check.ts";
import { pTrue } from "../pred.ts";
import { resetGeneralizeMemo } from "../generalize.ts";

const PLAIN = `export function toBuf(s){ return Buffer.from(s); }\n`;
const ENV_BOGUS = `/// @nudo:env bogus\nexport function toBuf(s){ return Buffer.from(s); }\n`;

function codesOf(src: string): string[] {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  // CLI 同口径：文件声明的 env 名 → envGlobals 注入；bogus 解析不出全局 ⇒ 空
  const r = checkSource("/t/toBuf.js", src, pTrue, { inject: { envGlobals: {} } });
  return r.issues.map((i) => i.code);
}

describe("Bug 389 env 门禁不得吞掉 unknown-inference", () => {
  it("env 名拼错（没解析出全局）⇒ 发 nudo:unknown-inference 警告", () => {
    const codes = codesOf(ENV_BOGUS);
    expect(codes).toContain("nudo:unknown-inference");
  });

  it("env 名拼错 ⇒ 不再发指错方向的 nudo:opaque-result 信息", () => {
    const codes = codesOf(ENV_BOGUS);
    expect(codes).not.toContain("nudo:opaque-result");
  });

  it("对照组：没有 env 指令 ⇒ 仍然是 unknown-inference 警告（口径不变）", () => {
    const codes = codesOf(PLAIN);
    expect(codes).toContain("nudo:unknown-inference");
    expect(codes).not.toContain("nudo:opaque-result");
  });
});
