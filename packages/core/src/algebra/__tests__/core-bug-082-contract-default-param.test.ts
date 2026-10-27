/**
 * BUG-082 —— 默认参数值与参数契约不符：调用点面**已执法**，被调方 L1 面**假绿**。
 *
 * 根因：契约路径把形参域**整体替换**成契约 Abs（`constraintToEntryAbs`）⇒
 * 默认值初始化式从未参与被调方的门禁路径。`pick(s = "abc")` 配侧车
 * `fn({ s: number() }, number())` 因此在被调方文件上判绿（`OK`, exit 0），
 * 而同一份契约在零参调用点面正确报红。
 *
 * 修后：契约绑定时把默认值类型并入形参定义域（**契约域 ∪ 默认值类型**；
 * 默认值落在契约域内时保持契约域原样）⇒ 形参域变宽 ⇒ 返回面随之变宽 ⇒
 * 既有的 L1 返回契约对账通道报红。
 *
 * oracle：node 原生 `pick()` 返回 `"abc"`（字符串）⇒ 同时违反参数域 `number`
 * 与返回 `number` 两条契约。
 */
import { describe, it, expect } from "vitest";
import { checkSource, generalizeFromAst, pTrue } from "../index.ts";
import { makeFiles, sidecarOpts, sigOf } from "./nudo-constraints.ts";

/** 侧车：`pick(s: number) => number` */
const PICK_SIDECAR = `import { fn, number } from "@nudojs/core";
export const pick = fn({ s: number() }, number());
`;

const SRC = `export function pick(s = "abc") { return s; }\n`;

/** 冻结的契约路径：源码 + 侧车（`e.js` ↔ `e.nudo.js`） */
function frozenCheck(src: string) {
  const files = { "/t/e.js": src, "/t/e.nudo.js": PICK_SIDECAR };
  const { loadModule } = makeFiles(files);
  return checkSource("/t/e.js", src, pTrue, { loadModule, fromFile: "/t/e.js" });
}

describe("BUG-082 · 被调方 L1 面：默认值与参数契约冲突不再假绿", () => {
  it("契约 + 冲突默认值 ⇒ 报错（修复前：OK / exit 0）", () => {
    const r = frozenCheck(SRC);
    expect(r.ok).toBe(false);
    const errors = r.issues.filter((i) => i.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    // 冲突经既有的返回契约对账通道落点：`pick` 自身的 L1 面
    expect(errors.some((i) => i.fn === "pick")).toBe(true);
    expect(errors.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });

  it("签名如实反映默认值参与定义域（`number | \"abc\"`）", () => {
    // 修复前签名是自信的单值 `pick(s: number) => number`（默认值蒸发）
    expect(sigOf(frozenCheck(SRC), "pick")).toContain('"abc"');
  });

  it("合法形态保持绿：默认值落在契约域内（`s = 1` + `number()`）", () => {
    const r = frozenCheck(`export function pick(s = 1) { return s; }\n`);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("无契约路径行为不变（默认值不参与，零报错）", () => {
    const src = `export function pick(s = "abc") { return s; }\n`;
    const { loadModule } = makeFiles({ "/t/e.js": src });
    const r = checkSource("/t/e.js", src, pTrue, { loadModule, fromFile: "/t/e.js" });
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it(".d.ts 可省性的事实来源保留：契约路径下 formals 仍是 default/optional", () => {
    // dts 面的 optional 判据 = `decl.hasDefault`（形参 kind === "default"）；
    // 契约绑定不得把它抹掉（否则 `s` 被渲染成必选）
    const { loadModule } = makeFiles({ "/t/e.js": SRC, "/t/e.nudo.js": PICK_SIDECAR });
    const g = generalizeFromAst("pick", SRC, {
      refine: { loadModule, fromFile: "/t/e.js" },
    });
    expect(g?.formals?.[0]).toMatchObject({ kind: "default", optional: true });
    expect(g?.params).toEqual(["s"]);
  });

  it("`_` / rest 之外的默认形参也走同一口径（`a`, `b = 2`）", () => {
    const src = `export function pick(a = 0, b = 2) { return a + b; }\n`;
    const sidecar = `import { fn, number } from "@nudojs/core";
export const pick = fn({ a: number(), b: number() }, number());
`;
    const { loadModule } = makeFiles({ "/t/e.js": src, "/t/e.nudo.js": sidecar });
    const r = checkSource("/t/e.js", src, pTrue, { loadModule, fromFile: "/t/e.js" });
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("通用侧车 opts 口径（marker）与 makeFiles 口径一致", () => {
    const opts = sidecarOpts("e.nudo", PICK_SIDECAR, "/t/e.js");
    const r = checkSource("/t/e.js", SRC, pTrue, opts);
    expect(r.issues.some((i) => i.severity === "error" && i.fn === "pick")).toBe(true);
  });
});
