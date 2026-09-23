/**
 * E3 重赋值丢槽：TS 靠 inferred 对象类型；Nudo 报 assign-mismatch + missing slot。
 * pnpm run check docs/examples/errors/03-assign-missing.js
 */
export let config = { host: "localhost", port: 8080 };

config = { host: "api", port: 3000 }; // ok
config = { host: "y" };               // error: missing slot port
