// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Shared utilities for COBOL source parsing.
 */

/** A single COBOL comment extracted from source. */
export interface CobolComment {
  /** 1-indexed line number */
  line: number;
  /** The comment text (without the * or *> prefix) */
  text: string;
  /** Whether this is a page-break comment (/) */
  isPageBreak: boolean;
}

/** Result of parsing COBOL comments: clean source + collected comments. */
export interface CobolParseResult {
  /** Source with comments blanked out (for regex matching) */
  cleanSource: string;
  /** Extracted comments with line numbers */
  comments: CobolComment[];
}

/**
 * Parse COBOL source, collecting comments and producing a clean version.
 *
 * Fixed-format COBOL (the vast majority):
 *   Columns 1–6 = sequence area (ignored)
 *   Column 7    = indicator area: '*' = comment, '/' = page-break comment
 *   Columns 8+  = code area
 *
 * Free-format COBOL (2002+):
 *   `*>` at any position starts a line comment
 */
export function parseCobolComments(source: string): CobolParseResult {
  const lines = source.split("\n");
  const cleanLines: string[] = [];
  const comments: CobolComment[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Free-format comment: *> anywhere — strip rest of line
    const freeIdx = line.indexOf("*>");
    const trimmed = freeIdx >= 0 ? line.substring(0, freeIdx) : line;
    const freeComment = freeIdx >= 0 ? line.substring(freeIdx + 2).trim() : null;

    if (freeComment !== null) {
      comments.push({ line: i + 1, text: freeComment, isPageBreak: false });
      // Keep code before *> on the line
      cleanLines.push(trimmed);
      continue;
    }

    // Fixed-format: check indicator column (column 7, 0-indexed: index 6)
    if (trimmed.length >= 7) {
      const indicator = trimmed[6];
      if (indicator === "*" || indicator === "/") {
        const text = trimmed.substring(7).trim();
        comments.push({ line: i + 1, text, isPageBreak: indicator === "/" });
        cleanLines.push(""); // preserve line numbers
        continue;
      }
    }

    // Lines shorter than 7 chars can't have a fixed-format comment indicator
    cleanLines.push(trimmed);
  }

  return { cleanSource: cleanLines.join("\n"), comments };
}

/**
 * Strip COBOL comment lines from source text.
 *
 * Returns a new string with comment content blanked out (line numbers preserved).
 * The original source is not mutated — comments remain in the indexed/searchable source.
 */
export function stripCobolComments(source: string): string {
  return parseCobolComments(source).cleanSource;
}
