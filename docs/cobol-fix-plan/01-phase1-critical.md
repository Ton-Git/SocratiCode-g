# Phase 1 — Critical Bugs (blocks shipping)

These 3 issues will produce **incorrect results on virtually any real COBOL codebase**. All three must be fixed before this feature can be considered alpha-quality.

---

## 1.1 Add `stripCobolComments()` Helper

### Problem

COBOL has two comment conventions:
- **Fixed-format**: `*` in column 7 (0-indexed: index 6) marks the entire line as a comment
- **Free-format**: `*>` at any position marks the rest of the line as a comment
- **Page-break comments**: `/` in column 7 — treated as comments

None of the COBOL handlers strip comments. Result: false-positive PERFORM calls, CALL targets, COPY imports, section names, and paragraph names from commented-out code.

### Solution

Create a shared utility function in a new file `src/services/cobol-utils.ts`:

```typescript
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
 */
export function stripCobolComments(source: string): string {
  const lines = source.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    // Free-format comment: *> anywhere
    const freeIdx = line.indexOf("*>");
    const trimmed = freeIdx >= 0 ? line.substring(0, freeIdx) : line;

    // Fixed-format: check indicator column (column 7, index 6)
    if (trimmed.length >= 7) {
      const indicator = trimmed[6];
      if (indicator === "*" || indicator === "/") {
        result.push(""); // preserve line numbers
        continue;
      }
    }

    // Also handle short lines where indicator column doesn't exist —
    // lines shorter than 7 chars can't have a fixed-format comment indicator
    result.push(trimmed);
  }

  return result.join("\n");
}
```

### Integration Points

Apply `stripCobolComments()` at the top of:

1. **`graph-symbols.ts` → `extractFromCobol()`**
   ```typescript
   function extractFromCobol(source: string, file: string, language: string, moduleSym: SymbolNode): ExtractedSymbols {
     source = stripCobolComments(source);  // <-- ADD THIS LINE
     const symbols: SymbolNode[] = [moduleSym];
     // ...
   ```

2. **`graph-imports.ts` → COBOL block in `extractImports()`**
   ```typescript
   if (langKey === "cobol") {
     source = stripCobolComments(source);  // <-- ADD THIS LINE
     // COPY "member.cpy" / COPY 'member.cpy'
     // ...
   ```

3. **`graph-resolution.ts`** — NOT needed here; resolution works on module specifiers, not source parsing.

### Verification

- Input: COBOL source with `*    PERFORM OLD-ROUTINE.` in a comment line
- Before: false-positive PERFORM call to `OLD-ROUTINE`
- After: line stripped, no false positive

---

## 1.2 Fix Hyphenated Identifier Truncation

### Problem

COBOL identifiers commonly contain hyphens: `HELLO-WORLD`, `CANCEL-PROGRAM`, `1000-MAIN-LOGIC`. Multiple regexes use `\w+` which stops at hyphens.

### Affected Regexes

| Location | Current | Problem | Example |
|----------|---------|---------|---------|
| `graph-symbols.ts` PROGRAM-ID | `(\w+)` | Captures `HELLO` from `HELLO-WORLD` | `PROGRAM-ID. HELLO-WORLD.` |
| `graph-symbols.ts` CALL | `(\w+)` | Captures `CANCEL` from `CALL CANCEL-PROGRAM` | `CALL CANCEL-PROGRAM USING WS-REC.` |
| `graph-symbols.ts` PERFORM | `(\w+)` | Captures `1000` from `PERFORM 1000-MAIN-LOGIC` | `PERFORM 1000-MAIN-LOGIC` |

### Fix

In `src/services/graph-symbols.ts`, change three regexes:

**PROGRAM-ID regex** (~line 952):
```diff
- const programIdRegex = /PROGRAM-ID\s*\.?\s*(?:IS\s+)?(\w+)/gi;
+ const programIdRegex = /PROGRAM-ID\s*\.?\s*(?:IS\s+)?([\w-]+)/gi;
```

**PERFORM regex** (~line 1042):
```diff
- const performRegex = /PERFORM\s+([A-Za-z][\w-]*)/gi;
+ // Already correct! Uses [\w-] — but verify the capture group includes the full name
```
Wait — PERFORM already uses `[\w-]`. ✅ No change needed for PERFORM.

**CALL regex** (~line 1054):
```diff
- const callRegex = /CALL\s+["']?(\w+)["']?/gi;
+ const callRegex = /CALL\s+["']?([\w-]+)["']?/gi;
```

Also fix the COBOL reserved word guard in CALL handler — currently only checks `=== "CALL"` which is useless:
```diff
  for (const match of source.matchAll(callRegex)) {
    const calleeName = match[1];
-   if (calleeName.toUpperCase() === "CALL") continue;
+   if (COBOL_STATEMENT_RESERVED.has(calleeName.toUpperCase())) continue;
```
This requires the reserved-word set split from fix 1.3 (below).

### Verification

- `PROGRAM-ID. HELLO-WORLD.` → captures `HELLO-WORLD` ✅
- `CALL CANCEL-PROGRAM USING WS-REC.` → captures `CANCEL-PROGRAM` ✅
- `PERFORM 1000-MAIN-LOGIC` → already captures `1000-MAIN-LOGIC` ✅

---

## 1.3 Split `COBOL_RESERVED` into Purpose-Specific Sets

### Problem

The single `COBOL_RESERVED` set is used for both **section name filtering** and **paragraph name filtering**. But the two have different requirements:

- `FILE SECTION.` is a legitimate COBOL section — filtering it out is wrong
- `WORKING-STORAGE SECTION.` is a legitimate section — filtering it out is wrong
- `FD SECTION.` is legitimate
- But `CALL PARAGRAPH.` should be filtered because `CALL` is a statement keyword

The current set includes `FILE`, `WORKING-STORAGE`, `FD`, `SELECT` which are valid section names in DATA DIVISION.

### Solution

Split into two sets in `src/services/graph-symbols.ts`:

```typescript
/**
 * COBOL statement-level reserved words.
 * These are COBOL verbs/statements that should NEVER be treated as
 * paragraph or section names (they appear as keywords in PROCEDURE DIVISION).
 */
const COBOL_STATEMENT_RESERVED = new Set([
  "ACCEPT", "ADD", "ALTER", "AND", "ARE", "AT",
  "CALL", "CANCEL", "CLOSE", "COMPUTE", "CONTINUE",
  "COPY", "DELETE", "DISPLAY", "DIVIDE", "ELSE",
  "END-ADD", "END-CALL", "END-COMPUTE", "END-DELETE",
  "END-DIVIDE", "END-EVALUATE", "END-IF", "END-MULTIPLY",
  "END-PERFORM", "END-READ", "END-RETURN", "END-REWRITE",
  "END-SEARCH", "END-START", "END-STRING", "END-SUBTRACT",
  "END-UNSTRING", "END-WRITE", "ENTRY", "EVALUATE",
  "EXEC", "EXIT", "FROM", "GO", "GOBACK",
  "IF", "IN", "INITIALIZE", "INSPECT", "INTO", "IS",
  "MERGE", "MOVE", "MULTIPLY", "NOT", "OF", "ON",
  "OPEN", "OR", "PERFORM", "READ", "RELEASE",
  "REPLACE", "RETURN", "REWRITE", "SEARCH",
  "SET", "SORT", "START", "STOP", "STRING", "SUBTRACT",
  "THEN", "TO", "UNSTRING", "UNTIL", "USING", "VARYING",
  "WHEN", "WITH", "WRITE",
]);

/**
 * COBOL structural keywords that appear as part of division/section headers.
 * These are used to filter paragraph names in PROCEDURE DIVISION,
 * but should NOT filter section names (FILE SECTION is valid).
 */
const COBOL_PARAGRAPH_RESERVED = new Set([
  ...COBOL_STATEMENT_RESERVED,
  // Division headers — can't be paragraph names
  "IDENTIFICATION", "ENVIRONMENT", "DATA", "PROCEDURE",
  "DIVISION", "SECTION",
  // Data division keywords that look like paragraphs but aren't
  "REDEFINES", "SELECT", "FILE", "FD", "WORKING-STORAGE",
]);
```

### Integration Points

Update all three filtering locations:

**Section extraction** (~line 969):
```diff
- if (COBOL_RESERVED.has(name.toUpperCase())) continue;
+ if (COBOL_STATEMENT_RESERVED.has(name.toUpperCase())) continue;
```
This allows `FILE SECTION.`, `WORKING-STORAGE SECTION.` etc. to be extracted.

**Paragraph extraction** (~line 1008):
```diff
- if (COBOL_RESERVED.has(name.toUpperCase())) continue;
+ if (COBOL_PARAGRAPH_RESERVED.has(name.toUpperCase())) continue;
```
Paragraphs in PROCEDURE DIVISION still get full filtering.

**CALL extraction** (~line 1060):
```diff
- if (calleeName.toUpperCase() === "CALL") continue;
+ if (COBOL_STATEMENT_RESERVED.has(calleeName.toUpperCase())) continue;
```

**PERFORM extraction** (~line 1048):
```diff
- if (COBOL_RESERVED.has(calleeName.toUpperCase())) continue;
+ if (COBOL_STATEMENT_RESERVED.has(calleeName.toUpperCase())) continue;
```

### Verification

- `FILE SECTION.` → now extracted as a section symbol (kind: "section") ✅
- `WORKING-STORAGE SECTION.` → now extracted ✅
- `CALL PARAGRAPH.` → still filtered as a paragraph name ✅
- `PERFORM X.` → `PERFORM` not treated as callee ✅

---

## Phase 1 Summary

| Fix | File(s) | Lines Changed |
|-----|---------|---------------|
| 1.1 Comment stripping | New: `cobol-utils.ts`, `graph-symbols.ts`, `graph-imports.ts` | ~30 new, 2 insertion points |
| 1.2 Hyphenated identifiers | `graph-symbols.ts` | 2 regex changes |
| 1.3 Reserved-word split | `graph-symbols.ts` | ~20 lines replaced, 4 filter changes |

**After Phase 1**: COBOL parsing produces correct results on real fixed-format and free-format codebases with hyphenated identifiers and comments.
