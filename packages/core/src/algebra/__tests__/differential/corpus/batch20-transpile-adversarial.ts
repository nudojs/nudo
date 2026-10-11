/**
 * 转译对抗形态（batch20）：同行多语句 / 压缩单行程序 / 同行嵌套块与 try
 * 组合 / 同行解构与生成器。
 * 背景：Bug 42（同一行两个 try 的 `__nudoTm_<line>` 行号寻址重名 → 重复
 * const 声明 → 整模块 SyntaxError fail-closed）已修——stmt.ts 改用
 * tryTmpSeq 单调计数；解构临时 `_d${seq}_${line}` 同类问题也已改单调
 * 计数（types.ts 注释）。本批把「行号/压缩风格对抗」形态钉进差分门禁：
 * minified / 生成代码常见的单行多语句必须与 native 对账一致。
 */
export const sameLineTry = [
  // Bug 42 核心形态：同一作用域、同一行多条 try（临时名不得再按行号寻址）
  "try { 1; } catch (e) {} try { 2; } catch (e) {} return \"done\";",
  "try { 1; } catch (e) {} try { 2; } finally {} return \"done\";",
  "try { 1; } finally {} try { 2; } catch (e) {} return \"done\";",
  "try { 1; } finally {} try { 2; } finally {} return \"done\";",
  "try { 1; } catch (e) {} try { 2; } catch (e) {} try { 3; } catch (e) {} return \"done\";",
  "let r = ''; try { r += 'a'; } catch (e) { r += 'x'; } try { r += 'b'; } catch (e) { r += 'y'; } return r;",
  "let r = ''; try { throw 1; } catch (e) { r += e; } try { throw 2; } catch (e) { r += e; } return r;",
  "let r = ''; try { r += 't'; } finally { r += 'f'; } try { r += 'T'; } finally { r += 'F'; } return r;",
  "try { throw 'a'; } catch { return 'c1'; } try { throw 'b'; } catch { return 'c2'; } return 'z';",
  "try { throw new Error('e1'); } catch (e) { return e.message; } try { throw new Error('e2'); } catch (e) { return e.message; } return 'z';",
  "let n = 0; while (n < 1) { try { n = 1; } catch (e) {} try { n = 2; } catch (e) {} } return n;",
  "const f = () => { try { 1; } catch (e) {} try { 2; } catch (e) {} return \"ok\"; }; return f();",
  "function g() { try { 1; } catch (e) {} try { 2; } catch (e) {} return \"g\"; } return g();",
  "try { return 1; } finally { } try { return 2; } finally { } return 3;",
  "try { throw 1; } catch (e) { return 'a'; } finally { } try { throw 2; } catch (e) { return 'b'; } finally { } return 'z';",
  "try { 1; } catch (e) {} try { 2; } catch (e) {} try { 3; } catch (e) {} try { 4; } catch (e) {} try { 5; } catch (e) {} return \"five\";",
  // 以下两行 = 合法 skip（钉在 skip-baseline.json）：catch 参数位**解构**对抛出值
  // 不折字面量（返回非具体 Abs，fail-closed），对照行 catch (e) + 成员读精确。
  // 精度缺口未编号；修复后基线收缩告警会提示收紧。
  "try { throw [1, 2]; } catch ([a, b]) { return a + b; } return 0;",
  "try { throw {v: 9}; } catch ({v}) { return v; } return 0;",
  "try { throw [1, 2]; } catch (e) { return e[0] + e[1]; } return 0;",
  "try { throw {v: 9}; } catch (e) { return e.v; } return 0;",
];

export const sameLineTryNested = [
  // 同行嵌套 try：catch 体 / finally 体内再嵌 try、finally 覆盖返回值
  "try { try { throw 1; } catch (e) { throw 2; } } catch (e) { return e; }",
  "try { try { throw 5; } finally { } } catch (e) { return e; }",
  "let r = ''; try { r += 'a'; throw 1; } catch (e) { r += 'b'; } finally { r += 'c'; } try { r += 'd'; } catch (e) { r += 'x'; } finally { r += 'e'; } return r;",
  "let r = ''; try { try { r += 'i'; } finally { r += 'f'; } } finally { r += 'F'; } return r;",
  "try { try { throw new Error('deep'); } catch (e) { throw new Error('outer:' + e.message); } } catch (e) { return e.message; }",
  "try { throw 1; } catch (e) { try { throw e + 1; } catch (e2) { return e2; } }",
  "let r = ''; try { r += 'a'; } finally { try { r += 'f'; } catch (e) { r += 'x'; } } return r;",
  "try { throw 1; } catch (e) { return 'c'; } finally { return 'f'; } return 'z';",
];

export const compressedOneLiner = [
  // 压缩单行程序：声明 + 调用 + 返回挤一行（minified 风格）
  "const add = (a, b) => a + b; const x = add(1, 2); return x * add(3, 4);",
  "function sq(n) { return n * n; } return [1, 2, 3].map(sq)[2];",
  "let n = 0; const inc = () => n++; inc(); inc(); inc(); return n;",
  "let a = 1, b = 2, c = a + b; return c * 2;",
  "const o = {n: 1}; o.n++; o.n += 5; return o.n;",
  "let s = ''; s += 'a'; s += 'b'; s += 'c'; return s.length;",
  "const arr = []; arr.push(1, 2); arr.push(arr.length); return arr.join('-');",
  "let x = 0; if (1 > 2) x = 1; else if (2 > 3) x = 2; else x = 3; return x;",
  "const r = (function () { return 5; })(); const g = (() => 6)(); return r + g;",
  "let s = 0; for (let i = 0; i < 5; i++) s += i; return s;",
  "let s = ''; for (const c of 'abc') s += c.toUpperCase(); return s;",
  "const t = (s, v) => s[0] + v * 2; return t`x${5}`;",
  "let a = 0; const r = (a = 1, a + 2, a * 3); return '' + a + ',' + r;",
  "const a = 1, b = 2; return `${a}+${b}=${a + b}`;",
  "return hoisted(); function hoisted() { return 'h'; }",
  "const v = 2; return v === 1 ? 'a' : v === 2 ? 'b' : 'c';",
  "const r = []; if (1) { if (1) { if (1) { r.push(1); } else { r.push(2); } } else { r.push(3); } } else { r.push(4); } return r.length;",
  "let a = 0, b = 0; (a = 1, b = 2); return a + b;",
  "const s = `t{1}x;${2 + 3}`; return s;",
  "return /* mid */ 5;",
];

export const sameLineBlocks = [
  // 同行嵌套块：裸块 / if 块 / case 块 / label 块同行组合
  "{ let a = 1; } { let b = 2; } return 3;",
  "let a = 1; { let a = 2; } return a;",
  "if (1) { { return 7; } } return 0;",
  "if (true) { let x = 1; } else { let x = 2; } return 5;",
  "{ try { throw 1; } catch (e) { return e; } }",
  "if (1) if (0) return 1; else return 2; return 3;",
  "switch (1) { case 1: { let v = 9; } } return 6;",
  "let x = 0; switch (2) { case 1: case 2: x = 1; case 3: x += 5; break; default: x = 9; } return x;",
  "let z = 0; L1: L2: z = 5; return z;",
  "blk: { break blk; } return 8;",
];

export const sameLineDestructure = [
  // 同行解构：两条解构同行（_d 临时名不得按行号寻址重名）、嵌套/交换/参数位
  "const {a, b} = {a: 1, b: 2}; const [x, y] = [3, 4]; return a + b + x + y;",
  "const [p, ...q] = [1, 2, 3]; return p + q.length;",
  "const {a: {b}} = {a: {b: 7}}; return b;",
  "const f = ({x, y}) => x + y; return f({x: 1, y: 2});",
  "let a = 1, b = 2; [a, b] = [b, a]; return '' + a + b;",
  "let s = 0; for (const [i, v] of [[0, 10], [1, 20]]) s += i + v; return s;",
  "let s = 0; for (const [a] of [[1]]) s += a; for (const [b] of [[2]]) s += b; return s;",
  "const [{m}] = [{m: 4}]; const {n: {k}} = {n: {k: 6}}; return m + k;",
  "function h([a, b], {c}) { return a + b + c; } return h([1, 2], {c: 3});",
];

export const sameLineGenAndFn = [
  // 同行生成器 / 函数声明 / 递归 / 存取器 / 类压缩风
  "function* r() { yield 1; yield 2; yield 3; } return [...r()].join('-');",
  "function* g() { yield 1; yield 2; } const it = g(); it.next(); return it.next().value;",
  "function* cnt(n) { while (n > 0) { yield n; n--; } } return [...cnt(3)].join(',');",
  "function* g2() { yield* [1, 2]; } return [...g2()].join('+');",
  "const gen = (function* () { yield 7; })(); return gen.next().value;",
  "function a() { return 1; } function b() { return 2; } return a() + b();",
  "const add = a => b => a + b; return add(1)(2);",
  "const f = function rec(n) { return n < 2 ? 1 : n * rec(n - 1); }; return f(5);",
  "const f = (a = 5, ...r) => a + r.length; return f() + f(1, 2, 3);",
  "const o = { v: 0, get x() { return this.v * 2; }, set x(n) { this.v = n; } }; o.x = 5; return o.x;",
  "class C { constructor() { this.n = 1; } bump() { this.n++; return this; } } return new C().bump().bump().n;",
];

export const sameLineControl = [
  // 同行控制流：do-while / label continue / 逗号 for 头 / 逻辑赋值 / 可选调用
  "let n = 0; do n++; while (n < 3); return n;",
  "let s = ''; outer: for (const c of 'ab') { for (const d of 'xy') { if (d === 'x') continue outer; s += c + d; } } return s;",
  "let i = 0, j = 5, r = ''; for (i = 0, j = 5; i < 3; i++, j -= 2) r += j; return r;",
  "let a = 0, b = 0; a ||= 7; b &&= 9; return a + b;",
  "const f = null; return f?.() ?? 'nf';",
  "while (true) { break; } return 'b';",
  "for (const _ of []) {} return 'empty';",
  "return (2 ** 3 ** 2);",
];

export const sameLineTryControlFlow = [
  // 控制流跨 try 边界（break/continue/label 穿过 try 体）
  "for (const x of [1, 2, 3]) { try { break; } catch (e) {} } return 'b';",
  "outer: for (const x of [1]) { try { break outer; } catch (e) {} } return 'L';",
  "let n = 0; while (n < 5) { try { n++; if (n === 2) continue; n += 10; } catch (e) {} } return n;",
  "outer2: for (const x of [1, 2]) { try { continue outer2; } catch (e) {} } return 'd';",
  "for (const x of [1, 2]) { try { return x; } finally { } } return 0;",
  "try { const f = () => 5; return f(); } catch (e) { return 0; }",
  "const f = () => () => { try { return 'in'; } catch (e) { return 'c'; } }; return f()();",
  "try { switch (1) { case 1: return 'one'; } return 'no'; } catch (e) { return 'c'; }",
  "try { return new Map([[1, 'a']]).get(1); } catch (e) { return 'c'; }",
  "class C { m() { try { throw 1; } catch (e) { return e; } try { return 2; } finally {} } } return new C().m();",
  "const o = { get g() { try { 1; } catch (e) {} try { return 9; } finally {} return 0; } }; return o.g;",
  "class S { static v() { try { return 4; } catch (e) { return 0; } } } return S.v();",
  "const o2 = { get a() { return 1; }, get b() { return 2; } }; return o2.a + o2.b;",
  "const k = 'x'; const o3 = { [k]: 1, [k + 'y']: 2 }; return o3.x + o3.xy;",
  "class A {} class B extends A {} return new B() instanceof A;",
  "let n = 0; for (;;) { n++; if (n === 3) break; } return n;",
  "let n = 0; do { n++; } while (n < 3); return n;",
  // do-while 体含 continue = 合法 skip（钉在 skip-baseline.json）：循环出口 join
  // 对 n 折非具体（fail-closed）。无 continue 的 do-while（上行）精确对照。
  // 精度缺口未编号；修复后基线收缩告警会提示收紧。
  "let n = 0; do { n++; if (n === 1) continue; n += 10; } while (n < 3); return n;",
  "A: { try { B: { break A; } } catch (e) {} } return 'x';",
  "let r=/a/.test('a');return r;",
];
