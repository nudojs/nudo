/**
 * BUG-135 —— `nudo:unproven-return` 的 review quickfix **标题声称「放宽到
 * 推断面」而落盘的是基类型**（`number()`）⇒ 标题说谎 + 诊断不消。
 *
 * 夹具（`tmp/repro/bug-135/` 逐字）：
 *
 * ```js
 * // g.nudo.js
 * export const g = fn({}, number().gt(40));
 * // g.js
 * export function g(o) { return o.x; }
 * ```
 *
 * 推断面（诊断的 `actual`）= `any  #path`；旧实现走 `relaxSidecarConstraint`
 * ⇒ 只**剥数值谓词** ⇒ 落盘 `number()`（基类型）——既不是推断面，也消不掉
 * 诊断（`any ⊭ number()`）⇒ 用户点完「修复」diff 出来了、诊断一条不少。
 *
 * 同一条承诺在 CLI 机器面（`nudo check --json` 的 `actions[].label`，
 * core `actionsForIssue`）里逐字重复 ⇒ 两个面同源地说谎（BUG-135 的第二面）。
 *
 * 修复后钉：
 * 1. 落盘 = **推断面**（`any()`），不是基类型；
 * 2. 落盘后 `nudo:unproven-return` **消失**（动作可执行）；
 * 3. 证据面：旧落盘（`number()`）诊断原样保留 ⇒ 「写基类型」确实是假修复；
 * 4. 写不出忠实推断面（obj 返回）⇒ **不下发**（不承诺做不到的事）；
 * 5. CLI 机器面与 LSP 标题是**同一条（现在为真的）承诺**。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { defaultLoadModule } from "@nudojs/service";
import { actionsForIssue } from "@nudojs/core";
import { checkToLspDiagnostics } from "../validation.ts";
import {
  applyEdits,
  codeActionParams,
  mountCodeActions,
  sidecarEdits,
  type CodeActionEntry,
} from "./lsp-bug-r90a-harness.ts";
import { withTempDir } from "./helpers.ts";

/** BUG-135 夹具：返回 `o.x`（`any`）⊭ 返回槽 `number().gt(40)` */
const G_JS = `export function g(o) {
  return o.x;
}
`;
const G_SC = `import { fn, number } from "@nudojs/core";

export const g = fn({}, number().gt(40));
`;

/** 对照夹具：返回 obj 形状 ⇒ 推断面不可投影（写不出忠实的推断面） */
const OBJ_JS = `export function g(o) {
  return { a: o.x };
}
`;

type Diag = {
  code: string;
  message: string;
  range: { start: { line: number; character: number } };
  data?: { fn?: string; expected?: string; actual?: string };
};

const isUnprovenReturn = (d: { code?: unknown; message: string }): boolean =>
  d.code === "nudo:unproven-return" || /⊭ sidecar fn\(\) return slot/.test(d.message);

const isRelax = (a: CodeActionEntry): boolean => /Relax return contract/i.test(a.title);

/** 在临时目录里落 js + 侧车、取目标诊断、请求 code action */
function actionsFor(
  prefix: string,
  js: string,
  sc: string,
): { actions: CodeActionEntry[]; diags: Diag[]; scText: string; uri: string; sidecarPath: string } {
  return withTempDir(prefix, (dir) => {
    const jsPath = join(dir, "g.js");
    const sidecarPath = join(dir, "g.nudo.js");
    writeFileSync(jsPath, js, "utf-8");
    writeFileSync(sidecarPath, sc, "utf-8");
    const uri = `file://${jsPath}`;
    const all = checkToLspDiagnostics(jsPath, js, defaultLoadModule) as Diag[];
    const target = all.filter(isUnprovenReturn);
    expect(
      target.length,
      `夹具必须产出 nudo:unproven-return：${all.map((d) => d.code).join(", ")}`,
    ).toBeGreaterThan(0);
    const handler = mountCodeActions(uri, js);
    const actions: CodeActionEntry[] = [];
    for (const d of target) {
      actions.push(...handler(codeActionParams(uri, d.range.start.line, [d])));
    }
    return { actions, diags: target, scText: sc, uri, sidecarPath };
  });
}

/** 把侧车文本落盘后重跑 check，返回目标 fn 的 unproven-return 诊断 */
function unprovenAfter(dir: string, js: string, landedSidecar: string): Diag[] {
  const jsPath = join(dir, "g.js");
  writeFileSync(join(dir, "g.nudo.js"), landedSidecar, "utf-8");
  const all = checkToLspDiagnostics(jsPath, js, defaultLoadModule) as Diag[];
  return all.filter(isUnprovenReturn);
}

describe("Bug 135 · unproven-return 的 relax 必须真的写到推断面", () => {
  it("落盘 = 推断面（any()），不是基类型（number()）；且诊断消失", () => {
    const { actions, diags, scText, uri } = actionsFor("nudo-lsp-135a-", G_JS, G_SC);
    // 诊断面先钉住：推断面是 any（不是 number）
    expect(diags[0]!.data?.actual ?? "").toContain("any");
    expect(diags[0]!.data?.expected).toBe("number().gt(40)");

    const relax = actions.filter(isRelax);
    expect(relax, "unproven-return 必须给出 relax 动作").toHaveLength(1);
    // 标题承诺（service 产）与 CLI 机器面同源——修好后这句是真的
    expect(relax[0]!.title).toContain("inferred surface");

    const edits = sidecarEdits(relax, uri);
    expect(edits).toHaveLength(1);
    const landed = applyEdits(scText, edits);

    // 1. 落盘 = 推断面 `any()`（改前 = `number()`，基类型）
    expect(landed).toContain("fn({}, any())");
    expect(landed).not.toContain("number().gt(40)");
    expect(landed, "不得落盘基类型 number()（那既不是推断面、也消不掉诊断）").not.toMatch(
      /fn\(\{\}, number\(\)\)/,
    );

    // 2. 可执行：落盘后目标诊断消失
    withTempDir("nudo-lsp-135a-recheck-", (dir) => {
      expect(unprovenAfter(dir, G_JS, landed)).toHaveLength(0);
      // 3. 证据面：旧落盘（剥数值谓词 ⇒ number()）诊断原样还在
      expect(unprovenAfter(dir, G_JS, G_SC.replace("number().gt(40)", "number()"))).toHaveLength(1);
    });
  });

  it("正控制：推断面基类型（number）⇒ 落盘 number() 且诊断消失（门不是一刀切）", () => {
    // 推断面 = `number`（`x * 2` 的 conf=partial）⇒ 可写的是它的**基类型**
    // （bug 报告允许的「推断面基类型」），落盘后诊断消失。
    const js = `export function g(x) {
  return x * 2;
}
`;
    const { actions, diags, scText, uri } = actionsFor("nudo-lsp-135c-", js, G_SC);
    expect(diags[0]!.data?.actual ?? "").toContain("number");
    const relax = actions.filter(isRelax);
    expect(relax).toHaveLength(1);
    const landed = applyEdits(scText, sidecarEdits(relax, uri));
    expect(landed).toContain("fn({}, number())");
    withTempDir("nudo-lsp-135c-recheck-", (dir) => {
      expect(unprovenAfter(dir, js, landed)).toHaveLength(0);
    });
  });

  it("推断面不可投影（obj 返回）⇒ 不下发（不承诺做不到的事）", () => {
    const { actions, diags, uri } = actionsFor("nudo-lsp-135b-", OBJ_JS, G_SC);
    // 推断面 = obj 形状（`{ a: any }`）⇒ `absToConstraint` 投影不出、也没有
    // 基类型可退 ⇒ 写不出忠实的推断面
    expect(diags[0]!.data?.actual ?? "").toContain("{ a: any }");
    expect(actions.filter(isRelax)).toHaveLength(0);
    expect(sidecarEdits(actions, uri)).toHaveLength(0);
  });

  it("CLI 机器面（actionsForIssue）与 LSP 标题是同一条（现在为真的）承诺", () => {
    const acts = actionsForIssue({
      code: "nudo:unproven-return",
      fn: "g",
      expected: "number().gt(40)",
    });
    const relax = acts.find((a) => a.kind === "relax")!;
    expect(relax.label).toContain("g");
    expect(relax.label).toContain("inferred surface");
    // hint = 被放宽的**原**契约（不是推断面）：用户看得到「放宽了什么」
    expect(relax.hint).toBe("number().gt(40)");
  });
});
