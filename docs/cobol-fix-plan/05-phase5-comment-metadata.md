# Phase 5 — Enhancement: Comments as Symbol Metadata (backlog)

Legacy COBOL programs often have zero external documentation. The only "docs" are comments in the source. Rather than treating comments as noise to strip, we can mine them for insight and attach them to the symbol graph.

**Depends on**: Phase 1 (needs `stripCobolComments()` as a parser, not a destroyer — we refactor it into a comment *collector* instead).

---

## 5.1 Refactor `stripCobolComments()` into `parseCobolComments()`

### Current (Phase 1)

The helper strips comments and returns clean source. Comments are lost (from the regex perspective — the original source is still indexed elsewhere).

### Proposed

Replace with a function that **collects** comments instead of discarding them:

```typescript
export interface CobolComment {
  /** 1-indexed line number */
  line: number;
  /** The comment text (without the * or *> prefix) */
  text: string;
  /** Whether this is a page-break comment (/) */
  isPageBreak: boolean;
}

export interface CobolParseResult {
  /** Source with comments blanked out (for regex matching) */
  cleanSource: string;
  /** Extracted comments with line numbers */
  comments: CobolComment[];
}

export function parseCobolComments(source: string): CobolParseResult {
  const lines = source.split("\n");
  const cleanLines: string[] = [];
  const comments: CobolComment[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Free-format comment: *> anywhere
    const freeIdx = line.indexOf("*>");
    const trimmed = freeIdx >= 0 ? line.substring(0, freeIdx) : line;
    const freeComment = freeIdx >= 0 ? line.substring(freeIdx + 2).trim() : null;

    if (freeComment !== null) {
      comments.push({ line: i + 1, text: freeComment, isPageBreak: false });
      // Keep code before *> on the line
      cleanLines.push(trimmed);
      continue;
    }

    // Fixed-format: indicator column (column 7, index 6)
    if (trimmed.length >= 7) {
      const indicator = trimmed[6];
      if (indicator === "*" || indicator === "/") {
        const text = trimmed.substring(7).trim();
        comments.push({ line: i + 1, text, isPageBreak: indicator === "/" });
        cleanLines.push(""); // preserve line numbers
        continue;
      }
    }

    cleanLines.push(trimmed);
  }

  return { cleanSource: cleanLines.join("\n"), comments };
}
```

`stripCobolComments()` becomes a one-liner delegating to this:

```typescript
export function stripCobolComments(source: string): string {
  return parseCobolComments(source).cleanSource;
}
```

Phase 1 code keeps working unchanged.

---

## 5.2 Attach Leading Comments as Symbol Annotations

### Concept

In COBOL, developers commonly write a block of comments immediately *above* a paragraph or section to describe what it does:

```cobol
      * THIS PARAGRAPH HANDLES THE QUARTERLY TAX
      * CALCULATION FOR EMPLOYEES IN THE SHIPPING DEPT.
      * MODIFIED: 1998-03-12 BY J. SMITH (Y2K FIX)
       CALC-TAX-SHIPPING.
           PERFORM GET-TAX-RATE
           ...
```

These comments are the **only documentation** the paragraph has. We can attach them to the symbol as metadata.

### Solution

After extracting symbols in `extractFromCobol()`, run a post-processing pass:

```typescript
/** Attach leading comments (comments immediately above a symbol) as annotations. */
function attachCommentAnnotations(
  symbols: SymbolNode[],
  comments: CobolComment[],
  lines: string[],
): void {
  // Build a set of symbol start lines for fast lookup
  const symbolAtLine = new Map<number, SymbolNode>();
  for (const sym of symbols) {
    symbolAtLine.set(sym.line, sym);
  }

  // For each symbol, walk upward collecting contiguous comment lines
  for (const sym of symbols) {
    const annotationLines: string[] = [];
    let checkLine = sym.line - 1; // line above symbol

    while (checkLine >= 1) {
      const comment = comments.find(c => c.line === checkLine);
      if (comment && comment.text.length > 0) {
        annotationLines.unshift(comment.text);
        checkLine--;
      } else {
        // Stop at first non-comment blank line or code line
        const rawLine = lines[checkLine - 1];
        if (rawLine !== undefined && rawLine.trim() === "") {
          // Allow one blank line between comment block and symbol
          const commentAbove = comments.find(c => c.line === checkLine - 1);
          if (commentAbove) {
            checkLine--;
            continue;
          }
        }
        break;
      }
    }

    if (annotationLines.length > 0) {
      sym.annotation = annotationLines.join("\n");
    }
  }
}
```

This requires adding an optional `annotation` field to `SymbolNode` in `types.ts`:

```diff
 export interface SymbolNode {
   /** Stable id: `${relativePath}::${qualifiedName}#${line}` */
   id: string;
   // ... existing fields ...
+  /** Comment block immediately above this symbol (COBOL, etc.) */
+  annotation?: string;
 }
```

---

## 5.3 Index Comments Separately for Search

### Concept

COBOL comments often contain business logic descriptions that are invisible to code search:

```cobol
      * THIS ROUTINE CALCULATES OVERTIME PAY FOR
      * HOURLY EMPLOYEES BASED ON UNION CONTRACT
      * RULE 14-B SECTION 3
```

A user searching "overtime calculation" or "union contract" should find this paragraph, even though the code itself says `CALC-OVERTIE-HRLY.`

### Solution

In the indexing pipeline (wherever source content gets indexed for BM25/embeddings), extract COBOL comments and index them with a distinct source label:

```typescript
// In the COBOL-specific indexing path:
const { comments } = parseCobolComments(source);
if (comments.length > 0) {
  const commentText = comments
    .map(c => `[L${c.line}] ${c.text}`)
    .join("\n");
  
  ctx_index({
    content: commentText,
    source: `cobol-comments:${relativePath}`,
  });
}
```

This enables queries like:
- `ctx_search(["overtime calculation"])` → finds `CALC-OVERTIE-HRLY`
- `ctx_search(["union contract rule 14"])` → finds the paragraph with that business context

---

## 5.4 Expose Annotations in Graph Tools

### Concept

When a user calls `codebase_symbol(name="CALC-OVERTIE-HRLY")`, the returned symbol should include the `annotation` field so the LLM sees the business context without reading the full source.

### Solution

Update the symbol serialization in graph tools to include `annotation`:

```typescript
// In whatever function formats SymbolNode for MCP tool output:
function formatSymbol(sym: SymbolNode): object {
  return {
    name: sym.name,
    kind: sym.kind,
    file: sym.file,
    line: sym.line,
    endLine: sym.endLine,
    qualifiedName: sym.qualifiedName,
    annotation: sym.annotation ?? undefined,  // include if present
  };
}
```

---

## 5.5 Comment Quality Heuristic (optional, stretch goal)

### Concept

Not all COBOL comments are useful. Many are auto-generated headers, RCS/CVS markers, or empty lines:

```cobol
      *====================================================*
      *                                                    *
      *   PROGRAM: PAYROLL                                 *
      *   AUTHOR:  SYSTEMS DIVISION                        *
      *   DATE:    01/15/1987                              *
      *                                                    *
      *====================================================*
```

We could score comment blocks by usefulness to deprioritize boilerplate.

### Possible Heuristics

| Signal | Likely useful | Likely boilerplate |
|--------|--------------|--------------------|
| Contains a verb (handles, calculates, processes) | ✅ | |
| All caps divider lines (`====`, `----`) | | ❌ |
| Matches RCS/CVS pattern (`$Id`, `$Log`) | | ❌ |
| Single word or empty | | ❌ |
| Contains business terms (tax, payroll, invoice) | ✅ | |

This is a stretch goal — skip unless there's a specific user pain point.

---

## Phase 5 Summary

| Fix | File(s) | Lines Changed |
|-----|---------|---------------|
| 5.1 Refactor to `parseCobolComments()` | `cobol-utils.ts` | ~40 (refactor) |
| 5.2 Attach comment annotations | `graph-symbols.ts`, `types.ts` | ~40 |
| 5.3 Index comments separately | Indexing pipeline | ~15 |
| 5.4 Expose in graph tools | Graph tool serialization | ~5 |
| 5.5 Comment quality heuristic | New: `cobol-utils.ts` addition | ~30 (optional) |

**After Phase 5**: COBOL comments become a first-class knowledge source — attached to symbols, searchable, and surfaced in graph queries. For a legacy COBOL codebase with zero external documentation, this turns comments into the closest thing to a spec.

---

## Interaction with Other Phases

```
Phase 1 (critical fixes)
  └── 5.1 refactors the Phase 1 helper (no conflict — Phase 1 still works)
Phase 2 (tests)
  └── Add test cases for comment collection and annotation attachment
Phase 5 (this phase)
  └── 5.2 depends on types.ts having division/section/paragraph (Phase 2.1)
  └── 5.3 depends on knowing the indexing pipeline (check integration point)
  └── 5.4 depends on graph tool serialization (check integration point)
```

**Recommended order**: Ship Phases 1–3 first, then Phase 5 as a feature enhancement. Phase 4 (nits) can be done anytime.
