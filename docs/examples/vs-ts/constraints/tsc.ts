// 约束场景 — tsc 侧
// 运行：pnpm exec tsc --noEmit --strict docs/examples/vs-ts/constraints/tsc.ts
//
// tsc 只能查 number，查不到 ms > 0。

function setDelay(ms: number): number {
  if (ms > 0) return ms;
  return 0;
}

setDelay(0);      // tsc: ok（类型合法）
setDelay(-50);    // tsc: ok
setDelay(100);    // ok

export { setDelay };
