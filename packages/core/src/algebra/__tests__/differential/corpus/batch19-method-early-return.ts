/**
 * 方法体早退 if 回归金丝雀（batch19）。
 * 背景：ObjectMethod / ClassMethod / 属性位 FunctionExpression 曾逐语句
 * map(transpileStatement)，绕过 transpileFnBodyStmts 早退提升——
 * `if (c) return X; return Y` 的 X 被语句级 $fork thunk 吞掉，恒折 Y。
 */
export const objectMethodEarlyReturn = [
  "const o = { d(n) { if (n <= 0) { return 0; } return 1; } }; return o.d(0)",
  "const o = { d(n) { if (n <= 0) { return 0; } return 1; } }; return o.d(-1)",
  "const o = { d(n) { if (n <= 0) { return 0; } return 1; } }; return o.d(5)",
  "const o = { d: function (n) { if (n <= 0) { return 0; } return 1; } }; return o.d(0)",
  "const o = { cmp(a, b) { if (a > b) { return 1; } if (a < b) { return -1; } return 0; } }; return o.cmp(2, 1)",
  "const o = { cmp(a, b) { if (a > b) { return 1; } if (a < b) { return -1; } return 0; } }; return o.cmp(1, 2)",
  "const o = { cmp(a, b) { if (a > b) { return 1; } if (a < b) { return -1; } return 0; } }; return o.cmp(1, 1)",
  "const o = { d(n) { if (n <= 0) { return 0; } return this.d(n - 1); } }; return o.d(0)",
  "const o = { d(n) { if (n <= 0) { return 0; } return this.d(n - 1); } }; return o.d(3)",
  "const o = { n: 5, getN() { return this.n; }, pick(n) { if (n) { return this.getN(); } return 0; } }; return o.pick(1)",
  "const o = { n: 5, getN() { return this.n; }, pick(n) { if (n) { return this.getN(); } return 0; } }; return o.pick(0)",
];

export const classMethodEarlyReturn = [
  "class C { d(n) { if (n <= 0) { return 0; } return 1; } } return new C().d(0)",
  "class C { d(n) { if (n <= 0) { return 0; } return 1; } } return new C().d(5)",
  "class C { static d(n) { if (n <= 0) { return 0; } return 1; } } return C.d(0)",
  "class C { static d(n) { if (n <= 0) { return 0; } return 1; } } return C.d(5)",
  "class C { d(n) { if (n <= 0) { return 0; } return this.d(n - 1); } } return new C().d(4)",
  "class C { constructor() { this.n = 0; } bump() { if (this.n > 0) { return this.n; } this.n = 1; return this.n; } } return new C().bump()",
  "class C { get x() { if (1) { return 7; } return 0; } } return new C().x",
  "class C { set x(v) { if (v < 0) { return; } this._v = v; } get x() { return this._v; } } const c = new C(); c.x = 3; return c.x",
];
