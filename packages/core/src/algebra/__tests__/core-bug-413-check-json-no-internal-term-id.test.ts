/**
 * Bug 413 —— `nudo check --json` / `--verbose` 把**引擎内部 term id**
 * （`len#N` 一族）渲进机器可读的签名字段。
 *
 * 三条症状：
 * ① 机器面载荷含**内部符号**（`len#N` 不是一个用户能理解的名字）；
 * ② 编号随**同一次调用内的文件顺序**漂移（`len#0` / `len#2` / `len#4`）
 *    ⇒ **单个文件的 JSON 载荷是它在参数列表中位置的函数**，不是文件内容的
 *    函数（机器消费方拿到的不是可比对的内容）；
 * ③ 同一条命令的**人类面**给出另一个字符串（`f() => number` vs
 *    `number = len#0 where len#0 ≥ 0 #path`）⇒ 两个面自相矛盾。
 *
 * 根因：`formatAbs` / `formatAbsMultiline` **无条件**把 Abs 的 term / pred
 * 渲进签名串，而 Abs 的 term 里混着引擎内部的抽象变量名（`len#N` 来自
 * **模块级**自增计数器 ⇒ 编号是进程历史的函数）；机器面（`serializeCheckJson`）
 * 用它、人类面（`formatCheckReport`）用 `formatShape`。
 *
 * 修法（core/algebra/check-signatures.ts + core/algebra/check-report.ts）：
 * - `formatSigCached` 的 `display` 改为**人类面口径**（`formatShape`）⇒ 与
 *   `formatCheckReport` 的签名行**逐字同源**；
 * - 新增模块级导出 `absWithStableTermIds`（`check-report.ts`，**不进公开面**）：
 *   把 term / pred 里的**引擎内部计数器 id**换成**稳定名**（`len#2` → `len`）
 *   ⇒ `formatSigCached` 的 `detail` 与 `serializeCheckJson` 的 `abs` 用它渲染
 *   ⇒ 形状 / 谓词证据（`len ≥ 0`）/ `#conf` / pathNote 全部保留，只有那个
 *   会随进程漂移的编号被抹平。
 *
 * 回归护栏：
 * - 机器面三字段（display / detail / abs）不得含内部 id；
 * - 人类面 `--verbose` 同样不得含内部 id；
 * - 机器面 `display` 与人类面签名行口径一致（逐字同源）；
 * - **同内容不同路径** ⇒ 载荷逐字相同（不再随位置漂移）；
 * - 非内部 id 的 term / pred 证据**仍在**（D2 契约：verbose 明细不丢信息）；
 * - 谓词证据不丢（`len ≥ 0` 仍在 detail / abs 里，只是 id 变稳定名）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, serializeCheckJson, formatCheckReport } from "../index.ts";

/** 抽象长度：引擎为「未知长度」铸一个**进程级计数器** var（`len#N`） */
const LEN_SRC = `export function f() {
  const a = [1, 2, 3];
  a.length = 5000;
  return a.length;
}
`;

/** 引擎内部计数器 id 形态（`len#N` / `fromIdx#N` / `inv#N` / `#N` 一族） */
const INTERNAL_ID_RE = /#\d+/;

describe("Bug 413：机器面签名不得含引擎内部计数器 id", () => {
  it("display / detail / abs 三字段都不含内部 id", () => {
    const j = serializeCheckJson(checkSource("/t/len.js", LEN_SRC, pTrue));
    const sig = j.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    for (const field of [sig!.display, sig!.detail, sig!.abs]) {
      expect(field).not.toContain("len#");
      expect(field).not.toMatch(INTERNAL_ID_RE);
    }
  });

  it("人类面 --verbose 同样不得含内部 id", () => {
    const text = formatCheckReport(checkSource("/t/len.js", LEN_SRC, pTrue), {
      verbose: true,
    });
    expect(text).not.toContain("len#");
    expect(text).not.toMatch(INTERNAL_ID_RE);
  });

  it("机器面 display 与人类面签名行同源（口径一致）", () => {
    const r = checkSource("/t/len.js", LEN_SRC, pTrue);
    const sig = r.signatures.find((s) => s.name === "f")!;
    const line = formatCheckReport(r)
      .split("\n")
      .find((ln) => ln.startsWith("  f("));
    expect(line).toBe(`  f() => ${sig.display}`);
  });

  it("detail 首行仍是函数名（Bug 377 的「不得串号」契约不回归）", () => {
    const sig = checkSource("/t/len.js", LEN_SRC, pTrue).signatures.find(
      (s) => s.name === "f",
    )!;
    expect(sig.detail.split("\n")[0]).toBe("f");
  });

  it("同内容不同路径 ⇒ 载荷逐字相同（不再随参数列表位置漂移）", () => {
    const a = serializeCheckJson(checkSource("/t/a.js", LEN_SRC, pTrue));
    const b = serializeCheckJson(checkSource("/t/b.js", LEN_SRC, pTrue));
    const c = serializeCheckJson(checkSource("/t/c.js", LEN_SRC, pTrue));
    expect(b.signatures).toEqual(a.signatures);
    expect(c.signatures).toEqual(a.signatures);
  });

  it("非内部 id 的 term 段仍在（verbose 明细不丢信息 —— D2 契约）", () => {
    const r = checkSource("/t/alpha.js", "export function add(a, b) { return a + b; }\n", pTrue);
    expect(formatCheckReport(r, { verbose: true })).toContain("term:");
  });

  it("不带内部 id 的签名：term / pred 证据仍在（契约面不被无谓收紧）", () => {
    const j = serializeCheckJson(
      checkSource("/t/alpha.js", "export function add(a, b) { return a + b; }\n", pTrue),
    );
    const sig = j.signatures.find((s) => s.name === "add")!;
    // display 已是人类面口径（formatShape）⇒ 与人类面签名行同源（无 term 注记）
    expect(sig.display).toContain("number | string");
    expect(sig.display).not.toContain("= (A1 + A2)");
    // detail / abs 仍是 formatAbsMultiline / formatAbs 口径（证据不丢）
    expect(sig.detail).toContain("term: (A1 + A2)");
    expect(sig.detail).toContain("conf: partial");
    expect(sig.abs).toContain("= (A1 + A2)");
    expect(sig.abs).toContain("#partial");
  });

  it("内部计数器 id 换成稳定名（谓词证据不丢）", () => {
    const j = serializeCheckJson(checkSource("/t/len.js", LEN_SRC, pTrue));
    const sig = j.signatures.find((s) => s.name === "f")!;
    expect(sig.detail).toContain("term: len");
    expect(sig.detail).toContain("pred: len ≥ 0");
    expect(sig.abs).toContain("= len");
    expect(sig.abs).toContain("where len ≥ 0");
  });
});
