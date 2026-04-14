/**
 * Topological sort for agentic workflow tasks based on dep field.
 *
 * Uses Kahn's algorithm (in-degree based) for stable topological ordering.
 * Tasks without dep maintain their relative order.
 * Output tasks are always placed at the end.
 */

import type { AgenticTask } from '../types.js';
import { Logger } from '@modular-prompt/utils';

const logger = new Logger({ prefix: 'process', context: 'agentic', accumulate: true });

/**
 * Topologically sort tasks based on their dep field.
 *
 * - Tasks with no dep are treated as having in-degree 0.
 * - Among tasks with equal priority, original array order is preserved (stable).
 * - Output tasks are excluded from sorting and appended at the end.
 * - Circular dependencies: warns and returns original order.
 * - Missing dep references: warns and ignores.
 */
export function topologicalSortTasks(tasks: AgenticTask[]): AgenticTask[] {
  if (tasks.length <= 1) return tasks;

  // Separate output tasks
  const outputTasks: AgenticTask[] = [];
  const sortable: AgenticTask[] = [];
  for (const task of tasks) {
    if (task.taskType === 'output') {
      outputTasks.push(task);
    } else {
      sortable.push(task);
    }
  }

  if (sortable.length <= 1) return [...sortable, ...outputTasks];

  // Build name → index map
  const nameToIndex = new Map<string, number>();
  for (let i = 0; i < sortable.length; i++) {
    const name = sortable[i].name;
    if (name) nameToIndex.set(name, i);
  }

  // Build adjacency list and in-degree array
  const adj: number[][] = sortable.map(() => []);
  const inDegree = new Array(sortable.length).fill(0);

  for (let i = 0; i < sortable.length; i++) {
    const deps = sortable[i].dep;
    if (!deps) continue;
    for (const depName of deps) {
      const depIdx = nameToIndex.get(depName);
      if (depIdx === undefined) {
        logger.warn(`[toposort] Task "${sortable[i].name}" depends on "${depName}" which does not exist, ignoring`);
        continue;
      }
      // depIdx → i (depIdx must come before i)
      adj[depIdx].push(i);
      inDegree[i]++;
    }
  }

  // Kahn's algorithm with stable ordering (use original index as tiebreaker)
  const queue: number[] = [];
  for (let i = 0; i < sortable.length; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  const result: AgenticTask[] = [];
  while (queue.length > 0) {
    // Pick the task with the smallest original index (stable sort)
    let minIdx = 0;
    for (let j = 1; j < queue.length; j++) {
      if (queue[j] < queue[minIdx]) minIdx = j;
    }
    const idx = queue.splice(minIdx, 1)[0];
    result.push(sortable[idx]);

    for (const neighbor of adj[idx]) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor);
      }
    }
  }

  // Circular dependency check
  if (result.length !== sortable.length) {
    const unresolved = sortable
      .filter((_, i) => inDegree[i] > 0)
      .map(t => t.name || '(unnamed)')
      .join(', ');
    logger.warn(`[toposort] Circular dependency detected among: ${unresolved}. Using original order.`);
    return tasks;
  }

  return [...result, ...outputTasks];
}
