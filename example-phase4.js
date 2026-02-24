/**
 * @nudo:case "concrete" (1, 2)
 * @nudo:case "symbolic" (T.number, T.number)
 */
function add(a, b) {
  return a + b;
}

/**
 * @nudo:case "concrete" ({ name: "Alice", age: 30 })
 * @nudo:case "symbolic" (T.object({ name: T.string, age: T.number }))
 */
function greet({ name, age }) {
  return `Hello, ${name}! You are ${age} years old.`;
}

/**
 * @nudo:case "valid" (10)
 * @nudo:case "negative" (-1)
 */
function safeSqrt(x) {
  if (x < 0) {
    throw new RangeError("negative input");
  }
  return x;
}

/**
 * @nudo:case "test" ()
 */
function testSafeSqrt() {
  const result1 = safeSqrt(10);
  console.log("safeSqrt(10) done", result1);
  const result2 = safeSqrt(-1);
  console.log("dead code", result2);
}

/**
 * @nudo:case "test" ()
 */
async function fetchData() {
  const data = await Promise.resolve(42);
  return data;
}
