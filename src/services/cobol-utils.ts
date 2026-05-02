// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Shared utilities for COBOL source parsing.
 */

/**
 * Strip COBOL comment lines from source text.
 *
 * Fixed-format COBOL (the vast majority):
 *   Columns 1–6 = sequence area (ignored)
 *   Column 7    = indicator area: '*' = comment, '/' = page-break comment
 *   Columns 8+  = code area
 *
 * Free-format COBOL (2002+):
 *   `*>` at any position starts a line comment
 *
 * Returns a new string with comment content blanked out (line numbers preserved).
 * The original source is not mutated — comments remain in the indexed/searchable source.
 */
export function stripCobolComments(source: string): string {
  const lines = source.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    // Free-format comment: *> anywhere — strip rest of line
    const freeIdx = line.indexOf("*>");
    const trimmed = freeIdx >= 0 ? line.substring(0, freeIdx) : line;

    // Fixed-format: check indicator column (column 7, 0-indexed: index 6)
    if (trimmed.length >= 7) {
      const indicator = trimmed[6];
      if (indicator === "*" || indicator === "/") {
        result.push(""); // preserve line numbers
        continue;
      }
    }

    // Lines shorter than 7 chars can't have a fixed-format comment indicator
    result.push(trimmed);
  }

  return result.join("\n");
}
