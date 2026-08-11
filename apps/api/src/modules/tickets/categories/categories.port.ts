/**
 * CategoriesPort — the interface consumed by the tickets service, saved-view
 * compiler and report builder. No other module reads the categories table
 * directly; all cross-module reads go through this port.
 */

export interface CategoryPath {
  id: string;
  name: string;
  /** Full materialised path, e.g. "pipeline/jenkins-integration". */
  path: string;
  isActive: boolean;
}

export interface CategoriesPort {
  /**
   * Resolves a single category to its id, name and full path.
   * Returns null when the category does not exist or belongs to a different
   * tenant.  Deactivated categories are returned (for historical resolution).
   */
  resolveById(tenantId: string, categoryId: string): Promise<CategoryPath | null>;

  /**
   * Resolves multiple category IDs in a single call.
   * Unknown or foreign-tenant IDs are omitted from the result map.
   */
  resolvePaths(
    tenantId: string,
    categoryIds: string[],
  ): Promise<Map<string, CategoryPath>>;
}
