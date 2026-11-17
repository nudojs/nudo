/**
 * 审计 34 · D7：LSP 与 CLI 同源。
 *
 * - 词法上下文判据（多行模板 / 多行块注释 / 正则体内部不得给候选）；
 * - 成员面并入类成员表（实例原型方法 / 静态方法）。
 */
import { describe, expect, it } from "vitest";
import { openLspDocument, requestCompletion } from "./lsp-harness-semantic-tokens.ts";

const labels = (items: { label: string }[]): string[] => items.map((i) => i.label);

function lineOf(src: string, needle: string): { line: number; text: string } {
  const lines = src.split("\n");
  const line = lines.findIndex((l) => l.includes(needle));
  if (line < 0) throw new Error(`fixture missing ${needle}`);
  return { line, text: lines[line]! };
}

describe("多行字面量 / 块注释 / 正则体内部零候选", () => {
  const SRC = [
    "export const modObj = { alpha: 1, beta: \"x\" };",
    "export const msg = `first line",
    "modObj.`;",
    "/* block",
    "modObj. */",
    "export const r = /modObj./;",
    "export const ok = modObj.alpha;",
  ].join("\n");

  it("多行模板续行内部 ⇒ 零候选", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-019/a.js");
    const at = lineOf(SRC, "modObj.`;");
    const items = requestCompletion(mock, uri, at.line, at.text.indexOf("modObj.") + 7);
    expect(labels(items)).toEqual([]);
  });

  it("多行块注释续行内部 ⇒ 零候选", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-019/b.js");
    const at = lineOf(SRC, "modObj. */");
    const items = requestCompletion(mock, uri, at.line, at.text.indexOf("modObj.") + 7);
    expect(labels(items)).toEqual([]);
  });

  it("正则体内部 ⇒ 零候选", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-019/c.js");
    const at = lineOf(SRC, "/modObj./");
    const items = requestCompletion(mock, uri, at.line, at.text.indexOf("modObj.") + 7);
    expect(labels(items)).toEqual([]);
  });

  it("对照：代码位照旧给成员候选（不得过度拦截）", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-019/d.js");
    const at = lineOf(SRC, "modObj.alpha");
    const items = requestCompletion(mock, uri, at.line, at.text.indexOf("modObj.") + 7);
    expect(labels(items)).toContain("alpha");
  });
});

describe("成员面并入类成员表", () => {
  const SRC = [
    "export class K {",
    "  n = 1;",
    "  m(a) { return a; }",
    "  static s() { return 2; }",
    "  static v = 1;",
    "}",
    "const k = new K();",
    "k.",
  ].join("\n");

  it("其实例：字段 + 原型方法都在", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-034/a.js");
    const at = lineOf(SRC, "k.");
    const got = labels(requestCompletion(mock, uri, at.line, 2));
    expect(got).toContain("m");
  });

  it("类值面（`K.`）：静态方法在（静态字段之外）", async () => {
    const SRC2 = [
      "export class K { static s() { return 2; } static v = 1; }",
      "K.",
    ].join("\n");
    const { mock, uri } = await openLspDocument(SRC2, "file:///tmp/nudo-034/b.js");
    const at = lineOf(SRC2, "K.");
    const got = labels(requestCompletion(mock, uri, at.line, 2));
    expect(got).toContain("s");
  });

  it("对照：对象字面量方法照旧（不回归）", async () => {
    const SRC3 = ["export const o = { n: 1, m(a) { return a; } };", "o."].join("\n");
    const { mock, uri } = await openLspDocument(SRC3, "file:///tmp/nudo-034/c.js");
    const at = lineOf(SRC3, "o.");
    expect(labels(requestCompletion(mock, uri, at.line, 2))).toContain("m");
  });
});

describe("成员面不得按名字并入同名类的静态成员", () => {
/**
 * 接收者是**局部对象**、但对象名与同文件的类名相同时，补全把该类的静态
 * 方法并进来了（按**文本名**查 `localClassMemberTable`，没有身份校验）：
 *
 * ```js
 * export class Config { static load() { return 1; } }
 * export function make() { const Config = { port: 8080 }; return Config.; }
 * ```
 *
 * 接收者的 Abs 明明是 `{ port: 8080 }`，候选却是 `["port","load"]` ⇒ 接受
 * `load` 即写出运行期 `TypeError: Config.load is not a function`。
 * 真正的类值接收者恒为 brand（走静态面）⇒ 按名兜底分支只可能在碰撞时执行。
 */
  const SHADOW = [
    "export class Config {",
    "  static load() { return 1; }",
    "}",
    "export function make() {",
    "  const Config = { port: 8080 };",
    "  return Config.;",
    "}",
  ].join("\n");

  it("局部对象遮蔽同名类 ⇒ 只给对象自己的成员（不含类的静态方法）", async () => {
    const { mock, uri } = await openLspDocument(SHADOW, "file:///tmp/nudo-088/a.js");
    const at = lineOf(SHADOW, "return Config.");
    const got = labels(requestCompletion(mock, uri, at.line, at.text.indexOf("Config.") + 7));
    expect(got).toContain("port");
    expect(got).not.toContain("load");
  });

  it("对照：局部对象改名为 cfg（不遮蔽）⇒ 仍只有对象成员", async () => {
    const SRC = SHADOW.replace("const Config = { port: 8080 };", "const cfg = { port: 8080 };")
      .replace("return Config.;", "return cfg.;");
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-088/b.js");
    const at = lineOf(SRC, "return cfg.");
    const got = labels(requestCompletion(mock, uri, at.line, at.text.indexOf("cfg.") + 4));
    expect(got).toEqual(["port"]);
  });

  it("对照：类值接收者（`Config.`）仍给静态方法（不过度拦截）", async () => {
    const SRC = ["export class Config {", "  static load() { return 1; }", "}", "Config."].join("\n");
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-088/c.js");
    const at = lineOf(SRC, "Config.");
    const got = labels(requestCompletion(mock, uri, at.line, at.text.indexOf("Config.") + 7));
    expect(got).toContain("load");
  });
});
