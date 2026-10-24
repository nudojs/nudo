/**
 * Bug 499 —— 依赖模块**不可读**（EACCES / EIO / EMFILE…）⇒ core 侧两个装载
 * 消费点（check.ts 的 memo 包装、scan-call-graph.ts 的 loadSpecFrom）把异常
 * 抛到 `nudo check` 的整轮外面（stdout 0 字节、无任何报告）。
 *
 * 修法（core 侧）：`algebra/load-guard.ts` 的读错误降级闸（口径对齐 service
 * 侧 `guardedLoadModule` / `ModuleReadError`：不可读 ≠ 不存在）+ check.ts
 * 把它收口成一条 `nudo:module-unreadable` 诊断（与 service 面同码；消息写明
 * errno，不谎报「文件不存在」）。
 *
 * 本文件钉住：
 * - 不可读依赖 ⇒ **不抛异常**，且产出一条明确诊断（含 errno）；
 * - 真·不存在（miss）⇒ **不得**报读失败（保持既有静默语义）；
 * - 读失败轮不得与「真不存在」轮共享 memo（陈旧命中）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { pTrue } from "../pred.ts";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
});

const MAIN = `import { d } from './dep.js';
export function run() {
  return d();
}
`;

const throwingLoader = (code: string, path: string) => () => {
  throw Object.assign(new Error(`${code}: permission denied, open '${path}'`), { code, path });
};

describe("Bug 499：依赖不可读不得炸穿整轮 check", () => {
  it("EACCES 依赖 ⇒ 不抛异常，且产出一条明确诊断", () => {
    let r!: ReturnType<typeof checkSource>;
    expect(() => {
      r = checkSource("/t/main.js", MAIN, pTrue, {
        fromFile: "/t/main.js",
        loadModule: throwingLoader("EACCES", "/t/dep.js"),
      });
    }).not.toThrow();
    const missing = r.issues.filter((i) => i.code === "nudo:module-unreadable");
    expect(missing.length).toBe(1);
    expect(missing[0]!.severity).toBe("error");
    // 消息必须写明「读失败」的事实与 errno——不得谎报「文件不存在」
    expect(missing[0]!.message).toContain("EACCES");
    expect(missing[0]!.message).toContain("/t/dep.js");
    expect(missing[0]!.message.toLowerCase()).not.toContain("not found");
  });

  it("真·不存在（miss）⇒ 不报读失败（既有静默语义不变）", () => {
    const r = checkSource("/t/main.js", MAIN, pTrue, {
      fromFile: "/t/main.js",
      loadModule: () => undefined,
    });
    expect(r.issues.filter((i) => i.code === "nudo:module-unreadable")).toEqual([]);
  });

  it("读失败轮不得与「真不存在」轮共享 memo（陈旧命中）—— **同一个 loader 闭包**切换行为", () => {
    const src = MAIN;
    // ⚠ 断言强度：两次调用必须**共用同一个 loader 对象**——`checkMemoKey` 含
    // loader 身份 ⇒ 换 loader 就换 key ⇒ 旧写法（miss 一个 loader /
    // unreadable 另一个 loader）**不可能**陈旧命中 ⇒ 钉不到失效逻辑。
    let mode: "miss" | "unreadable" = "miss";
    const loader = () => {
      if (mode === "miss") return undefined;
      throw Object.assign(new Error("EACCES: permission denied, open '/t/dep.js'"), {
        code: "EACCES",
        path: "/t/dep.js",
      });
    };
    const opts = { fromFile: "/t/main2.js", loadModule: loader };
    const miss = checkSource("/t/main2.js", src, pTrue, opts);
    expect(miss.issues.filter((i) => i.code === "nudo:module-unreadable")).toEqual([]);
    // 同一 loader、同一文件、同一份源码：切到不可读 ⇒ 必须重新判定并报出读失败
    mode = "unreadable";
    const unreadable = checkSource("/t/main2.js", src, pTrue, opts);
    expect(unreadable.issues.filter((i) => i.code === "nudo:module-unreadable").length).toBe(1);
    // 读失败轮**不得**把 memo 写成「读失败」的结论 ⇒ 切回 miss 后仍是静默
    mode = "miss";
    const missAgain = checkSource("/t/main2.js", src, pTrue, opts);
    expect(missAgain.issues.filter((i) => i.code === "nudo:module-unreadable")).toEqual([]);
  });
});
