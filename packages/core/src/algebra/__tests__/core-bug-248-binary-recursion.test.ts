/**
 * BUG-248：二元递归（`bin(n-1)+bin(n-2)`）在 α 泛化求值里让 term/预算键
 * 指数增长 ⇒ `check`/`health`/`test` 全部 OOM 死亡、stdout 0 字节。
 * 修复：自递归函数不走 B（求值）路径（解释路径有界展开）；L2 入口求值对
 * 多自引用实参剥掉 term 身份，恢复环检测。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sigOf } from "./nudo-constraints.ts";

const BIN = `export function bin(n) { return n < 2 ? n : bin(n - 1) + bin(n - 2); }`;
const LIN = `export function bin(n) { return n < 2 ? n : bin(n - 1); }`;

describe("BUG-248 binary recursion", () => {
  it(
    "binary recursion terminates and reports recursion truncation",
    () => {
      const r = checkSource("/t/bug-248-bin.js", BIN, pTrue);
      expect(r.issues.some((i) => i.code === "nudo:recursion-truncated")).toBe(true);
      expect(sigOf(r, "bin")).toBe("unknown throws TypeError");
    },
    30_000,
  );

  it(
    "linear recursion keeps working (control)",
    () => {
      const r = checkSource("/t/bug-248-lin.js", LIN, pTrue);
      expect(r.issues.some((i) => i.code === "nudo:recursion-truncated")).toBe(true);
      expect(r.signatures.find((s) => s.name === "bin")).toBeDefined();
    },
    30_000,
  );
});
