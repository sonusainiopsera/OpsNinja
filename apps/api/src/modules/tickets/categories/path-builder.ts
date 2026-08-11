/**
 * Pure path-builder and cycle-detection utilities for the categories tree.
 *
 * These functions operate on plain node records and have no I/O side effects.
 * All path operations use the slug chain format: "pipeline/jenkins-integration".
 */

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

/**
 * Derives a URL-safe slug from a human-readable category name.
 * - lower-case
 * - trim leading/trailing whitespace
 * - replace non-alphanumeric characters with hyphens
 * - collapse consecutive hyphens
 * - strip leading/trailing hyphens
 */
export function buildSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Path computation
// ---------------------------------------------------------------------------

/**
 * Constructs the materialised path for a node given its parent's path.
 * If parentPath is null or empty the node is a root node (path === slug).
 */
export function buildPath(parentPath: string | null | undefined, slug: string): string {
  if (!parentPath) return slug;
  return `${parentPath}/${slug}`;
}

/**
 * Recomputes the path for a node and all its descendants when the node is
 * moved to a new parent. Returns an array of { id, path, depth } updates.
 *
 * @param nodes      Flat array of all nodes in the moving subtree (including the root).
 * @param movedId    ID of the node being moved.
 * @param oldPath    Current materialised path of the moved node.
 * @param newParentPath  Path of the new parent (null for root).
 * @param slug       Slug of the moved node (unchanged during reparent).
 * @param newParentDepth Depth of the new parent (-1 for root level).
 */
export function recomputeSubtreePaths(
  nodes: ReadonlyArray<{ id: string; path: string; depth: number }>,
  movedId: string,
  oldPath: string,
  newParentPath: string | null,
  slug: string,
  newParentDepth: number,
): Array<{ id: string; path: string; depth: number }> {
  const newNodePath = buildPath(newParentPath, slug);
  const depthDelta = newParentDepth + 1 - nodes.find((n) => n.id === movedId)!.depth;

  return nodes.map((n) => {
    if (n.id === movedId) {
      return { id: n.id, path: newNodePath, depth: newParentDepth + 1 };
    }
    // Descendant: replace the old path prefix with the new node path.
    const suffix = n.path.slice(oldPath.length); // e.g. "/child/grandchild"
    return {
      id: n.id,
      path: newNodePath + suffix,
      depth: n.depth + depthDelta,
    };
  });
}

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

/**
 * Returns true if moving the node at `movingPath` under the target parent at
 * `targetParentPath` would create a cycle.
 *
 * A cycle occurs when the target parent is the moving node itself or a
 * descendant of it — i.e. when targetParentPath starts with movingPath
 * (exact match is moving under itself; prefix match is moving under a descendant).
 */
export function wouldCreateCycle(
  movingPath: string,
  targetParentPath: string | null,
): boolean {
  if (targetParentPath === null) return false; // moving to root is always safe
  if (targetParentPath === movingPath) return true; // moving under itself
  // Moving under a descendant: descendant paths start with movingPath + '/'
  return targetParentPath.startsWith(movingPath + '/');
}

// ---------------------------------------------------------------------------
// Depth validation
// ---------------------------------------------------------------------------

/**
 * Returns true when adding a child to `parentDepth` would exceed the
 * configured maximum number of levels.
 *
 * @param parentDepth Depth of the intended parent (-1 for root, 0 for a root node).
 * @param maxLevels   Maximum number of levels (default 3: depths 0, 1, 2).
 */
export function exceedsMaxDepth(parentDepth: number, maxLevels: number): boolean {
  // A child of a parentDepth node has depth = parentDepth + 1.
  // Valid depths are 0 .. maxLevels-1.
  return parentDepth + 1 >= maxLevels;
}

// ---------------------------------------------------------------------------
// Sibling normalisation
// ---------------------------------------------------------------------------

/**
 * Normalises a category name for sibling-uniqueness comparison.
 * Matches the database predicate: lower(trim(name)).
 */
export function normaliseName(name: string): string {
  return name.toLowerCase().trim();
}
