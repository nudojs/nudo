/**
 * E7 原始类型赋值：let n = 1 后 n = "str"。
 * pnpm run check docs/examples/errors/07-prim-assign.js
 */
export let n = 1;
n = 2;      // ok
n = "str";  // error: number ⊭ string
