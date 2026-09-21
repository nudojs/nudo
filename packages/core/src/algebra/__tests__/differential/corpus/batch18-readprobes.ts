/**
 * concrete() 盲区读层补探：结果 open / 含 undefined 元素时整值不可比，
 * 读具体槽位折叠成字面量走正常比较。与 bpath-*.test.ts parity describe
 * 互补——本批（loop-fix 第 18 批）六类修复的回归金丝雀。
 */
export const readProbes = [
  "const s = Object.assign({}, new String('ab')); return s['0'] + s['1']",
  "let t = {a: 1}; const u = t; Object.assign(t, {b: 2}); return u.b",
  "const o = Object.assign({}, '\\uD83D\\uDE00'); return o['0'] + o['1']",
  "return [...new Array(3).keys()][2]",
  "let c = 0; for (const v of [1,,3].values()) { if (v === undefined) c++; } return c",
  "return [...[1,,3].entries()][1][0]",
  "const t = [9,9]; Object.assign(t, 'xy'); return t[0] + t[1] + t.length",
  "return Object.keys(Object.assign({}, [7,,9])).length",
  "let x = 7; x >>= 1; let y = 2; y **= 10; return '' + x + ',' + y",
  "return new String('ab')['0'] + new String('ab').length",
  "let r = 0; [1,,3].forEach((v, i) => { if (i === 1) r++; }); return r",
  "return [...[1,,3].values()][1] === undefined",
  "const a = [1,2]; const b = a; b[0] |= 4; return a[0] * 10 + a[1]",
  "let t = {a: 1}; Object.assign(t, {b: 2}); return t.b + t.a",
];
