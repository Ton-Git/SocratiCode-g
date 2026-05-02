# Phase 3 — Minor Improvements (can ship with, fix soon)

These are correctness and quality improvements that won't cause failures on most codebases but will on edge cases.

---

## 3.1 Fix `getAstGrepLang` for COBOL

### Problem

In `src/services/code-graph.ts`, the function `getAstGrepLang()` returns `"cobol"` for COBOL extensions. But ast-grep does NOT have a COBOL grammar. The string `"cobol"` will be passed to ast-grep which will attempt to parse and fail.

This doesn't crash because `extractSymbolsAndCalls()` has a `langKey === "cobol"` check that routes to `extractFromCobol()` before ast-grep is invoked. But the mapping is misleading and could confuse future contributors.

### Solution

In `src/services/code-graph.ts`, change the COBOL mapping:

```diff
     ".lua": "lua",
-    ".cbl": "cobol", ".cob": "cobol", ".cpy": "cobol", ".cobol": "cobol",
+    // COBOL: no ast-grep grammar; handled by regex in extractSymbolsAndCalls
+    ".cbl": null, ".cob": null, ".cpy": null, ".cobol": null,
```

This makes it explicit that COBOL uses the regex path, not AST parsing.

**Verify**: Run the codebase and confirm COBOL files still get indexed. The `langKey` is derived from `getLanguageFromExtension()` in `constants.ts` (which correctly returns `"cobol"`), not from `getAstGrepLang()`. So changing `getAstGrepLang` to return `null` is safe — it just means the main parser falls through to the regex path immediately.

---

## 3.2 Add PERFORM THRU Secondary Target Capture

### Problem

```cobol
PERFORM PARA-A THRU PARA-C.
```

Only `PARA-A` is captured as a call target. The `THRU` target `PARA-C` is missed. In COBOL, `PERFORM X THRU Y` means "execute all paragraphs from X to Y inclusive." The call graph should reflect that `PARA-C` (and everything between) is reachable.

### Solution

Add a secondary regex after the PERFORM extraction in `extractFromCobol()`:

```typescript
// 4b. PERFORM THRU secondary target
const performThruRegex = /PERFORM\s+[A-Za-z][\w-]*\s+THRU\s+([A-Za-z][\w-]*)/gi;
for (const match of procSource.matchAll(performThruRegex)) {
  const calleeName = match[1];
  if (COBOL_STATEMENT_RESERVED.has(calleeName.toUpperCase())) continue;
  const lineNum = procDivStart + procSource.substring(0, match.index!).split("\n").length;
  rawCalls.push({
    callerId: findCallerId(scopes, lineNum, moduleSym.id),
    calleeName,
    callSite: { file, line: lineNum },
  });
}
```

**Note**: This captures only the endpoint. Capturing all paragraphs *between* X and Y would require knowing the order of paragraphs in the source, which is a deeper integration. The endpoint is a good first step — it shows the boundary of the PERFORM range.

---

## 3.3 Replace `symbols.some()` with `Set` Lookup

### Problem

In paragraph extraction:

```typescript
if (symbols.some((s) => s.name === name && s.kind === "section")) continue;
```

This is O(n) per paragraph. For a COBOL program with 200 paragraphs and 30 sections, this does 6,000 comparisons. Not catastrophic, but unnecessary.

### Solution

Build a `Set<string>` of section names before the paragraph loop:

```diff
+ // Build set of section names for fast lookup
+ const sectionNames = new Set(
+   symbols.filter(s => s.kind === "section").map(s => s.name)
+ );

  if (procDivStart > 0) {
    const paragraphRegex = /^\s{0,6}([A-Za-z][\w-]*)\s*\.\s*$/;
    for (let i = procDivStart; i < lines.length; i++) {
      const m = lines[i]!.match(paragraphRegex);
      if (!m) continue;
      const name = m[1];
      if (COBOL_PARAGRAPH_RESERVED.has(name.toUpperCase())) continue;
-     if (symbols.some((s) => s.name === name && s.kind === "section")) continue;
+     if (sectionNames.has(name)) continue;
```

This moves the set building after section extraction completes (which it does, since sections are extracted in step 2 and paragraphs in step 3).

---

## 3.4 Relax Indentation for Free-Format COBOL

### Problem

Section and paragraph regexes use `^\s{0,6}` which limits leading whitespace to 0–6 characters. This matches fixed-format COBOL (where code starts at column 8). But free-format COBOL (ISO 2002+) allows arbitrary indentation. Paragraphs indented beyond 6 spaces won't be detected.

### Solution

Change the leading-whitespace constraint:

**Section regex**:
```diff
- const sectionRegex = /^\s{0,6}([A-Za-z][\w-]*)\s+SECTION\s*\./gim;
+ const sectionRegex = /^\s*([A-Za-z][\w-]*)\s+SECTION\s*\./gim;
```

**Paragraph regex**:
```diff
- const paragraphRegex = /^\s{0,6}([A-Za-z][\w-]*)\s*\.\s*$/;
+ const paragraphRegex = /^\s*([A-Za-z][\w-]*)\s*\.\s*$/;
```

**Trade-off**: `\s*` is more permissive and could increase false positives for non-COBOL files misidentified as COBOL. But since the language detection is based on file extension (`.cbl`, `.cob`, etc.), this is safe — only actual COBOL files reach this code path.

Apply the same change to the PROCEDURE DIVISION detection regex:
```diff
- if (/^\s{0,6}PROCEDURE\s+DIVISION/i.test(lines[i]!)) {
+ if (/^\s*PROCEDURE\s+DIVISION/i.test(lines[i]!)) {
```

And the DIVISION extraction regex from Phase 2.1 (if already applied):
```diff
- const divisionRegex = /^\s{0,6}([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)*)\s+DIVISION\s*\./gim;
+ const divisionRegex = /^\s*([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)*)\s+DIVISION\s*\./gim;
```

---

## Phase 3 Summary

| Fix | File(s) | Lines Changed |
|-----|---------|---------------|
| 3.1 ast-grep null return | `code-graph.ts` | 2 |
| 3.2 PERFORM THRU capture | `graph-symbols.ts` | ~10 |
| 3.3 Set-based lookup | `graph-symbols.ts` | 3 |
| 3.4 Free-format indent | `graph-symbols.ts` | 4 regexes |

**After Phase 3**: COBOL support handles free-format code, captures PERFORM ranges, and avoids misleading ast-grep mappings.
