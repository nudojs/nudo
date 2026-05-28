/**
 * Debug the 4 specific issues
 */

/**
 * Issue 1: array.length on parameter
 * @nudo:case "length-test" ([1, 2, 3])
 * @nudo:returns 3
 */
export function lengthTest(arr) {
  return arr.length;
}

/**
 * Issue 2: for...of element type
 * @nudo:case "forof-test" ([1, 2, 3])
 * @nudo:returns [1, 2, 3]
 */
export function forofTest(arr) {
  const result = [];
  for (const item of arr) {
    result.push(item);
  }
  return result;
}

/**
 * Issue 3: Map generic tracking
 * @nudo:case "map-test" ()
 * @nudo:returns { value: "hello" | undefined }
 */
export function mapTest() {
  const map = new Map();
  map.set("key1", "hello");
  map.set("key2", "world");
  return { value: map.get("key1") };
}

/**
 * Issue 4: Array.from(Set)
 * @nudo:case "arrayfrom-test" ()
 * @nudo:returns ["a", "b", "c"]
 */
export function arrayFromTest() {
  const set = new Set();
  set.add("a");
  set.add("b");
  set.add("c");
  return Array.from(set);
}
