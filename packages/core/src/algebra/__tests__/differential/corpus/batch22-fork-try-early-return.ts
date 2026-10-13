/**
 * fork 臂 × try 区域早退回归（batch22）。
 * 背景：`stmtReturns` 缺 TryStatement case → try 内 return 不能触发臂
 * 提升/双 return 改写，臂值被语句位 $fork 丢弃，fall-through 值独占结果
 * （错定 0）。覆盖 if/else-if/嵌套 if/循环/switch 臂 × try-catch-finally
 * 的 return / throw / break / continue 早退通道。
 */
export const forkArmTryReturn = [
  "const kind = 1; if (kind > 0) { try { throw [1, 2]; } catch (e) { return e[0] + e[1]; } } return 0;",
  "const kind = 1; if (kind > 0) { try { return 9; } finally { } } return 0;",
  "const kind = 1; if (kind > 0) { try { return 9; } catch (e) { return 1; } } return 0;",
  "const kind = 1; if (kind > 0) { try { return 8; } catch (e) { return 1; } } else { try { return 2; } catch (e) { return 3; } } return 0;",
  "const kind = -1; if (kind > 0) { return 1; } else { try { return 5; } catch (e) { return 2; } } return 0;",
  "const kind = 2; if (kind > 3) { return 1; } else if (kind > 1) { try { return 7; } catch (e) { return 2; } } return 0;",
  "const kind = 1; if (kind > 0) { if (kind > 0) { try { return 4; } catch (e) { return 2; } } return 3; } return 0;",
  "const kind = 1; if (kind > 0) { if (kind > 0) { return 1; } else { return 2; } } return 0;",
];

export const loopAndSwitchTryReturn = [
  "let i = 0; while (i < 3) { i += 1; if (i === 2) { try { return 7; } catch (e) { return 1; } } } return 0;",
  "for (let i = 0; i < 3; i++) { if (i === 2) { try { return 11; } catch (e) { return 1; } } } return 0;",
  "const k = 1; switch (k) { case 1: { try { return 12; } catch (e) { return 2; } } default: return 0; }",
  "let s = 0; for (let i = 0; i < 5; i++) { if (i < 3) { try { continue; } finally { } } s += i; } return s;",
  "const kind = 1; for (let i = 0; i < 5; i++) { if (kind > 0) { try { break; } finally { } } } return 1;",
];

export const tryControlTransferEdge = [
  // finally-wins：finalizer break 取消 try 的 return
  "const kind = 1; for (let i = 0; i < 3; i++) { if (kind > 0) { try { return 5; } finally { break; } } } return 0;",
  // uncaught throw：try 无 catch（finally 空）→ 函数必然抛
  "const kind = 1; if (kind > 0) { try { throw 42; } finally { } } return 0;",
  // 非终止 try（fall-through 继续）：臂值不得覆盖后续语句
  "const kind = 1; if (kind > 0) { try { kind; } catch (e) { return 1; } } return 55;",
];
