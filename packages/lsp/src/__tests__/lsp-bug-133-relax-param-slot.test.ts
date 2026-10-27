/**
 * BUG-133 —— 「放宽侧车契约」quickfix 对**参数违例**打到**返回槽**
 *
 * 现象：诊断是 `argument ⊭ precondition`（参数违例），动作却把侧车的**返回槽**
 * 改掉（`number().gt(40)` → `number()`）⇒ 参数诊断原样保留、返回契约被静默削弱。
 * 根因：`loosen` 正则不匹配诊断文案 ⇒ `param === undefined` ⇒ 替换器落到
 * `tryReturnSlot`；且动作**没有**「落盘后诊断是否消失」的验证门。
 *
 * 钉（修复后行为）：
 * 1. 参数违例的放宽动作只能改**被违反形参**的槽：标题带 `greet.u`、
 *    编辑只剥 `u` 的数值谓词，返回槽的 `.gt(40)` 原样保留；
 * 2. 落盘后目标参数诊断**真的消失**（动作可执行，不是假修复）；
 * 3. 改不动参数槽时（shape 参数）**不下发**放宽动作 —— 尤其不得退化成
 *    「改返回槽」（旧症状：参数诊断仍在 + 返回契约被削弱）；
 * 4. 证据面：旧的那份返回槽编辑（`.gt(40)` → `number()`）对参数诊断
 *    一字无效 ⇒ 不下发是被诊断验证的，不是拍脑袋。
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

/** BUG-133 段内夹具（逐字） */
const GREET_JS = `export function greet(u) {
  return u.name;
}
greet({ id: 2 });
`;
const SC_SHAPE = `import { fn, shape, string, number } from "@nudojs/core";

export const greet = fn({ u: shape({ name: string() }) }, number().gt(40));
`;

/** 参数槽可放宽的对照：同一诊断形态，但形参是数值谓词 */
const GREET_JS_NUM = `export function greet(u) {
  return 42;
}
greet(-1);
`;
const SC_NUM = `import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number().gt(0) }, number());
`;
/** 参数槽可放宽 + 返回槽带数值谓词（旧实现会误伤的那一份） */
const SC_NUM_RET = `import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number().gt(0) }, number().gt(40));
`;

const isParamDiag = (msg: string): boolean => /argument ⊭ precondition/.test(msg);
const isRelax = (a: CodeActionEntry): boolean => /Relax sidecar contract/i.test(a.title);

/** 落盘夹具 → 目标诊断 → 该诊断的 codeAction 列表 */
function actionsFor(
  dirPrefix: string,
  js: string,
  sc: string,
  pick: (message: string) => boolean,
) : { actions: CodeActionEntry[]; messages: string[]; scText: string; uri: string } {
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

describe("Bug 133 · 放宽侧车契约必须打在被违反的参数槽", () => {
  it("参数违例：动作标题带 greet.u，编辑只剥形参谓词（返回槽 .gt(40) 不动）", () => {
    const { actions, scText, uri } = actionsFor("nudo-lsp-133a-", GREET_JS_NUM, SC_NUM_RET, isParamDiag);
    const relax = actions.filter(isRelax);
    expect(relax).toHaveLength(1);
    // 标题必须指出目标槽：`greet` 后面带 `.u`（旧实现标题只有 `greet`）
    expect(relax[0]!.title).toBe("Relax sidecar contract for greet.u");

    const edits = sidecarEdits(relax, uri);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.newText).toBe(
      `import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number() }, number().gt(40));
`,
    );
    // 落盘后：只放宽了 u，返回槽的 `.gt(40)` 一字未动
    const landed = applyEdits(scText, edits);
    expect(landed).toContain("fn({ u: number() }");
    expect(landed).toContain("number().gt(40)");
  });

  it("落盘后目标参数诊断消失（编辑真的可执行，不是假修复）", () => {
    const { actions, scText, uri } = actionsFor("nudo-lsp-133b-", GREET_JS_NUM, SC_NUM, isParamDiag);
    const relax = actions.filter(isRelax);
    expect(relax).toHaveLength(1);
    const landed = applyEdits(scText, sidecarEdits(relax, uri));
    expect(landed).toBe(`import { fn, number } from "@nudojs/core";

export const greet = fn({ u: number() }, number());
`);

    withTempDir("nudo-lsp-133b-recheck-", (dir) => {
      const jsPath = join(dir, "greet.js");
      writeFileSync(jsPath, GREET_JS_NUM, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), landed, "utf-8");
      const after = checkToLspDiagnostics(jsPath, GREET_JS_NUM, defaultLoadModule);
      expect(after.filter((d) => isParamDiag(d.message))).toHaveLength(0);
      expect(after).toHaveLength(0);
    });
  });

  it("参数槽改不动（shape 参数）⇒ 不下发放宽动作，不得退化成改返回槽", () => {
    const { actions, messages } = actionsFor("nudo-lsp-133c-", GREET_JS, SC_SHAPE, isParamDiag);
    // 目标确实是参数违例（expected: missing field u.name）
    expect(messages.join("\n")).toMatch(/missing field u\.name/);
    // 旧实现会下发标题「Relax sidecar contract for greet」→ 改返回槽 ⇒ 参数诊断仍在
    expect(actions.filter(isRelax)).toHaveLength(0);
    // 任何候选动作都不得削弱返回契约
    const allSidecarText = actions.map((a) =>
      JSON.stringify(a.edit?.changes ?? {}),
    ).join("\n");
    expect(allSidecarText).not.toContain("fn({ u: shape({ name: string() }) }, number())");
    // 参数违例本身仍引导用户改**调用点**
    expect(actions.map((a) => a.title)).toContain("Add missing field 'name' to call");
  });

  it("证据面：只剥返回槽数值谓词对参数诊断一字无效（所以不下发）", () => {
    withTempDir("nudo-lsp-133d-", (dir) => {
      const jsPath = join(dir, "greet.js");
      writeFileSync(jsPath, GREET_JS, "utf-8");
      // 旧 quickfix 的落盘结果：返回槽 number().gt(40) → number()
      const weakened = SC_SHAPE.replace("number().gt(40)", "number()");
      writeFileSync(join(dir, "greet.nudo.js"), weakened, "utf-8");
      const after = checkToLspDiagnostics(jsPath, GREET_JS, defaultLoadModule);
      // 参数诊断原样保留
      expect(after.filter((d) => isParamDiag(d.message))).toHaveLength(1);
      expect(after.map((d) => d.message).join("\n")).toMatch(/missing field u\.name/);
    });
  });
});
