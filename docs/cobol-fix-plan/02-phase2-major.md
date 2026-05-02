# Phase 2 — Major Issues (should fix before production)

These are design gaps and missing coverage. The code won't crash without them, but the symbol graph will be incomplete and untested.

---

## 2.1 Add DIVISION Symbol Extraction

### Problem

COBOL programs are structured as a hierarchy:

```
PROGRAM
├── IDENTIFICATION DIVISION
├── ENVIRONMENT DIVISION
├── DATA DIVISION
│   ├── FILE SECTION
│   └── WORKING-STORAGE SECTION
└── PROCEDURE DIVISION
    ├── SECTION-A SECTION
    │   ├── PARAGRAPH-1
    │   └── PARAGRAPH-2
    └── SECTION-B SECTION
```

The current code extracts PROGRAM, SECTION, and PARAGRAPH — but skips DIVISION entirely. This leaves a gap in the symbol hierarchy.

### Solution

#### Step 1: Add `"division"` to SymbolKind

In `src/types.ts`:

```diff
   | "variable"
    | "program"     // COBOL PROGRAM-ID
-   | "section"     // COBOL SECTION
-   | "paragraph";  // COBOL PARAGRAPH
+   | "division"    // COBOL DIVISION
+   | "section"     // COBOL SECTION
+   | "paragraph";  // COBOL PARAGRAPH
```

#### Step 2: Add division extraction to `extractFromCobol()`

Insert **after** the PROGRAM-ID block (step 1) and **before** the SECTION block (step 2) in `src/services/graph-symbols.ts`:

```typescript
// 1b. DIVISION extraction
//     DIVISION-NAME DIVISION.
const divisionRegex = /^\s{0,6}([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)*)\s+DIVISION\s*\./gim;
const divisionNames = new Set<string>();

for (const match of source.matchAll(divisionRegex)) {
  const name = match[1].trim();
  if (COBOL_STATEMENT_RESERVED.has(name.toUpperCase())) continue;
  const lineNum = source.substring(0, match.index!).split("\n").length;

  // Find end: next DIVISION or end of file
  let endLine = lines.length;
  for (let i = lineNum; i < lines.length; i++) {
    if (i > lineNum && /^\s{0,6}[A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)*\s+DIVISION\s*\./i.test(lines[i]!)) {
      endLine = i;
      break;
    }
  }

  const qname = currentProgram ? `${currentProgram}.${name}` : name;
  const sym: SymbolNode = {
    id: makeId(file, qname, lineNum),
    name,
    qualifiedName: qname,
    kind: "division",
    file,
    line: lineNum,
    endLine,
    language,
  };
  symbols.push(sym);
  scopes.push({ name, startLine: lineNum, endLine, symbolId: sym.id });
  divisionNames.add(name.toUpperCase());
}
```

#### Notes

- Division names can be multi-word: `IDENTIFICATION DIVISION.`, `ENVIRONMENT DIVISION.`, etc. The regex captures the full name.
- The qualified name becomes e.g. `HELLO-WORLD.IDENTIFICATION`.
- Sections and paragraphs within a division can later be parented to it via the scopes array.

---

## 2.2 Restrict CALL/PERFORM to PROCEDURE DIVISION

### Problem

The PERFORM and CALL regexes currently run against the **entire source text**. In COBOL, PERFORM and CALL are PROCEDURE DIVISION statements. Running them against DATA DIVISION or comment text produces false positives.

### Solution

In `extractFromCobol()`, the code already finds `procDivStart` for paragraph extraction. Reuse that:

```diff
  // 4. PERFORM call detection
- const performRegex = /PERFORM\s+([A-Za-z][\w-]*)/gi;
- for (const match of source.matchAll(performRegex)) {
+ const performRegex = /PERFORM\s+([A-Za-z][\w-]*)/gi;
+ const procSource = procDivStart > 0 ? lines.slice(procDivStart).join("\n") : "";
+ for (const match of procSource.matchAll(performRegex)) {
    const calleeName = match[1];
    if (COBOL_STATEMENT_RESERVED.has(calleeName.toUpperCase())) continue;
-   const lineNum = source.substring(0, match.index!).split("\n").length;
+   const lineNum = procDivStart + source.substring(0, match.index!).split("\n").length;
    rawCalls.push({
      callerId: findCallerId(scopes, lineNum, moduleSym.id),
      calleeName,
      callSite: { file, line: lineNum },
    });
  }
```

Apply the same pattern to CALL detection (step 5).

**Important**: `procDivStart` is 0-indexed line number. If `procDivStart === 0` (no PROCEDURE DIVISION found), skip PERFORM/CALL extraction entirely — a COBOL program without a PROCEDURE DIVISION is malformed and shouldn't produce call edges.

```typescript
if (procDivStart === 0) {
  return { symbols, rawCalls };
}
```

Add this early return after paragraph extraction and before PERFORM extraction.

---

## 2.3 Add Comprehensive Unit Tests

### Problem

Zero test coverage for 237 lines of regex-based parsing. Any refactor or fix could silently break extraction.

### Solution

Create test file: `tests/cobol-extraction.test.ts` (or wherever existing tests live — check project test convention first).

#### Test Structure

```
describe("COBOL support", () => {
  describe("stripCobolComments", () => { ... })       // Phase 1.1
  describe("extractFromCobol", () => { ... })          // Symbol extraction
  describe("extractImports (COBOL)", () => { ... })    // COPY / EXEC SQL
  describe("resolveImport (COBOL)", () => { ... })     // Resolution cascade
});
```

#### Test Cases

**`stripCobolComments`**:
- Fixed-format comment (`*` in column 7) is stripped
- Page-break comment (`/` in column 7) is stripped
- Free-format comment (`*>`) strips rest of line
- Code line is preserved unchanged
- Mixed: code followed by `*> inline comment`
- Empty lines preserved (line numbers)

**`extractFromCobol` — PROGRAM-ID**:
- `PROGRAM-ID. HELLO-WORLD.` → symbol name `HELLO-WORLD`, kind `program`
- `PROGRAM-ID IS MYPROG.` → symbol name `MYPROG`
- Lowercase mixed case preserved

**`extractFromCobol` — DIVISION** (after Phase 2.1):
- `IDENTIFICATION DIVISION.` → kind `division`
- `PROCEDURE DIVISION.` → kind `division`
- All 4 divisions extracted
- Qualified name includes program prefix

**`extractFromCobol` — SECTION**:
- `FILE SECTION.` → extracted (not filtered)
- `WORKING-STORAGE SECTION.` → extracted (not filtered)
- `MAIN-LOGIC SECTION.` → extracted
- Reserved-word section names filtered (e.g., `CALL SECTION.` → skipped)

**`extractFromCobol` — PARAGRAPH**:
- Paragraph in PROCEDURE DIVISION detected
- Paragraph outside PROCEDURE DIVISION ignored
- Hyphenated paragraph name captured fully
- Reserved words filtered
- End line set to next paragraph/section

**`extractFromCobol` — PERFORM**:
- `PERFORM PARA-NAME` → rawCall with calleeName `PARA-NAME`
- `PERFORM` in DATA DIVISION → not captured (after fix 2.2)
- `PERFORM` in comment → not captured (after fix 1.1)
- Reserved words as PERFORM targets filtered

**`extractFromCobol` — CALL**:
- `CALL "SUB-PROG"` → rawCall with calleeName `SUB-PROG`
- `CALL` in comment → not captured
- `CALL` in DATA DIVISION → not captured (after fix 2.2)

**`extractImports` — COBOL**:
- `COPY "member.cpy"` → import with moduleSpecifier `member.cpy`
- `COPY 'member.cpy'` → same
- `COPY MEMBER.` → bare import
- `COPY MEMBER OF LIBRARY` → import for `MEMBER`
- `COPY REPLACING.` → filtered (REPLACING is keyword)
- `EXEC SQL INCLUDE member END-EXEC` → import
- `EXEC SQL INCLUDE "file.sql" END-EXEC` → import
- COPY in comment → not captured (after fix 1.1)

**`resolveImport` — COBOL**:
- Quoted path with extension → resolves directly
- Bare identifier → searches same dir, then copybook dirs, then project-wide
- Non-existent file → returns null

#### Mock Data

Create a fixture file `tests/fixtures/cobol/sample.cbl` with a realistic COBOL program:

```cobol
       IDENTIFICATION DIVISION.
       PROGRAM-ID. HELLO-WORLD.
       ENVIRONMENT DIVISION.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-NAME PIC X(20).
       PROCEDURE DIVISION.
       MAIN-LOGIC SECTION.
       0000-MAIN.
           PERFORM GREET-USER
           CALL "SUB-PROG" USING WS-NAME
           GOBACK
           .
       GREET-USER.
           DISPLAY "HELLO"
           .
      *    PERFORM OLD-ROUTINE.
      *    CALL DEAD-CODE.
```

And a copybook `tests/fixtures/cobol/copybook/vars.cpy`:
```cobol
       01 WS-COPYBOOK-VAR PIC 9(4).
```

---

## Phase 2 Summary

| Fix | File(s) | Lines Changed |
|-----|---------|---------------|
| 2.1 DIVISION extraction | `types.ts`, `graph-symbols.ts` | ~30 |
| 2.2 Scope restriction | `graph-symbols.ts` | ~15 |
| 2.3 Unit tests | New: `tests/cobol-extraction.test.ts`, fixtures | ~300 |

**After Phase 2**: COBOL parsing has complete structural coverage (program → division → section → paragraph) with call detection scoped correctly, backed by test coverage.
