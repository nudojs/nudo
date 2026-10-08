import { describe, it, expect } from "vitest";
import { checkSource } from "@nudojs/core";

/**
 * 循环 pack 剔除名单 × shadow 健全性（PR #93 review 回归锁）。
 *
 * for/for-of/for-in/while/do-while 的 pack/unpack 名单按「循环体**顶层**
 * 词法声明名」剔除（collectLoopBodyTopLevelDeclNames）：
 *   - 体顶层 `const re = …` 对整个循环体 shadow 外层绑定，而 pack 闭包发射
 *     在体作用域之外（外层无绑定 → ReferenceError）——必须剔除（#91）；
 *     `re = $reStateCall(re, …)`（正则状态重绑）会把声明名带进 assigned。
 *   - 嵌套块内 `if (…) { let x }` 只 shadow 该块——不得剔除，否则外层 x
 *     丢 pack → 跨迭代状态丢失 → 非健全精确（shadowPack 曾折 `1`，
 *     a=[] 真值 0）。
 */
const shadowSrc = `
export function shadowPack(a) {
  let x = 0;
  for (const v of a) {
    x = x + 1;
    if (v > 1) { let x = 10; x = x + 1; }
  }
  return x;
}
export function forShadow(a) {
  let x = 0;
  for (let i = 0; i < a.length; i++) {
    x = x + 1;
    if (a[i] > 1) { let x = 10; x = x + 1; }
  }
  return x;
}
export function whileShadow(a) {
  let x = 0;
  let i = 0;
  while (i < a.length) {
    x = x + 1;
    i = i + 1;
    if (x > 5) { let x = 10; x = x + 1; }
  }
  return x;
}
export function doWhileShadow(a) {
  let x = 0;
  let i = 0;
  do {
    x = x + 1;
    i = i + 1;
    if (x > 5) { let x = 10; x = x + 1; }
  } while (i < a.length);
  return x;
}
`;

const issue91Src = `
function globToRegex(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') { out += '[^/]*'; }
    else if (ch === '?') { out += '[^/]'; }
    else { out += ch.replace(/[.+^\${}()|[\\]\\\\]/g, '\\\\$&'); }
  }
  return new RegExp('^' + out + '$');
}
export function f4(path, files) {
  if (!files || files.length === 0) return true;
  let selected = false;
  for (const pattern of files) {
    const re = globToRegex(pattern);
    if (re.test(path)) selected = true;
  }
  return selected;
}
export function selectedByFiles(path, files) {
  if (!files || files.length === 0) return true;
  let selected = false;
  for (const pattern of files) {
    if (pattern.startsWith('!')) {
      if (globToRegex(pattern.slice(1)).test(path)) selected = false;
      continue;
    }
    const re = globToRegex(pattern);
    if (re.test(path) || (path.startsWith(pattern + '/') && !pattern.includes('*'))) selected = true;
  }
  return selected;
}
`;

describe("loop pack/unpack exclusion × shadowing", () => {
  const rep = checkSource("loop-pack-shadow.js", shadowSrc);
  const sig = (n: string) => {
    const s = rep.signatures.find((x) => x.name === n);
    expect(s, `signature ${n}`).toBeTruthy();
    return s!;
  };

  it("for-of: nested block `let x` does not evict outer pack var (sound widen, was unsound 1)", () => {
    // a=[] 真值 0；`=> 1` 即非健全。Bug 47 后单代表迭代出口按增长宽化到
    // 无上界域（native a=[2,2] → 2 ∉ {0,1}，number 是 sound 超集）。
    // throws TypeError：for-of over any 接收者 may TypeError（Bug 6 迭代守卫，原生语义）
    expect(sig("shadowPack").display).toBe("number  #widened throws TypeError");
  });

  it("for / while: same shadow soundness across loop forms", () => {
    // forShadow 的 throws：a[i] 计算成员读 any 接收者 may TypeError（$idx 守卫）
    // Bug 48 后抽象条件预算耗尽按增长宽化（native a.length 任意 → 不再折
    // {0..8} 假上界）
    expect(sig("forShadow").display).toBe("number  #widened throws TypeError");
    // whileShadow 的 throws：`i < a.length`（a.length:any）关系比较 may TypeError
    //（Bug 31 关系算子守卫，原生语义：a.length 可能为 Symbol）；值域不变
    expect(sig("whileShadow").display).toBe("number  #widened throws TypeError");
  });

  it("do-while: body-first semantics preserved (≥1 widen, no more 1..9 cap)", () => {
    // 同 whileShadow：`while (i < a.length)`（Bug 31，a.length:any may Symbol）
    expect(sig("doWhileShadow").display).toBe("number  #widened throws TypeError");
  });

  it("#91: top-level `const re` (regex state rebind) stays excluded — no ReferenceError", () => {
    const rep91 = checkSource("loop-pack-91.js", issue91Src);
    const f4 = rep91.signatures.find((s) => s.name === "f4");
    expect(f4).toBeTruthy();
    // #91 症状面：entry 不再报 may throw ReferenceError；签名保持 sound 布尔并集。
    // throws TypeError（非 ReferenceError）：for-of over any 接收者（files）may
    // TypeError（Bug 6 迭代守卫，原生语义）。
    expect(f4!.display).toBe("true | false  #exact  join(boolean | boolean|boolean) throws TypeError");
    expect(String(f4!.throws)).toContain("TypeError");
    expect(String(f4!.throws)).not.toContain("ReferenceError");
    const sel = rep91.signatures.find((s) => s.name === "selectedByFiles");
    expect(sel).toBeTruthy();
    // Bug 47：体内 `continue`（抽象条件 fork 的 continue 臂冒泡）打断代表
    // 迭代——「先跑任意次（selected 可被置 true）再 continue」的域不可
    // 观测，出口按打断宽化到全域 boolean（sound：native ∈ {true,false}；
    // #91 的回归面是 ReferenceError——仍不得出现）
    expect(sel!.display).toBe("boolean  #widened throws TypeError");
    expect(String(sel!.throws)).toContain("TypeError");
    expect(String(sel!.throws)).not.toContain("ReferenceError");
    const entryThrows = rep91.issues.filter(
      (i) => i.code === "nudo:entry-may-throw" && (i.fn === "f4" || i.fn === "selectedByFiles"),
    );
    // L2 gate 现在因 may TypeError 报错（Bug 6 迭代守卫，原生语义）；
    // #91 的回归面是 ReferenceError——不得再出现。
    expect(entryThrows.every((i) => !String(i.message).includes("ReferenceError"))).toBe(true);
    expect(entryThrows.length).toBeGreaterThan(0);
  });
});
