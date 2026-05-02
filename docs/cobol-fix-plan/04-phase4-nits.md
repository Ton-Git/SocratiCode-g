# Phase 4 — Nits (backlog)

Low-priority cleanup and documentation. These don't affect correctness.

---

## 4.1 Extract Shared COBOL Extension Constants

### Problem

The COBOL extension list `.cbl`, `.cob`, `.cpy`, `.cobol` is repeated in 4 locations:

1. `src/constants.ts` — `SUPPORTED_EXTENSIONS`
2. `src/constants.ts` — `getLanguageFromExtension()`
3. `src/services/code-graph.ts` — `getAstGrepLang()`
4. `src/services/graph-imports.ts` — lang detection

If a new extension is added (e.g., `.ccp` for COBOL II copybooks), all 4 must be updated.

### Solution

Add a shared constant in `src/constants.ts`:

```typescript
/** COBOL source and copybook file extensions */
export const COBOL_EXTENSIONS = [".cbl", ".cob", ".cpy", ".cobol"] as const;
```

Then use it everywhere:

**`SUPPORTED_EXTENSIONS`**:
```diff
+ // COBOL
+ ...COBOL_EXTENSIONS,
- ".cbl", ".cob", ".cpy", ".cobol"
```

**`getLanguageFromExtension()`**:
```diff
+ ...Object.fromEntries(COBOL_EXTENSIONS.map(ext => [ext, "cobol"])),
- ".cbl": "cobol", ".cob": "cobol", ".cpy": "cobol", ".cobol": "cobol",
```

**`getAstGrepLang()`** (or after Phase 3.1, the null mapping):
```diff
+ ...Object.fromEntries(COBOL_EXTENSIONS.map(ext => [ext, null])),
- ".cbl": null, ".cob": null, ".cpy": null, ".cobol": null,
```

**`graph-imports.ts`** lang detection:
```diff
+ import { COBOL_EXTENSIONS } from "../constants.js";
+ if (COBOL_EXTENSIONS.includes(ext as any)) {
- // existing cobol lang check
```

---

## 4.2 Document ENTRY_POINT_NAMES Heuristic

### Problem

```typescript
cobol: new Set(["MAIN", "MAIN-PROGRAM", "0000-MAIN"]),
```

This is a best-effort heuristic. COBOL has no universal "main" convention — entry points are determined by the `PROGRAM-ID` and the compile/link process. The set could be expanded or made configurable.

### Solution

Add a comment explaining the heuristic:

```typescript
// COBOL: no universal entry-point convention. Common patterns:
// - MAIN / MAIN-PROGRAM: generic names
// - 0000-MAIN: numeric-prefix convention (0xxx = main, 1xxx = init, etc.)
// The actual entry point is PROGRAM-ID; this set is used for heuristic
// entry-point detection when building the call graph.
cobol: new Set(["MAIN", "MAIN-PROGRAM", "0000-MAIN"]),
```

---

## 4.3 Add `COBOL_EXTENSIONS` to Copybook Resolution

### Problem

In `graph-resolution.ts`, the COBOL extension list is declared locally:

```typescript
const cobolExts = [".cpy", ".cbl", ".cob", ".cobol"];
```

This should use the shared constant from 4.1.

### Solution

```diff
+ import { COBOL_EXTENSIONS } from "../constants.js";

  case "cobol": {
-   const cobolExts = [".cpy", ".cbl", ".cob", ".cobol"];
+   const cobolExts = [...COBOL_EXTENSIONS];
```

---

## Phase 4 Summary

| Fix | File(s) | Lines Changed |
|-----|---------|---------------|
| 4.1 Shared constants | `constants.ts`, `code-graph.ts`, `graph-imports.ts`, `graph-resolution.ts` | ~15 net |
| 4.2 Entry-point docs | `constants.ts` | 4 comment lines |
| 4.3 Import shared constant | `graph-resolution.ts` | 2 |

**After Phase 4**: Single source of truth for COBOL extensions, documented heuristics, clean imports.
