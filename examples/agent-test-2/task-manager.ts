/**
 * Task Manager - TypeScript version for comparison
 */

interface Task {
  id: string;
  title: string;
  description: string;
  priority: 1 | 2 | 3;
  status: "todo" | "inProgress" | "done";
  createdAt: number;
  tags: string[];
}

interface ValidationResult {
  valid: boolean;
  task?: Task;
  errors?: string[];
}

interface BatchResult {
  created: Task[];
  count: number;
}

interface PriorityQueue {
  high: string[];
  medium: string[];
  low: string[];
  total: number;
}

interface TaskLookupResult {
  found: Task | undefined;
  missing: Task | undefined;
}

interface TagStats {
  uniqueTags: string[];
  tagCount: number;
}

interface FetchResult {
  success: boolean;
  tasks?: Task[];
  error?: string;
}

interface TransformResult {
  id: string;
  displayTitle: string;
  priorityLabel: string;
  isComplete: boolean;
}

interface UpdateResult {
  success: boolean;
  task?: Task;
  error?: string;
}

interface Summary {
  total: number;
  byStatus: { todo: number; inProgress: number; done: number };
  completionRate: string;
}

export function createNewTask(title: string, description: string, priority: 1 | 2 | 3): Task {
  const task: Task = {
    id: "task-001",
    title,
    description,
    priority,
    status: "todo",
    createdAt: 1000,
    tags: [],
  };
  return task;
}

export function validateAndProcessTask(task: Partial<Task>): ValidationResult {
  const errors: string[] = [];

  if (!task.id || task.id.length === 0) {
    errors.push("Task ID is required");
  }
  if (!task.title || task.title.length === 0) {
    errors.push("Task title is required");
  }
  if (task.priority !== undefined && (task.priority < 1 || task.priority > 3)) {
    errors.push("Priority must be 1-3");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, task: task as Task };
}

export function batchCreateTasks(titles: string[]): BatchResult {
  const created: Task[] = titles.map(title => ({
    id: "task-" + title,
    title,
    status: "todo" as const,
    priority: 2 as const,
    createdAt: 1000,
    description: "",
    tags: [],
  }));

  return { created, count: created.length };
}

export function organizeByPriority(tasks: Task[]): PriorityQueue {
  const high: string[] = [];
  const medium: string[] = [];
  const low: string[] = [];

  for (const task of tasks) {
    if (task.priority === 1) {
      high.push(task.title);
    } else if (task.priority === 2) {
      medium.push(task.title);
    } else {
      low.push(task.title);
    }
  }

  return {
    high,
    medium,
    low,
    total: tasks.length,
  };
}

export function setupTaskLookup(tasks: Task[]): TaskLookupResult {
  const taskMap = new Map<string, Task>();

  for (const task of tasks) {
    taskMap.set(task.id, task);
  }

  return {
    found: taskMap.get("task-001"),
    missing: taskMap.get("nonexistent"),
  };
}

export function collectTagStats(tasks: Task[]): TagStats {
  const tagSet = new Set<string>();

  for (const task of tasks) {
    for (const tag of task.tags) {
      tagSet.add(tag);
    }
  }

  return {
    uniqueTags: Array.from(tagSet),
    tagCount: tagSet.size,
  };
}

export async function fetchTasksFromAPI(): Promise<FetchResult> {
  try {
    const response = {
      ok: true,
      data: [{ id: "t1", title: "Task 1" } as Task, { id: "t2", title: "Task 2" } as Task],
    };

    if (response.ok) {
      return { success: true, tasks: response.data };
    }

    return { success: false, error: "Request failed" };
  } catch (err) {
    return { success: false, error: "Network error" };
  }
}

export async function fetchDashboardData(): Promise<[Task[], { count: number }, { active: number }]> {
  const [tasks, stats, activity] = await Promise.all([
    Promise.resolve([{ id: "t1", title: "Task 1" } as Task]),
    Promise.resolve({ count: 42 }),
    Promise.resolve({ active: 5 }),
  ]);

  return [tasks, stats, activity];
}

export function transformTask(task: Task): TransformResult {
  return {
    id: task.id,
    displayTitle: task.title.toUpperCase(),
    priorityLabel: task.priority === 1 ? "critical" : task.priority === 2 ? "normal" : "low",
    isComplete: task.status === "done",
  };
}

export function safeUpdateTask(task: Task, updates: Partial<Task>): UpdateResult {
  try {
    if (task.status === "done" && updates.status !== "done") {
      throw new Error("Cannot reopen completed task");
    }

    const updated = { ...task, ...updates };
    return { success: true, task: updated };
  } catch (err) {
    return { success: false, error: "Update failed" };
  }
}

export function searchTasks(tasks: Task[], query: string): Task[] {
  const lowerQuery = query.toLowerCase();

  return tasks.filter(task =>
    task.title.toLowerCase().includes(lowerQuery) ||
    task.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
}

export function generateSummary(tasks: Task[]): Summary {
  const byStatus = { todo: 0, inProgress: 0, done: 0 };

  for (const task of tasks) {
    if (task.status === "todo") byStatus.todo++;
    else if (task.status === "inProgress") byStatus.inProgress++;
    else if (task.status === "done") byStatus.done++;
  }

  const completionRate = tasks.length > 0
    ? (byStatus.done / tasks.length * 100).toFixed(1) + "%"
    : "N/A";

  return {
    total: tasks.length,
    byStatus,
    completionRate,
  };
}
