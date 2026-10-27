/**
 * BUG-134 —— 「放宽侧车契约」quickfix 对**基类型不匹配**（`string ⊭ number`）
 * 永远消不掉诊断 ⇒ 建议不可执行
 *
 * 现象：返回值基类型就与侧车返回槽冲突时，动作只会剥数值谓词
 * （`number().gt(40)` → `number()`）⇒ 诊断**一字未消**（`string ⊭ number`），
 * 用户点完「修复」diff 出来了、诊断一条不少。
 * 根因：`stripNumericPreds` 只剥数值谓词，没有「`number()` → `string()`」路径；
 * 动作只检查「有 diff」就下发，**没有**「落盘后目标诊断是否消失」的验证门。
 *
 * 钉（修复后行为）：
 * 1. 基类型冲突（不可解）⇒ **不下发**放宽动作（无 diff 可清诊断）；
 * 2. 证据面：旧动作的落盘结果（返回槽 → `number()`）诊断原样还在
 *    ⇒ 不下发是被诊断验证的，不是拍脑袋；
 * 3. 校准（正控制）：返回槽**数值**冲突可解时动作仍在、落盘后诊断消失
 *    ⇒ 门不是「一刀切封杀」，判据 = 编辑是否真的清掉目标诊断；
 * 4. 返回槽没有可放宽的数值精化（`number()`）⇒ 不下发（无 edit 空转）。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { defaultLoadModule } from "@nudojs/service";
import { checkToLspDiagnostics } from "../validation.ts";
import {
  applyEdits,
  codeActionParams,
  mountCodeActions,
  sidecarEdits,
  type CodeActionEntry,
} from "./lsp-bug-r90a-harness.ts";
import { withTempDir } from "./helpers.ts";

/** BUG-134 段内夹具（逐字）：返回 `u.name`（string）⊭ 返回槽 number().gt(40) */
const GREET_JS = `export function greet(u) {
  return u.name;
}
greet({ id: 2 });
`;
const SC_SHAPE = `import { fn, shape, string, number } from "@nudojs/core";

export const greet = fn({ u: shape({ name: string() }) }, number().gt(40));
`;

/** 返回槽放宽**可解**的对照：返回 42 只违反对数值下界 */
const GREET_JS_RET = `export function greet(u) {
  return 42;
}
greet(0);
`;
const SC_RET_NUM = `import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number() }, number().gt(80));
`;

const isReturnBaseDiag = (msg: string): boolean => /return value ⊭ sidecar/.test(msg);
const isRelax = (a: CodeActionEntry): boolean => /Relax sidecar contract/i.test(a.title);

function actionsFor(
  dirPrefix: string,
  js: string,
  sc: string,
  pick: (message: string) => boolean,
): { actions: CodeActionEntry[]; messages: string[]; scText: string; uri: string } {
  return withTempDir(dirPrefix, (dir) => {
    const jsPath = join(dir, "greet.js");
    writeFileSync(jsPath, js, "utf-8");
    writeFileSync(join(dir, "greet.nudo.js"), sc, "utf-8");
    const uri = `file://${jsPath}`;
    const diags = checkToLspDiagnostics(jsPath, js, defaultLoadModule);
    const target = diags.filter((d) => pick(d.message));
    expect(target.length).toBeGreaterThan(0);
    const handler = mountCodeActions(uri, js);
    const actions: CodeActionEntry[] = [];
    for (const d of target) {
      actions.push(...handler(codeActionParams(uri, d.range.start.line, [d])));
    }
    return { actions, messages: target.map((d) => d.message), scText: sc, uri };
  });
}

describe("Bug 134 · 放宽侧车契约不得下发消不掉诊断的假修复", () => {
  it("返回基类型冲突（string ⊭ number）⇒ 不下发放宽动作、不产生侧车编辑", () => {
    const { actions, messages, uri } = actionsFor(
      "nudo-lsp-134a-",
      GREET_JS,
      SC_SHAPE,
      isReturnBaseDiag,
    );
    expect(messages.join("\n")).toMatch(/typeof return = "string" ⊭ "number"/);
    // 旧实现下发「Relax sidecar contract for greet」⇒ 只剥 .gt(40) ⇒ 诊断还在
    expect(actions.filter(isRelax)).toHaveLength(0);
    expect(sidecarEdits(actions, uri)).toHaveLength(0);
  });

  it("证据面：旧动作的落盘结果（返回槽 → number()）诊断原样保留", () => {
    withTempDir("nudo-lsp-134b-", (dir) => {
      const jsPath = join(dir, "greet.js");
      writeFileSync(jsPath, GREET_JS, "utf-8");
      const weakened = SC_SHAPE.replace("number().gt(40)", "number()");
      writeFileSync(join(dir, "greet.nudo.js"), weakened, "utf-8");
      const after = checkToLspDiagnostics(jsPath, GREET_JS, defaultLoadModule);
      expect(after.filter((d) => isReturnBaseDiag(d.message))).toHaveLength(1);
      expect(after.map((d) => d.message).join("\n")).toMatch(
        /typeof return = "string" ⊭ "number"/,
      );
    });
  });

  it("返回槽没有可放宽的数值精化（number()）⇒ 不下发（无 edit 空转）", () => {
    const { actions, messages, uri } = actionsFor(
      "nudo-lsp-134c-",
      GREET_JS,
      SC_SHAPE.replace("number().gt(40)", "number()"),
      isReturnBaseDiag,
    );
    expect(messages.join("\n")).toMatch(/return slot \(number\(\)\)/);
    expect(actions.filter(isRelax)).toHaveLength(0);
    expect(sidecarEdits(actions, uri)).toHaveLength(0);
  });

  it("正控制：返回槽**数值**冲突可解时动作仍在，落盘后目标诊断消失", () => {
    const { actions, scText, uri } = actionsFor(
      "nudo-lsp-134d-",
      GREET_JS_RET,
      SC_RET_NUM,
      isReturnBaseDiag,
    );
    const relax = actions.filter(isRelax);
    expect(relax).toHaveLength(1);
    // 返回槽（不是形参）⇒ 标题不带 `.u`
    expect(relax[0]!.title).toBe("Relax sidecar contract for greet");
    const edits = sidecarEdits(relax, uri);
    expect(edits).toHaveLength(1);
    const landed = applyEdits(scText, edits);
    expect(landed).toBe(`import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number() }, number());
`);

    withTempDir("nudo-lsp-134d-recheck-", (dir) => {
      const jsPath = join(dir, "greet.js");
      writeFileSync(jsPath, GREET_JS_RET, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), landed, "utf-8");
      const after = checkToLspDiagnostics(jsPath, GREET_JS_RET, defaultLoadModule);
      expect(after.filter((d) => isReturnBaseDiag(d.message))).toHaveLength(0);
      expect(after).toHaveLength(0);
    });
  });
});
