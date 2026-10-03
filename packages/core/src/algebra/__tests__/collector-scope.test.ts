/**
 * Collector 作用域（ALS）：模块级 collector / 诊断通道的 await 窗口隔离。
 *
 * 两个断言族：
 * 1. fallback（无作用域）= 收敛前的模块全局语义——含交错下的串台
 *    （「await 窗口偷诊断」事故形态的活体证明：collector 被交错方覆盖后，
 *    本分析的发射全部落进别人的 collector / 静默丢失）。
 * 2. runWithCollectorScope 内：交错分析各开各的 store，互不串台；
 *    new Function 求值路径（transpile 注入的 runtime 跨帧读 collector）
 *    在嵌套 + await 间隔两场景下仍读到最内层正确值。
 */
import { describe, it, expect } from "vitest";
import { runWithCollectorScope, createScopedSlot } from "../collector-scope.ts";
import { createScopedDiagChannel } from "../diag-channel.ts";
import {
  setAbsTruncationCollector,
  noteAbsTruncation,
  resetAbsCallBudget,
} from "../call-budget.ts";
import {
  setEvalCallCollector,
  setEvalAssignCollector,
} from "../exec/calls.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { checkSource } from "../check.ts";
import {
  execNudoModule,
  resetNudoModuleExecCache,
  setRefineDiagCollector,
  takeRefineDiags,
  refineDiagCount,
  takeRefineDiagsSince,
} from "../refine.ts";

/** 打点：不走真实求值，隔离验证 collector 路由本身 */
function emitTruncation(label: string): void {
  noteAbsTruncation(label);
}

describe("collector 作用域：scoped slot / channel 原语", () => {
  it("无作用域 = fallback 模块全局（今日语义）：set/get 全局可见", () => {
    const slot = createScopedSlot<number>(() => 0);
    expect(slot.get()).toBe(0);
    slot.set(7);
    expect(slot.get()).toBe(7);
    // 嵌套 runScoped 继承进入时值；退出后回落 fallback
    const inner = slot.runScoped(() => {
      expect(slot.get()).toBe(7);
      slot.set(8);
      return slot.get();
    });
    expect(inner).toBe(8);
    expect(slot.get()).toBe(7);
  });

  it("diag channel：作用域内空缓冲/seq 归零、观察者继承", () => {
    const chan = createScopedDiagChannel<string>(8);
    const seen: string[] = [];
    chan.setCollector((d) => seen.push(d));
    chan.emit("fallback-entry");
    expect(chan.count()).toBe(1);
    const out = chan.runScoped(() => {
      // 空缓冲 + seq 归零；观察者继承（宿主在分析外装的观察器继续可见）
      expect(chan.count()).toBe(0);
      chan.emit("scoped-entry");
      return chan.take();
    });
    expect(out).toEqual(["scoped-entry"]);
    expect(seen).toEqual(["fallback-entry", "scoped-entry"]);
    // 作用域外缓冲未被作用域内条目污染
    expect(chan.take()).toEqual(["fallback-entry"]);
  });
});

describe("collector 作用域：await 窗口交错", () => {
  /**
   * 一次「分析」：装 truncation collector → await（窗口）→ 发射 → restore。
   * scope=true 时整段包 runWithCollectorScope。
   */
  async function observedAnalysis(
    tag: string,
    delayMs: number,
    scope: boolean,
  ): Promise<string[]> {
    const seen: string[] = [];
    const prev = setAbsTruncationCollector((l) => seen.push(`${tag}<-${l}`));
    const body = async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      emitTruncation(tag);
      return seen;
    };
    const out = scope ? await runWithCollectorScope(body) : await body();
    setAbsTruncationCollector(prev);
    return out;
  }

  it("fallback（今日模块全局）：交错分析互相偷走对方的发射（活体证明）", async () => {
    resetAbsCallBudget();
    setAbsTruncationCollector(null);
    // A(5ms) 先恢复：此刻全局 collector 已被后启动的 B 覆盖 → A 的发射进 B
    // 的 collector；A restore 又把全局砸回 null → B 自己的发射彻底丢失。
    const [a, b] = await Promise.all([
      observedAnalysis("A", 5, false),
      observedAnalysis("B", 25, false),
    ]);
    // 今日行为的证明：A 的发射被 B 偷走，B 的发射被 A 的 restore 静默
    expect(a).toEqual([]);
    expect(b).toEqual(["B<-A"]);
    setAbsTruncationCollector(null);
  });

  it("scoped：交错分析各收各的，await 后 collector 仍绑定本分析", async () => {
    resetAbsCallBudget();
    setAbsTruncationCollector(null);
    const [a, b] = await Promise.all([
      observedAnalysis("A", 5, true),
      observedAnalysis("B", 25, true),
    ]);
    expect(a).toEqual(["A<-A"]);
    expect(b).toEqual(["B<-B"]);
    setAbsTruncationCollector(null);
  });

  it("scoped：诊断缓冲不串台——交错分析的 refine 诊断不进对方缓冲", async () => {
    resetNudoModuleExecCache();
    setRefineDiagCollector(null);
    takeRefineDiags();
    // 每方在自己作用域内 await 后触发一次侧车加载失败诊断（不同 specifier
    // 避开 exec 缓存去重），另一方的缓冲里不得出现它
    async function diagAnalysis(spec: string, delayMs: number): Promise<string[]> {
      return runWithCollectorScope(async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        const since = refineDiagCount();
        execNudoModule(
          `import { v } from "${spec}";\nexport const p = v;\n`,
        );
        return takeRefineDiagsSince(since).map((d) => d.message);
      });
    }
    const [a, b] = await Promise.all([
      diagAnalysis("./a-als.nudo.js", 5),
      diagAnalysis("./b-als.nudo.js", 25),
    ]);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a.every((m) => m.includes("a-als.nudo.js"))).toBe(true);
    expect(b.every((m) => m.includes("b-als.nudo.js"))).toBe(true);
    // 作用域内条目不泄漏到模块级 fallback 缓冲
    expect(takeRefineDiags().filter((d) => d.message.includes("als.nudo.js"))).toEqual([]);
    setRefineDiagCollector(null);
  });
});

describe("collector 作用域：new Function 求值路径", () => {
  // 求值路径的调用点记录只记 $callNamed（函数体内的具名调用）——
  // 导出顶层调用本身不进 evalCall collector（见 exec/calls.ts 语义）
  const SRC_A = `export function entryA() { return helperA(); }\nfunction helperA() { return 1; }`;
  const SRC_B = `export function entryB() { return helperB(); }\nfunction helperB() { return 2; }`;

  /** 触发一次真实求值的调用点记录（transpile → new Function → $callNamed） */
  function evalCall(collectorSeen: string[], entry: string, helper: string, src: string): void {
    const prev = setEvalCallCollector((r) => collectorSeen.push(r.fnName));
    try {
      const run = runTranspiled(src, { mode: "analyze" });
      callTranspiledExportFull(run, entry, []);
      collectorSeen.push(`#${helper}-restore`);
    } finally {
      setEvalCallCollector(prev);
    }
  }

  it("嵌套作用域：runtime 跨帧读最内层 store（外层 collector 不被内层偷走）", () => {
    const outerSeen: string[] = [];
    const innerSeen: string[] = [];
    setEvalCallCollector((r) => outerSeen.push(r.fnName));
    try {
      runWithCollectorScope(() => {
        runWithCollectorScope(() => {
          // 幂等标记使内层复用外层 store：内层 save/restore 配对作用于
          // 同一 store，restore 后回到外层 collector 语义
          evalCall(innerSeen, "entryA", "helperA", SRC_A);
        });
        // 内层 restore 后，外层 collector 继续接收
        evalCall(outerSeen, "entryB", "helperB", SRC_B);
      });
    } finally {
      setEvalCallCollector(null);
    }
    expect(innerSeen).toEqual(["helperA", "#helperA-restore"]);
    expect(outerSeen).toEqual(["helperB", "#helperB-restore"]);
  });

  it("await 间隔：作用域跨 await 后 runtime 仍读到本分析 collector", async () => {
    const seen: string[] = [];
    await runWithCollectorScope(async () => {
      setEvalCallCollector((r) => seen.push(r.fnName));
      await new Promise((r) => setTimeout(r, 5));
      const run = runTranspiled(SRC_A, { mode: "analyze" });
      callTranspiledExportFull(run, "entryA", []);
    });
    setEvalCallCollector(null);
    expect(seen).toContain("helperA");
  });

  it("交错：两段求值分析 await 后各收各的调用记录", async () => {
    async function evalAnalysis(tag: string, delayMs: number): Promise<string[]> {
      return runWithCollectorScope(async () => {
        const seen: string[] = [];
        await new Promise((r) => setTimeout(r, delayMs));
        const prev = setEvalCallCollector((r) => seen.push(r.fnName));
        try {
          const run = runTranspiled(tag === "A" ? SRC_A : SRC_B, { mode: "analyze" });
          callTranspiledExportFull(run, tag === "A" ? "entryA" : "entryB", []);
        } finally {
          setEvalCallCollector(prev);
        }
        return seen;
      });
    }
    const [a, b] = await Promise.all([evalAnalysis("A", 5), evalAnalysis("B", 25)]);
    expect(a).toContain("helperA");
    expect(a).not.toContain("helperB");
    expect(b).toContain("helperB");
    expect(b).not.toContain("helperA");
  });

  it("assign collector（$assignRecord 插桩）在作用域内照常工作", () => {
    const records: Array<{ name: string }> = [];
    runWithCollectorScope(() => {
      const prev = setEvalAssignCollector((r) => records.push({ name: r.name }));
      try {
        runTranspiled(`let n = 1; n = "str";`, { mode: "analyze" });
      } finally {
        setEvalAssignCollector(prev);
      }
    });
    expect(records.map((r) => r.name)).toContain("n");
  });
});

describe("collector 作用域：checkSource 入口", () => {
  it("作用域内外报告一致（同步行为零变更）", () => {
    const src = `/** @nudo:contract number().gt(0) */\nexport function f(x) { return x; }\nf(-1);\n`;
    const plain = checkSource("als-plain.ts", src);
    const scoped = runWithCollectorScope(() => checkSource("als-scoped.ts", src));
    expect(scoped.ok).toBe(plain.ok);
    expect(scoped.issues.map((i) => `${i.code}:${i.message}`)).toEqual(
      plain.issues.map((i) => `${i.code}:${i.message}`),
    );
    expect(scoped.signatures.length).toBe(plain.signatures.length);
  });

  it("作用域内的 checkSource 不泄漏诊断到模块级 fallback 缓冲", () => {
    resetNudoModuleExecCache();
    takeRefineDiags();
    runWithCollectorScope(() => {
      checkSource(
        "als-sidecar.ts",
        `import { v } from "./als-c-plain.nudo.js";\nexport const p = v;\n`,
      );
    });
    // checkSource 在自己的作用域内排干（takeSince）——fallback 缓冲不应
    // 残留本次分析的侧车诊断
    expect(
      takeRefineDiags().filter((d) => d.message.includes("als-c-plain.nudo.js")),
    ).toEqual([]);
  });
});
