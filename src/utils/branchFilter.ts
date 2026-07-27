// src/utils/branchFilter.ts

import { minimatch } from 'minimatch'
import { Branch, BranchFilterOptions } from '@src/types'

// Patterns are globs (`{main,master}`, `feature/*`, `**`), matched the same way
// GitHub Actions matches `on.push.branches`: `*` stops at `/`, `**` does not.
export function filterBranches(
  branches: Branch[],
  filterOptions: BranchFilterOptions
): Branch[] {
  const byProtection =
    filterOptions.includeProtected === false
      ? branches.filter(branch => !branch.protected)
      : branches

  if (!filterOptions.pattern) {
    return byProtection
  }

  const pattern = filterOptions.pattern
  return byProtection.filter(branch => minimatch(branch.name, pattern))
}
