/**
 * Bug 215（族 02 / tmp/bugs/02-core-exec-runtime.md）：@nudo:invariant 在
 * **while / do-while / for-of** 三种循环里被静默丢弃 ⇒ 门禁对**用户自己的
 * 公理本可证明**的函数报红（假红）。
 *
 * 根因：不变式只在**循环 join / 宽化位**实施（issue #176 的设计——用户公理
 * 是循环携带界的唯一通道）。历史上的实施点只有两处：
 *   - control.ts `$for` 的 applyExtJoin → widenLoopJoin（内接 applyInvariantsToPack）
 *   - loop-widen.ts `widenFinal`（抽象预算耗尽路径）
 * `$whileSeq`（while / do-while）与 `$forOf`（for-of）的**具体出口**路径
 * （循环条件可判定为假 → 无快照 join → 不经 widenFinal）两条路都不通 ⇒
 * 出口 join 上的绑定包从未被强化 ⇒ 公理无诊断地消失（假红）。
 *
 * 修法（跨文件）：control.ts `$whileSeq.applyExitJoin` 与
 * containers/iterate.ts `$forOf.applyExitJoin` 在解包前接上
 * `applyExitJoinInvariants`（invariant-apply.ts 新增的统一入口）；具体出口
 * 路径（无快照 join）仅当**有公理**时才取绑定包，且仅当公理真的改写了绑定
 * 包时才解包 ⇒ 零行为变化（无公理 / 公理不适用时恒等；取包会暴露转译侧
 * pack 闭包引用体内作用域解构绑定的既有缺陷——见 tmp/probe/fix-r22-s10 报告）。
 *
 * ⚠️ 本文件在上述**跨文件补丁**（tmp/probe/fix-r22-s10/patch-215.patch）
 * 合入前为**红**（预期）——合入后全绿。
 *
 * 全部相对路径导入（单一模块实例）：会话槽（state.ts 模块级 let）跨实例
 * 不可见（#152 教训）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";

const sidecarOpts = (sidecar: string) => ({
  loadModule: (spec: string) => (spec.endsWith(".nudo.js") ? sidecar : undefined),
  fromFile: "/t/invariant.js",
});

function checkOf(src: string, opts: Record<string, unknown> = {}) {
  return checkSource("/t/invariant.js", src, pTrue, opts);
}

const SIDECAR = `export const f = fn({ n: number() }, number().ge(0));`;

/** 四种循环形态：只差写法，同一份公理（`@nudo:invariant last >= 0`） */
const FORMS: Array<{ id: string; body: string }> = [
  {
    id: "for",
    body: `
  let last = 0;
  for (let j = 0; j < 3; j++) last = n;
  return last;`,
  },
  {
    id: "while",
    body: `
  let last = 0;
  let j = 0;
  while (j < 3) { last = n; j = j + 1; }
  return last;`,
  },
  {
    id: "do-while",
    body: `
  let last = 0;
  let j = 0;
  do { last = n; j = j + 1; } while (j < 3);
  return last;`,
  },
  {
    id: "for-of",
    body: `
  let last = 0;
  for (const x of [1, 2, 3]) { last = n; }
  return last;`,
  },
];

const srcOf = (body: string, directive: string | null): string => `
${directive ? `/**\n * ${directive}\n */` : ""}
export function f(n) {${body}}
`;

describe("Bug 215：@nudo:invariant 在四种循环形态同口径生效", () => {
  it.each(FORMS.map((f) => [f.id, f.body] as const))(
    "%s：公理 last >= 0 → 返回契约 ge(0) 证得（无 error）+ invariant-relied 审计",
    (_id, body) => {
      const r = checkOf(srcOf(body, "@nudo:invariant last >= 0"), sidecarOpts(SIDECAR));
      expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
      const relied = r.issues.find((i) => i.code === "nudo:invariant-relied");
      expect(relied).toBeDefined();
      expect(relied!.severity).toBe("info");
      expect(relied!.message).toContain("proved via @nudo:invariant last >= 0");
      // 签名面：出口绑定带上了公理界（n ≥ 0）
      const sig = r.signatures.find((s) => s.name === "f");
      expect(sig).toBeDefined();
      expect(sig!.display).toContain("n ≥ 0");
    },
  );

  it.each(FORMS.map((f) => [f.id, f.body] as const))(
    "%s 对照（无公理）：证不出 → 返回义务未证得（负控制：不得被本修复波及）",
    (_id, body) => {
      const r = checkOf(srcOf(body, null), sidecarOpts(SIDECAR));
      // Bug 370：无公理时 `last` 只有 typeof 级证据（无界）⇒ 返回义务
      // 「既证不出、也反证不了」⇒ 判 `nudo:unproven-return`（warning），
      // **不得**判 `nudo:constraint-violated`（确定违约 = 假红）。
      expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(true);
      expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(false);
      expect(r.issues.some((i) => i.code === "nudo:invariant-relied")).toBe(false);
      expect(r.issues.some((i) => i.code.startsWith("nudo:invariant"))).toBe(false);
    },
  );

  it("弱公理不得证明强契约（方向性诚实）：@nudo:invariant last >= 0 vs 契约 ge(1)", () => {
    const r = checkOf(
      srcOf(FORMS[1]!.body, "@nudo:invariant last >= 0"),
      sidecarOpts(`export const f = fn({ n: number() }, number().ge(1));`),
    );
    // 公理被实施（n ≥ 0）但不足以蕴含 ge(1) → 仍报违约（不得假绿）
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
    expect(r.issues.some((i) => i.code === "nudo:invariant-relied")).toBe(false);
  });

  it("抽象预算耗尽路径（不可判定条件）不受影响：公理照常实施", () => {
    const body = `
  let last = 0;
  let j = 0;
  while (j < n) { last = n; j = j + 1; }
  return last;`;
    const r = checkOf(srcOf(body, "@nudo:invariant last >= 0"), sidecarOpts(SIDECAR));
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.some((i) => i.code === "nudo:invariant-relied")).toBe(true);
  });
});
