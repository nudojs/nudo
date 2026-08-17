/**
 * User Service - Nudo Version
 *
 * Demonstrates real-world usage of @nudo:mock for dependency injection
 * and automatic type inference without TypeScript annotations.
 */

// 1. API Client with dependency injection
// @nudo:mock httpClient = stub().returns({ status: 200, data: { id: 1, name: "Alice", email: "alice@example.com" } })
// @nudo:case "fetch-user" ("/api/users/1", { method: "GET" })
function fetchUser(url, options) {
  const response = httpClient(url, options);
  if (response.status !== 200) {
    return { error: "Request failed", status: response.status };
  }
  return response.data;
}

// 2. Data Validator with multiple mock dependencies
// @nudo:mock isString = (v) => typeof v === "string"
// @nudo:mock isEmail = (v) => v.includes("@")
// @nudo:mock isNotEmpty = (v) => v.length > 0
// @nudo:case "valid" ({ name: "Alice", email: "alice@example.com" })
// @nudo:case "invalid-email" ({ name: "Bob", email: "not-an-email" })
// @nudo:case "missing-name" ({ name: "", email: "alice@example.com" })
function validateUser(user) {
  if (!isString(user.name) || !isNotEmpty(user.name)) {
    return { valid: false, error: "Invalid name" };
  }
  if (!isString(user.email) || !isEmail(user.email)) {
    return { valid: false, error: "Invalid email" };
  }
  return { valid: true, user };
}

// 3. Data Transformer with chaining
// @nudo:mock formatName = (user) => ({ ...user, displayName: user.name.toUpperCase() })
// @nudo:mock addTimestamp = (user) => ({ ...user, fetchedAt: Date.now() })
// @nudo:case "transform" ({ id: 1, name: "Alice", email: "alice@example.com" })
function enrichUser(user) {
  const formatted = formatName(user);
  const withTimestamp = addTimestamp(formatted);
  return withTimestamp;
}

// 4. Cache with strategy pattern
// @nudo:mock cacheGet = (key) => ({ id: 1, name: "Cached User" })
// @nudo:mock cacheSet = (key, value, ttl) => true
// @nudo:case "cache-hit" ("user:1")
// @nudo:case "cache-miss" ("user:999")
function getCachedUser(userId) {
  const cacheKey = `user:${userId}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return { ...cached, source: "cache" };
  }
  // Simulate fetch
  const user = { id: userId, name: "Fresh User" };
  cacheSet(cacheKey, user, 3600);
  return { ...user, source: "api" };
}

// 5. Event Dispatcher with middleware chain
// @nudo:mock validateEvent = (event) => event.type !== undefined
// @nudo:mock transformEvent = (event) => ({ ...event, processed: true })
// @nudo:mock logEvent = (event) => event
// @nudo:case "dispatch" ({ type: "user.created", payload: { id: 1 } })
function dispatchEvent(event) {
  if (!validateEvent(event)) {
    return { error: "Invalid event" };
  }
  const transformed = transformEvent(event);
  const logged = logEvent(transformed);
  return { success: true, event: logged };
}

// 6. Batch Processing with filter/map/reduce
// @nudo:mock isValidUser = (user) => user.id > 0
// @nudo:mock summarize = (user) => ({ id: user.id, name: user.name })
// @nudo:case "batch" ([{ id: 1, name: "Alice" }, { id: -1, name: "Invalid" }, { id: 2, name: "Bob" }])
function processBatch(users) {
  return users
    .filter(isValidUser)
    .map(summarize);
}

// 7. Error Handler with retry logic
// @nudo:mock fetchWithRetry = (url, retries) => ({ data: "success", attempts: retries })
// @nudo:case "retry" ("/api/data", 3)
function fetchDataWithRetry(url, maxRetries) {
  try {
    const result = fetchWithRetry(url, maxRetries);
    return { success: true, data: result.data, attempts: result.attempts };
  } catch (error) {
    return { success: false, error: "Max retries exceeded" };
  }
}

// 8. Configuration Builder
// @nudo:mock getEnv = (key) => "production"
// @nudo:mock getSecret = (key) => "secret-value"
// @nudo:case "config" ()
function buildConfig() {
  return {
    env: getEnv("NODE_ENV"),
    apiKey: getSecret("API_KEY"),
    debug: getEnv("NODE_ENV") === "development",
    timestamp: Date.now(),
  };
}

// 9. Response Formatter with JSON
// @nudo:mock formatResponse = (data) => ({ success: true, data, timestamp: Date.now() })
// @nudo:case "format" ({ users: [{ id: 1 }] })
function formatApiResponse(data) {
  const response = formatResponse(data);
  const json = JSON.stringify(response);
  return { formatted: response, jsonString: json };
}

// 10. Permission Checker with complex logic
// @nudo:mock getUserRole = (userId) => "admin"
// @nudo:mock getPermissions = (role) => ["read", "write", "delete"]
// @nudo:mock hasPermission = (permissions, action) => permissions.includes(action)
// @nudo:case "admin-delete" (1, "delete")
// @nudo:case "admin-read" (1, "read")
function checkPermission(userId, action) {
  const role = getUserRole(userId);
  const permissions = getPermissions(role);
  const allowed = hasPermission(permissions, action);
  return { role, permissions, action, allowed };
}

// 11. Async data fetching with built-in APIs
// @nudo:mock apiCall = stub().resolves({ users: [{ id: 1 }] })
// @nudo:case "async-users" ()
async function fetchUsers() {
  const data = await apiCall();
  return data.users;
}

// 12. Map-based cache with built-in Map
// @nudo:case "map-cache" ()
function initCache() {
  const cache = new Map();
  cache.set("key", { data: "value" });
  return cache.get("key");
}

// 13. Set-based deduplication
// @nudo:case "dedup" ([1, 2, 2, 3])
function dedup(items) {
  const seen = new Set(items);
  return seen.has(2);
}

// 14. URL parsing with built-in URL
// @nudo:case "parse-url" ()
function parseUrl() {
  const url = new URL("https://api.example.com/users?page=1");
  return { path: url.pathname, query: url.search };
}

// 15. RegExp matching
// @nudo:case "match" ("hello world")
function matchPattern(str) {
  return /hello/.test(str);
}

// 16. Promise.all for parallel fetching
// @nudo:case "parallel" ()
function fetchParallel() {
  return Promise.all([Promise.resolve(1), Promise.resolve("two")]);
}
