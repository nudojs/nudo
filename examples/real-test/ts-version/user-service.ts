/**
 * User Service - TypeScript Version
 *
 * Same functionality as the Nudo version, but with full type annotations.
 */

// Type Definitions (REQUIRED for TypeScript)
interface ApiResponse<T> {
  status: number;
  data: T;
}

interface User {
  id: number;
  name: string;
  email: string;
}

interface UserSummary {
  id: number;
  name: string;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  user?: User;
}

interface EnrichedUser extends User {
  displayName: string;
  fetchedAt: number;
}

interface CachedUser {
  id: number;
  name: string;
  source: "cache" | "api";
}

interface Event {
  type: string;
  payload?: unknown;
}

interface ProcessedEvent extends Event {
  processed: boolean;
}

interface EventResult {
  success?: boolean;
  error?: string;
  event?: ProcessedEvent;
}

interface BatchResult {
  id: number;
  name: string;
}

interface RetryResult {
  success: boolean;
  data?: string;
  attempts?: number;
  error?: string;
}

interface Config {
  env: string;
  apiKey: string;
  debug: boolean;
  timestamp: number;
}

interface FormattedResponse<T> {
  success: boolean;
  data: T;
  timestamp: number;
}

interface ApiResponseFormatted<T> {
  formatted: FormattedResponse<T>;
  jsonString: string;
}

interface PermissionResult {
  role: string;
  permissions: string[];
  action: string;
  allowed: boolean;
}

// Dependencies interface (REQUIRED for dependency injection)
interface Dependencies {
  httpClient: (url: string, options: RequestInit) => ApiResponse<unknown>;
  isString: (v: unknown) => v is string;
  isEmail: (v: string) => boolean;
  isNotEmpty: (v: string) => boolean;
  formatName: (user: User) => { displayName: string } & User;
  addTimestamp: (user: User) => { fetchedAt: number } & User;
  cacheGet: (key: string) => User | null;
  cacheSet: (key: string, value: User, ttl: number) => boolean;
  validateEvent: (event: Event) => boolean;
  transformEvent: (event: Event) => ProcessedEvent;
  logEvent: (event: ProcessedEvent) => ProcessedEvent;
  isValidUser: (user: User) => boolean;
  summarize: (user: User) => UserSummary;
  fetchWithRetry: (url: string, retries: number) => { data: string; attempts: number };
  getEnv: (key: string) => string;
  getSecret: (key: string) => string;
  formatResponse: <T>(data: T) => FormattedResponse<T>;
  getUserRole: (userId: number) => string;
  getPermissions: (role: string) => string[];
  hasPermission: (permissions: string[], action: string) => boolean;
}

// 1. API Client with dependency injection
function fetchUser(
  url: string,
  options: RequestInit,
  deps: Pick<Dependencies, 'httpClient'>
): User | { error: string; status: number } {
  const response = deps.httpClient(url, options);
  if (response.status !== 200) {
    return { error: "Request failed", status: response.status };
  }
  return response.data as User;
}

// 2. Data Validator with multiple mock dependencies
function validateUser(
  user: { name: string; email: string },
  deps: Pick<Dependencies, 'isString' | 'isEmail' | 'isNotEmpty'>
): ValidationResult {
  if (!deps.isString(user.name) || !deps.isNotEmpty(user.name)) {
    return { valid: false, error: "Invalid name" };
  }
  if (!deps.isString(user.email) || !deps.isEmail(user.email)) {
    return { valid: false, error: "Invalid email" };
  }
  return { valid: true, user: user as User };
}

// 3. Data Transformer with chaining
function enrichUser(
  user: User,
  deps: Pick<Dependencies, 'formatName' | 'addTimestamp'>
): EnrichedUser {
  const formatted = deps.formatName(user);
  const withTimestamp = deps.addTimestamp(formatted);
  return withTimestamp as EnrichedUser;
}

// 4. Cache with strategy pattern
function getCachedUser(
  userId: number | string,
  deps: Pick<Dependencies, 'cacheGet' | 'cacheSet'>
): CachedUser {
  const cacheKey = `user:${userId}`;
  const cached = deps.cacheGet(cacheKey);
  if (cached) {
    return { ...cached, source: "cache" };
  }
  const user: User = { id: userId as number, name: "Fresh User", email: "" };
  deps.cacheSet(cacheKey, user, 3600);
  return { ...user, source: "api" };
}

// 5. Event Dispatcher with middleware chain
function dispatchEvent(
  event: Event,
  deps: Pick<Dependencies, 'validateEvent' | 'transformEvent' | 'logEvent'>
): EventResult {
  if (!deps.validateEvent(event)) {
    return { error: "Invalid event" };
  }
  const transformed = deps.transformEvent(event);
  const logged = deps.logEvent(transformed);
  return { success: true, event: logged };
}

// 6. Batch Processing with filter/map/reduce
function processBatch(
  users: User[],
  deps: Pick<Dependencies, 'isValidUser' | 'summarize'>
): BatchResult[] {
  return users
    .filter(deps.isValidUser)
    .map(deps.summarize);
}

// 7. Error Handler with retry logic
function fetchDataWithRetry(
  url: string,
  maxRetries: number,
  deps: Pick<Dependencies, 'fetchWithRetry'>
): RetryResult {
  try {
    const result = deps.fetchWithRetry(url, maxRetries);
    return { success: true, data: result.data, attempts: result.attempts };
  } catch (error) {
    return { success: false, error: "Max retries exceeded" };
  }
}

// 8. Configuration Builder
function buildConfig(
  deps: Pick<Dependencies, 'getEnv' | 'getSecret'>
): Config {
  return {
    env: deps.getEnv("NODE_ENV"),
    apiKey: deps.getSecret("API_KEY"),
    debug: deps.getEnv("NODE_ENV") === "development",
    timestamp: Date.now(),
  };
}

// 9. Response Formatter with JSON
function formatApiResponse<T>(
  data: T,
  deps: Pick<Dependencies, 'formatResponse'>
): ApiResponseFormatted<T> {
  const response = deps.formatResponse(data);
  const json = JSON.stringify(response);
  return { formatted: response, jsonString: json };
}

// 10. Permission Checker with complex logic
function checkPermission(
  userId: number,
  action: string,
  deps: Pick<Dependencies, 'getUserRole' | 'getPermissions' | 'hasPermission'>
): PermissionResult {
  const role = deps.getUserRole(userId);
  const permissions = deps.getPermissions(role);
  const allowed = deps.hasPermission(permissions, action);
  return { role, permissions, action, allowed };
}

// Mock implementations (REQUIRED for TypeScript to run tests)
const mockDeps: Dependencies = {
  httpClient: (url, options) => ({ status: 200, data: { id: 1, name: "Alice", email: "alice@example.com" } }),
  isString: (v): v is string => typeof v === "string",
  isEmail: (v) => v.includes("@"),
  isNotEmpty: (v) => v.length > 0,
  formatName: (user) => ({ ...user, displayName: user.name.toUpperCase() }),
  addTimestamp: (user) => ({ ...user, fetchedAt: Date.now() }),
  cacheGet: (key) => ({ id: 1, name: "Cached User", email: "cached@example.com" }),
  cacheSet: (key, value, ttl) => true,
  validateEvent: (event) => event.type !== undefined,
  transformEvent: (event) => ({ ...event, processed: true }),
  logEvent: (event) => event,
  isValidUser: (user) => user.id > 0,
  summarize: (user) => ({ id: user.id, name: user.name }),
  fetchWithRetry: (url, retries) => ({ data: "success", attempts: retries }),
  getEnv: (key) => "production",
  getSecret: (key) => "secret-value",
  formatResponse: (data) => ({ success: true, data, timestamp: Date.now() }),
  getUserRole: (userId) => "admin",
  getPermissions: (role) => ["read", "write", "delete"],
  hasPermission: (permissions, action) => permissions.includes(action),
};

// Test cases (for comparison with Nudo)
export function runTests() {
  // 1. fetchUser
  const userResult = fetchUser("/api/users/1", { method: "GET" }, mockDeps);
  console.log("fetchUser:", userResult);

  // 2. validateUser
  const validResult = validateUser({ name: "Alice", email: "alice@example.com" }, mockDeps);
  const invalidResult = validateUser({ name: "Bob", email: "not-an-email" }, mockDeps);
  console.log("validateUser (valid):", validResult);
  console.log("validateUser (invalid):", invalidResult);

  // 3. enrichUser
  const enriched = enrichUser({ id: 1, name: "Alice", email: "alice@example.com" }, mockDeps);
  console.log("enrichUser:", enriched);

  // 4. getCachedUser
  const cached = getCachedUser(1, mockDeps);
  console.log("getCachedUser:", cached);

  // 5. dispatchEvent
  const eventResult = dispatchEvent({ type: "user.created", payload: { id: 1 } }, mockDeps);
  console.log("dispatchEvent:", eventResult);

  // 6. processBatch
  const batchResult = processBatch([
    { id: 1, name: "Alice", email: "alice@example.com" },
    { id: -1, name: "Invalid", email: "invalid@example.com" },
    { id: 2, name: "Bob", email: "bob@example.com" },
  ], mockDeps);
  console.log("processBatch:", batchResult);

  // 7. fetchDataWithRetry
  const retryResult = fetchDataWithRetry("/api/data", 3, mockDeps);
  console.log("fetchDataWithRetry:", retryResult);

  // 8. buildConfig
  const config = buildConfig(mockDeps);
  console.log("buildConfig:", config);

  // 9. formatApiResponse
  const formatted = formatApiResponse({ users: [{ id: 1 }] }, mockDeps);
  console.log("formatApiResponse:", formatted);

  // 10. checkPermission
  const permResult = checkPermission(1, "delete", mockDeps);
  console.log("checkPermission:", permResult);
}
