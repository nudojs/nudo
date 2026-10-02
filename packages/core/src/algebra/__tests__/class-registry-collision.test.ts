/**
 * BUG-026：class registry 裸名键——同图两模块各声明
 * 同名 class 时后者静默顶掉前者，$new / 成员查找
 * 解析到错误 spec 且无诊断。
 *
 * 修复：注册侧形状感知碰撞检测——同形重注册
 * （文件编辑后重评估，$class 每次生成新闭包）
 * 走覆盖语义（正确：重跑必须见新 spec）；
 * 不同形碰撞记入排水缓冲，求值出口排进回落
 * 观测面（unsupported:class-collision）。
 */
import { describe, it, expect } from "vitest";
import { $class } from "../exec/class.ts";
import {
  drainClassCollisions,
  clearBClasses,
  getEvalClass,
} from "../exec/class-registry.ts";
import {
  callTranspiledExportFull,
  runTranspiled,
  setEvalFallbackCollector,
  type EvalFallback,
} from "@nudojs/core";

describe("BUG-026: class registry 同名碰撞", () => {
  it("different-shape same-name classes record a collision", () => {
    clearBClasses();
    $class("Parser", {
      methods: { parse: (thisVal) => thisVal },
    });
    $class("Parser", {
      methods: { load: (thisVal) => thisVal },
    });
    const cols = drainClassCollisions();
    expect(cols.length).toBe(1);
    expect(cols[0]!.name).toBe("Parser");
    expect(cols[0]!.previous).toContain("parse");
    expect(cols[0]!.next).toContain("load");
    // 排水后清空
    expect(drainClassCollisions()).toEqual([]);
  });

  it("same-shape re-registration (file re-eval) is silent", () => {
    clearBClasses();
    // 重评估：$class 每次生成新闭包，但形状一致
    $class("Parser", {
      methods: { parse: (thisVal) => thisVal },
    });
    $class("Parser", {
      methods: { parse: (thisVal) => thisVal },
    });
    expect(drainClassCollisions()).toEqual([]);
    // 覆盖语义：注册表存后者（重跑见新 spec）
    expect(getEvalClass("Parser")).toBeDefined();
  });

  it("clearBClasses resets the collision buffer", () => {
    clearBClasses();
    $class("A", {
      methods: { x: (thisVal) => thisVal },
    });
    $class("A", {
      methods: { y: (thisVal) => thisVal },
    });
    expect(drainClassCollisions().length).toBe(1);
    // 再碰撞一次 → clearBClasses 清缓冲
    $class("A", {
      methods: { z: (thisVal) => thisVal },
    });
    clearBClasses();
    expect(drainClassCollisions()).toEqual([]);
    expect(getEvalClass("A")).toBeUndefined();
  });

  it("runTranspiled drains pending collisions into the fallback observer", () => {
    clearBClasses();
    const seen: EvalFallback[] = [];
    setEvalFallbackCollector((f) => seen.push(f));
    try {
      $class("Parser", {
        methods: { parse: (thisVal) => thisVal },
      });
      $class("Parser", {
        methods: { load: (thisVal) => thisVal },
      });
      // 求值出口排水 → 回落观测面
      runTranspiled("export const x = 1;", { mode: "analyze" });
      const hits = seen.filter(
        (f) => f.reason === "unsupported:class-collision",
      );
      expect(hits.length).toBe(1);
      expect(hits[0]!.message).toContain("Parser");
      expect(hits[0]!.message).toContain("different shape");
      // 排水是一次性的
      seen.length = 0;
      runTranspiled("export const y = 2;", { mode: "analyze" });
      expect(
        seen.filter((f) => f.reason === "unsupported:class-collision"),
      ).toEqual([]);
    } finally {
      setEvalFallbackCollector(null);
      clearBClasses();
    }
  });

  it("cross-run re-registration (sequential file analysis) is silent by design", () => {
    clearBClasses();
    const seen: EvalFallback[] = [];
    setEvalFallbackCollector((f) => seen.push(f));
    try {
      // run 1：文件 1 的 class A
      runTranspiled(
        "class A { m() { return 1; } } export const x = 1;",
        { mode: "analyze" },
      );
      // run 2：文件 2 的 class A（不同形）——跨 run
      // 重注册是常态（多文件顺序分析），last-wins
      // 覆盖语义，不得进回落观测面（语料零回落
      // 不变量）
      runTranspiled(
        "class A { n() { return 2; } } export const y = 2;",
        { mode: "analyze" },
      );
      expect(
        seen.filter((f) => f.reason === "unsupported:class-collision"),
      ).toEqual([]);
    } finally {
      setEvalFallbackCollector(null);
      clearBClasses();
    }
  });

  it("G3: call-stage (function-body block) same-name class collision is observable at the call exit", () => {
    clearBClasses();
    const seen: EvalFallback[] = [];
    setEvalFallbackCollector((f) => seen.push(f));
    try {
      // 类在导出函数体内（块级作用域）——$class 注册发生在入口调用
      // 阶段（callTranspiledExportFull），不在 runTranspiled 顶层
      const exports = runTranspiled(
        [
          "export function f() {",
          "  { class Box { a() { return 1; } } new Box(); }",
          "  { class Box { b() { return 2; } } new Box(); }",
          "  return 1;",
          "}",
        ].join("\n"),
        { mode: "analyze" },
      );
      // run 出口无碰撞（顶层没有类）
      expect(
        seen.filter((f) => f.reason === "unsupported:class-collision"),
      ).toEqual([]);
      // 调用阶段：同一函数体内两个同名不同形 Box → 碰撞必须
      // 在本次调用的出口即可观测（不滞留缓冲等下一个无关 run）
      callTranspiledExportFull(exports, "f", []);
      const hits = seen.filter(
        (f) => f.reason === "unsupported:class-collision",
      );
      expect(hits.length).toBe(1);
      expect(hits[0]!.message).toContain("Box");
      expect(hits[0]!.message).toContain("different shape");
      // 排水是一次性的（缓冲已清空）
      expect(drainClassCollisions()).toEqual([]);
    } finally {
      setEvalFallbackCollector(null);
      clearBClasses();
    }
  });

  it("G3: call stage re-execution after another file's fresh run is silent (no cross-file collision)", () => {
    clearBClasses();
    const seen: EvalFallback[] = [];
    setEvalFallbackCollector((f) => seen.push(f));
    try {
      // 文件 A：类在函数体内——run 时不注册，调用阶段（缓存命中后
      // 重执行编译体）才注册
      const exportsA = runTranspiled(
        "export function make() { class Box { a() { return 1; } } return new Box(); }",
        { mode: "analyze" },
      );
      // 文件 B：fresh run，顶层同名不同形类——跨 run 重注册是
      // 设计内 last-wins（静默）
      runTranspiled("class Box { b() { return 2; } } export const y = 1;", {
        mode: "analyze",
      });
      // A 的 run 缓存命中（tryRunEval 不重跑 runTranspiled）：入口
      // 调用重执行 A 的编译体——不得与 B 刚注册的 Box 判同 epoch
      callTranspiledExportFull(exportsA, "make", []);
      expect(
        seen.filter((f) => f.reason === "unsupported:class-collision"),
      ).toEqual([]);
      // 缓冲同样不留滞留记录
      expect(drainClassCollisions()).toEqual([]);
    } finally {
      setEvalFallbackCollector(null);
      clearBClasses();
    }
  });
});
