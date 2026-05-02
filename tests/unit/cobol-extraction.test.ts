// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stripCobolComments, parseCobolComments } from "../../src/services/cobol-utils.js";
import { extractImports } from "../../src/services/graph-imports.js";
import { resolveImport } from "../../src/services/graph-resolution.js";
import {
  extractSymbolsAndCalls,
} from "../../src/services/graph-symbols.js";

// ── Helper to create temp project layouts ─────────────────────────────

interface TempProject {
  root: string;
  fileSet: Set<string>;
  cleanup: () => void;
}

function createTempProject(
  files: Record<string, string>,
): TempProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-cobol-"));
  const fileSet = new Set<string>();

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    fileSet.add(relPath);
  }

  return {
    root,
    fileSet,
    cleanup: () => {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Indent for COBOL fixed-format Area A (columns 8-11).
 * Current regex uses \s{0,6}, so we use 6 spaces to match.
 * Phase 3.4 will relax this to \s* for free-format support.
 */
const A = "      "; // 6 spaces

function extractCobolSymbols(source: string) {
  return extractSymbolsAndCalls(source, "cobol", ".cbl", "test.cbl");
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("COBOL support", () => {

  // ── stripCobolComments ───────────────────────────────────────────────

  describe("stripCobolComments", () => {
    it("strips fixed-format comment (* in column 7)", () => {
      const src = "      * THIS IS A COMMENT\n       MOVE 1 TO X.";
      const result = stripCobolComments(src);
      const lines = result.split("\n");
      expect(lines[0]!.trim()).toBe("");
      expect(lines[1]!.trim()).toContain("MOVE 1 TO X");
    });

    it("strips page-break comment (/ in column 7)", () => {
      const src = "      / PAGE BREAK COMMENT\n       DISPLAY 'X'.";
      const result = stripCobolComments(src);
      const lines = result.split("\n");
      expect(lines[0]!.trim()).toBe("");
      expect(lines[1]!.trim()).toContain("DISPLAY");
    });

    it("strips free-format comment (*>)", () => {
      const src = "           MOVE 1 TO X.  *> inline comment";
      const result = stripCobolComments(src);
      expect(result).not.toContain("inline comment");
      expect(result).toContain("MOVE 1 TO X");
    });

    it("preserves code lines unchanged", () => {
      const src = "           MOVE 1 TO X.\n           DISPLAY 'HELLO'.";
      const result = stripCobolComments(src);
      expect(result).toContain("MOVE 1 TO X.");
      expect(result).toContain("DISPLAY 'HELLO'.");
    });

    it("preserves line count (empty lines replace comments)", () => {
      const src = "line1\n      * comment\nline3";
      const result = stripCobolComments(src);
      expect(result.split("\n").length).toBe(3);
    });

    it("handles source with no comments", () => {
      const src = "           MOVE 1 TO X.";
      const result = stripCobolComments(src);
      expect(result).toBe(src);
    });
  });

  // ── extractFromCobol — PROGRAM-ID ────────────────────────────────────

  describe("extractFromCobol — PROGRAM-ID", () => {
    it("extracts PROGRAM-ID with period notation", () => {
      const src = `${A}PROGRAM-ID. HELLO-WORLD.`;
      const { symbols } = extractCobolSymbols(src);
      const prog = symbols.find(s => s.kind === "program");
      expect(prog).toBeDefined();
      expect(prog!.name).toBe("HELLO-WORLD");
    });

    it("extracts PROGRAM-ID with IS keyword", () => {
      const src = `${A}PROGRAM-ID IS MYPROG.`;
      const { symbols } = extractCobolSymbols(src);
      const prog = symbols.find(s => s.kind === "program");
      expect(prog).toBeDefined();
      expect(prog!.name).toBe("MYPROG");
    });

    it("preserves hyphenated program names", () => {
      const src = `${A}PROGRAM-ID. MY-COBOL-APP-V2.`;
      const { symbols } = extractCobolSymbols(src);
      const prog = symbols.find(s => s.kind === "program");
      expect(prog!.name).toBe("MY-COBOL-APP-V2");
    });
  });

  // ── extractFromCobol — DIVISION ─────────────────────────────────────

  describe("extractFromCobol — DIVISION", () => {
    it("extracts all four standard divisions", () => {
      const src = [
        `${A}IDENTIFICATION DIVISION.`,
        `${A}PROGRAM-ID. TEST.`,
        `${A}ENVIRONMENT DIVISION.`,
        `${A}DATA DIVISION.`,
        `${A}PROCEDURE DIVISION.`,
        `${A}0000-MAIN.`,
        `           GOBACK.`,
        "           .",
      ].join("\n");

      const { symbols } = extractCobolSymbols(src);
      const divisions = symbols.filter(s => s.kind === "division");
      const names = divisions.map(s => s.name);
      expect(names).toContain("IDENTIFICATION");
      expect(names).toContain("ENVIRONMENT");
      expect(names).toContain("DATA");
      expect(names).toContain("PROCEDURE");
    });

    it("sets qualified name with program prefix", () => {
      const src = [
        `${A}IDENTIFICATION DIVISION.`,
        `${A}PROGRAM-ID. PAYROLL.`,
        `${A}PROCEDURE DIVISION.`,
        `${A}0000-MAIN.`,
        "           GOBACK.",
        "           .",
      ].join("\n");

      const { symbols } = extractCobolSymbols(src);
      const procDiv = symbols.find(s => s.kind === "division" && s.name === "PROCEDURE");
      expect(procDiv!.qualifiedName).toBe("PAYROLL.PROCEDURE");
    });

    it("computes correct endLine for each division", () => {
      const src = [
        `${A}IDENTIFICATION DIVISION.`,
        `${A}PROGRAM-ID. TEST.`,
        `${A}DATA DIVISION.`,
        `${A}PROCEDURE DIVISION.`,
        `${A}0000-MAIN.`,
        "           GOBACK.",
        "           .",
      ].join("\n");

      const { symbols } = extractCobolSymbols(src);
      const identDiv = symbols.find(s => s.kind === "division" && s.name === "IDENTIFICATION");
      const dataDiv = symbols.find(s => s.kind === "division" && s.name === "DATA");
      const procDiv = symbols.find(s => s.kind === "division" && s.name === "PROCEDURE");

      // IDENTIFICATION ends at line 2 (line before DATA starts at 3)
      expect(identDiv!.endLine).toBe(2);
      // DATA ends at line 3 (line before PROCEDURE starts at 4)
      expect(dataDiv!.endLine).toBe(3);
      // PROCEDURE ends at EOF
      expect(procDiv!.endLine).toBe(7);
    });
  });

  // ── extractFromCobol — SECTION ──────────────────────────────────────

  describe("extractFromCobol — SECTION", () => {
    it("extracts FILE SECTION", () => {
      const src = [
        `${A}DATA DIVISION.`,
        `${A}FILE SECTION.`,
        `${A}01 WS-REC PIC X(10).`,
      ].join("\n");

      const { symbols } = extractCobolSymbols(src);
      const sec = symbols.find(s => s.kind === "section" && s.name === "FILE");
      expect(sec).toBeDefined();
    });

    it("extracts WORKING-STORAGE SECTION", () => {
      const src = [
        `${A}DATA DIVISION.`,
        `${A}WORKING-STORAGE SECTION.`,
        `${A}01 WS-NAME PIC X(20).`,
      ].join("\n");

      const { symbols } = extractCobolSymbols(src);
      const sec = symbols.find(s => s.kind === "section" && s.name === "WORKING-STORAGE");
      expect(sec).toBeDefined();
    });

    it("extracts custom sections", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `${A}MAIN-LOGIC SECTION.`,
        `${A}0000-MAIN.`,
        "           GOBACK.",
        "           .",
      ].join("\n");

      const { symbols } = extractCobolSymbols(src);
      const sec = symbols.find(s => s.kind === "section" && s.name === "MAIN-LOGIC");
      expect(sec).toBeDefined();
      expect(sec!.qualifiedName).toMatch(/MAIN-LOGIC$/);
    });
  });

  // ── extractFromCobol — PARAGRAPH ────────────────────────────────────

  describe("extractFromCobol — PARAGRAPH", () => {
    it("extracts paragraphs in PROCEDURE DIVISION", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `${A}0000-MAIN.`,
        "           GOBACK.",
        "           .",
        `${A}GREET-USER.`,
        "           DISPLAY 'HELLO'.",
        "           .",
      ].join("\n");

      const { symbols } = extractCobolSymbols(src);
      const paras = symbols.filter(s => s.kind === "paragraph");
      const names = paras.map(s => s.name);
      expect(names).toContain("0000-MAIN");
      expect(names).toContain("GREET-USER");
    });

    it("ignores paragraphs outside PROCEDURE DIVISION", () => {
      const src = [
        `${A}DATA DIVISION.`,
        `${A}FAKE-PARA.`,
        `${A}PROCEDURE DIVISION.`,
        `${A}REAL-PARA.`,
        "           GOBACK.",
        "           .",
      ].join("\n");

      const { symbols } = extractCobolSymbols(src);
      const paras = symbols.filter(s => s.kind === "paragraph");
      expect(paras.map(s => s.name)).not.toContain("FAKE-PARA");
      expect(paras.map(s => s.name)).toContain("REAL-PARA");
    });

    it("captures hyphenated paragraph names", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `${A}CALC-TAX-SHIPPING.`,
        "           GOBACK.",
        "           .",
      ].join("\n");

      const { symbols } = extractCobolSymbols(src);
      const para = symbols.find(s => s.kind === "paragraph");
      expect(para).toBeDefined();
      expect(para!.name).toBe("CALC-TAX-SHIPPING");
    });

    it("filters reserved words as paragraph names", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `${A}DISPLAY.`,
        "           GOBACK.",
        "           .",
      ].join("\n");

      const { symbols } = extractCobolSymbols(src);
      const paras = symbols.filter(s => s.kind === "paragraph");
      expect(paras.map(s => s.name)).not.toContain("DISPLAY");
    });

    it("sets endLine to next paragraph or section", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `${A}PARA-A.`,
        "           MOVE 1 TO X.",
        `${A}PARA-B.`,
        "           MOVE 2 TO Y.",
        `${A}PARA-C.`,
        "           GOBACK.",
        "           .",
      ].join("\n");

      const { symbols } = extractCobolSymbols(src);
      const paraA = symbols.find(s => s.kind === "paragraph" && s.name === "PARA-A");
      const paraB = symbols.find(s => s.kind === "paragraph" && s.name === "PARA-B");
      // PARA-A should end before PARA-B
      // Note: endLine uses 0-indexed convention — known pre-existing behavior
      expect(paraA!.endLine).toBe(3);
      // PARA-B should end before PARA-C
      expect(paraB!.endLine).toBe(5);
    });
  });

  // ── extractFromCobol — PERFORM ──────────────────────────────────────

  describe("extractFromCobol — PERFORM", () => {
    it("detects PERFORM calls", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `${A}0000-MAIN.`,
        "           PERFORM GREET-USER",
        "           GOBACK.",
        "           .",
        `${A}GREET-USER.`,
        "           DISPLAY 'HELLO'.",
        "           .",
      ].join("\n");

      const { rawCalls } = extractCobolSymbols(src);
      const performCall = rawCalls.find(c => c.calleeName === "GREET-USER");
      expect(performCall).toBeDefined();
      expect(performCall!.callSite.line).toBe(3);
    });

    it("ignores PERFORM in DATA DIVISION", () => {
      const src = [
        `${A}DATA DIVISION.`,
        `${A}01 WS-FIELD PIC X(10) VALUE 'PERFORM FAKE-PARA'.`,
        `${A}PROCEDURE DIVISION.`,
        `${A}0000-MAIN.`,
        "           PERFORM REAL-PARA",
        "           GOBACK.",
        "           .",
        `${A}REAL-PARA.`,
        "           GOBACK.",
        "           .",
      ].join("\n");

      const { rawCalls } = extractCobolSymbols(src);
      expect(rawCalls.map(c => c.calleeName)).not.toContain("FAKE-PARA");
      expect(rawCalls.map(c => c.calleeName)).toContain("REAL-PARA");
    });

    it("ignores PERFORM in comment lines", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `${A}0000-MAIN.`,
        "           PERFORM REAL-PARA",
        "           GOBACK.",
        "           .",
        `${A}REAL-PARA.`,
        "           GOBACK.",
        "           .",
        "      *    PERFORM OLD-ROUTINE.",
        "      *    PERFORM DEAD-CODE.",
      ].join("\n");

      const { rawCalls } = extractCobolSymbols(src);
      expect(rawCalls.map(c => c.calleeName)).not.toContain("OLD-ROUTINE");
      expect(rawCalls.map(c => c.calleeName)).not.toContain("DEAD-CODE");
      expect(rawCalls.map(c => c.calleeName)).toContain("REAL-PARA");
    });

    it("filters reserved words as PERFORM targets", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `${A}0000-MAIN.`,
        "           PERFORM CALC-X",
        "           GOBACK.",
        "           .",
        `${A}CALC-X.`,
        "           GOBACK.",
        "           .",
      ].join("\n");

      const { rawCalls } = extractCobolSymbols(src);
      // PERFORM itself should not appear as a callee
      expect(rawCalls.map(c => c.calleeName)).not.toContain("PERFORM");
    });
  });

  // ── extractFromCobol — CALL ─────────────────────────────────────────

  describe("extractFromCobol — CALL", () => {
    it("detects CALL with quoted program name", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `${A}0000-MAIN.`,
        '           CALL "SUB-PROG" USING WS-NAME',
        "           GOBACK.",
        "           .",
      ].join("\n");

      const { rawCalls } = extractCobolSymbols(src);
      const call = rawCalls.find(c => c.calleeName === "SUB-PROG");
      expect(call).toBeDefined();
    });

    it("detects CALL with single-quoted program name", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `${A}0000-MAIN.`,
        "           CALL 'OTHER-PROG'",
        "           GOBACK.",
        "           .",
      ].join("\n");

      const { rawCalls } = extractCobolSymbols(src);
      const call = rawCalls.find(c => c.calleeName === "OTHER-PROG");
      expect(call).toBeDefined();
    });

    it("detects CALL with bare identifier", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `${A}0000-MAIN.`,
        "           CALL LINK-TO-PROGRAM",
        "           GOBACK.",
        "           .",
      ].join("\n");

      const { rawCalls } = extractCobolSymbols(src);
      const call = rawCalls.find(c => c.calleeName === "LINK-TO-PROGRAM");
      expect(call).toBeDefined();
    });

    it("ignores CALL in DATA DIVISION", () => {
      const src = [
        `${A}DATA DIVISION.`,
        `${A}01 WS-DESC PIC X(30) VALUE 'CALL FAKE'.`,
        `${A}PROCEDURE DIVISION.`,
        `${A}0000-MAIN.`,
        '           CALL "REAL-PROG"',
        "           GOBACK.",
        "           .",
      ].join("\n");

      const { rawCalls } = extractCobolSymbols(src);
      expect(rawCalls.map(c => c.calleeName)).not.toContain("FAKE");
      expect(rawCalls.map(c => c.calleeName)).toContain("REAL-PROG");
    });

    it("ignores CALL in comment lines", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `${A}0000-MAIN.`,
        '           CALL "REAL-PROG"',
        "           GOBACK.",
        "           .",
        "      *    CALL DEAD-CODE.",
      ].join("\n");

      const { rawCalls } = extractCobolSymbols(src);
      expect(rawCalls.map(c => c.calleeName)).not.toContain("DEAD-CODE");
      expect(rawCalls.map(c => c.calleeName)).toContain("REAL-PROG");
    });
  });

  // ── extractFromCobol — No PROCEDURE DIVISION ────────────────────────

  describe("extractFromCobol — edge cases", () => {
    it("returns no rawCalls when PROCEDURE DIVISION is missing", () => {
      const src = [
        `${A}IDENTIFICATION DIVISION.`,
        `${A}PROGRAM-ID. NO-PROC.`,
        `${A}DATA DIVISION.`,
        `${A}WORKING-STORAGE SECTION.`,
        `${A}01 WS-X PIC 9.`,
      ].join("\n");

      const { rawCalls } = extractCobolSymbols(src);
      expect(rawCalls).toHaveLength(0);
    });
  });

  // ── extractFromCobol — fixture file ─────────────────────────────────

  describe("extractFromCobol — fixture sample.cbl", () => {
    const fixturePath = path.resolve(
      __dirname, "../fixtures/cobol/sample.cbl",
    );
    let fixtureSrc: string;

    it("reads fixture file", () => {
      fixtureSrc = fs.readFileSync(fixturePath, "utf-8");
      expect(fixtureSrc.length).toBeGreaterThan(0);
    });

    it("extracts program, divisions, sections, and paragraphs", () => {
      const { symbols } = extractCobolSymbols(fixtureSrc);
      const byKind = (k: string) => symbols.filter(s => s.kind === k).map(s => s.name);

      expect(byKind("program")).toContain("HELLO-WORLD");
      expect(byKind("division")).toContain("IDENTIFICATION");
      expect(byKind("division")).toContain("ENVIRONMENT");
      expect(byKind("division")).toContain("DATA");
      expect(byKind("division")).toContain("PROCEDURE");
      expect(byKind("section")).toContain("FILE");
      expect(byKind("section")).toContain("WORKING-STORAGE");
      expect(byKind("section")).toContain("MAIN-LOGIC");
      expect(byKind("paragraph")).toContain("0000-MAIN");
      expect(byKind("paragraph")).toContain("GREET-USER");
    });

    it("detects PERFORM GREET-USER and CALL SUB-PROG", () => {
      const { rawCalls } = extractCobolSymbols(fixtureSrc);
      const names = rawCalls.map(c => c.calleeName);
      expect(names).toContain("GREET-USER");
      expect(names).toContain("SUB-PROG");
    });

    it("does NOT detect calls from commented lines", () => {
      const { rawCalls } = extractCobolSymbols(fixtureSrc);
      const names = rawCalls.map(c => c.calleeName);
      expect(names).not.toContain("OLD-ROUTINE");
      expect(names).not.toContain("DEAD-CODE");
    });
  });

  // ── extractImports — COBOL ──────────────────────────────────────────

  describe("extractImports — COBOL", () => {
    it("extracts COPY with double-quoted path", () => {
      const src = `${A}COPY "member.cpy".`;
      const imports = extractImports(src, "cobol", ".cbl");
      expect(imports).toHaveLength(1);
      expect(imports[0]!.moduleSpecifier).toBe("member.cpy");
      expect(imports[0]!.isDynamic).toBe(false);
    });

    it("extracts COPY with single-quoted path", () => {
      const src = `${A}COPY 'member.cpy'.`;
      const imports = extractImports(src, "cobol", ".cbl");
      expect(imports).toHaveLength(1);
      expect(imports[0]!.moduleSpecifier).toBe("member.cpy");
    });

    it("extracts COPY bare identifier", () => {
      const src = `${A}COPY MEMBER.`;
      const imports = extractImports(src, "cobol", ".cbl");
      expect(imports).toHaveLength(1);
      expect(imports[0]!.moduleSpecifier).toBe("MEMBER");
    });

    it("extracts COPY member OF library", () => {
      const src = `${A}COPY MEMBER OF LIBRARY.`;
      const imports = extractImports(src, "cobol", ".cbl");
      expect(imports).toHaveLength(1);
      expect(imports[0]!.moduleSpecifier).toBe("MEMBER");
    });

    it("extracts COPY member IN library", () => {
      const src = `${A}COPY MEMBER IN LIBRARY.`;
      const imports = extractImports(src, "cobol", ".cbl");
      expect(imports).toHaveLength(1);
      expect(imports[0]!.moduleSpecifier).toBe("MEMBER");
    });

    it("filters COPY REPLACING as keyword", () => {
      const src = `${A}COPY REPLACING.`;
      const imports = extractImports(src, "cobol", ".cbl");
      expect(imports).toHaveLength(0);
    });

    it("extracts EXEC SQL INCLUDE bare identifier", () => {
      const src = "           EXEC SQL INCLUDE DCLGEN END-EXEC";
      const imports = extractImports(src, "cobol", ".cbl");
      expect(imports).toHaveLength(1);
      expect(imports[0]!.moduleSpecifier).toBe("DCLGEN");
    });

    it("extracts EXEC SQL INCLUDE quoted path", () => {
      const src = '           EXEC SQL INCLUDE "query.sql" END-EXEC';
      const imports = extractImports(src, "cobol", ".cbl");
      expect(imports).toHaveLength(1);
      expect(imports[0]!.moduleSpecifier).toBe("query.sql");
    });

    it("does not extract COPY from comment lines", () => {
      const src = [
        "      *    COPY OLD-MEMBER.",
        `${A}COPY "REAL-MEMBER.cpy".`,
      ].join("\n");

      const imports = extractImports(src, "cobol", ".cbl");
      expect(imports).toHaveLength(1);
      expect(imports[0]!.moduleSpecifier).toBe("REAL-MEMBER.cpy");
    });
  });

  // ── resolveImport — COBOL ───────────────────────────────────────────

  describe("resolveImport — COBOL", () => {
    let project: TempProject | null = null;

    afterEach(() => {
      project?.cleanup();
      project = null;
    });

    it("resolves quoted path with extension in same directory", () => {
      project = createTempProject({
        "src/main.cbl": "",
        "src/vars.cpy": "",
      });

      const result = resolveImport(
        "vars.cpy",
        path.join(project.root, "src/main.cbl"),
        project.root,
        project.fileSet,
        "cobol",
      );

      expect(result).toBe("src/vars.cpy");
    });

    it("resolves bare identifier with .cpy extension in same directory", () => {
      project = createTempProject({
        "src/main.cbl": "",
        "src/MEMBER.cpy": "",
      });

      const result = resolveImport(
        "MEMBER",
        path.join(project.root, "src/main.cbl"),
        project.root,
        project.fileSet,
        "cobol",
      );

      expect(result).toBe("src/MEMBER.cpy");
    });

    it("falls back to copybook/ subdirectory", () => {
      project = createTempProject({
        "src/main.cbl": "",
        "copybook/SHARED.cpy": "",
      });

      const result = resolveImport(
        "SHARED",
        path.join(project.root, "src/main.cbl"),
        project.root,
        project.fileSet,
        "cobol",
      );

      expect(result).toBe("copybook/SHARED.cpy");
    });

    it("returns null for non-existent file", () => {
      project = createTempProject({
        "src/main.cbl": "",
      });

      const result = resolveImport(
        "NONEXISTENT",
        path.join(project.root, "src/main.cbl"),
        project.root,
        project.fileSet,
        "cobol",
      );

      expect(result).toBeNull();
    });

    it("resolves .cbl extension for bare identifier", () => {
      project = createTempProject({
        "src/main.cbl": "",
        "src/helper.cbl": "",
      });

      const result = resolveImport(
        "helper",
        path.join(project.root, "src/main.cbl"),
        project.root,
        project.fileSet,
        "cobol",
      );

      expect(result).toBe("src/helper.cbl");
    });

    it("resolves fixture copybook vars.cpy", () => {
      project = createTempProject({
        "src/main.cbl": "",
        "copybook/vars.cpy": "       01 WS-VAR PIC 9(4).",
      });

      const result = resolveImport(
        "vars",
        path.join(project.root, "src/main.cbl"),
        project.root,
        project.fileSet,
        "cobol",
      );

      expect(result).toBe("copybook/vars.cpy");
    });
  });

  // ── parseCobolComments (Phase 5) ─────────────────────────────────────

  describe("parseCobolComments", () => {
    it("returns both cleanSource and comments", () => {
      const src = "      * COMMENT LINE\n       MOVE 1 TO X.";
      const { cleanSource, comments } = parseCobolComments(src);
      expect(cleanSource.split("\n").length).toBe(2);
      expect(cleanSource).not.toContain("COMMENT");
      expect(comments).toHaveLength(1);
      expect(comments[0]!.text).toBe("COMMENT LINE");
      expect(comments[0]!.line).toBe(1);
      expect(comments[0]!.isPageBreak).toBe(false);
    });

    it("collects page-break comments with isPageBreak=true", () => {
      const src = "      / PAGE BREAK\n       DISPLAY 'X'.";
      const { comments } = parseCobolComments(src);
      expect(comments).toHaveLength(1);
      expect(comments[0]!.isPageBreak).toBe(true);
      expect(comments[0]!.text).toBe("PAGE BREAK");
    });

    it("collects free-format *> comments", () => {
      const src = "       MOVE 1 TO X.  *> inline comment\n       DISPLAY 'Y'.";
      const { cleanSource, comments } = parseCobolComments(src);
      expect(cleanSource).toContain("MOVE 1 TO X.");
      expect(cleanSource).not.toContain("inline comment");
      expect(comments).toHaveLength(1);
      expect(comments[0]!.text).toBe("inline comment");
    });

    it("collects multiple comments", () => {
      const src = [
        "      * FIRST COMMENT",
        "      * SECOND COMMENT",
        "       MOVE 1 TO X.",
      ].join("\n");
      const { comments } = parseCobolComments(src);
      expect(comments).toHaveLength(2);
      expect(comments[0]!.text).toBe("FIRST COMMENT");
      expect(comments[1]!.text).toBe("SECOND COMMENT");
    });

    it("returns empty comments array for source with no comments", () => {
      const src = "       MOVE 1 TO X.";
      const { cleanSource, comments } = parseCobolComments(src);
      expect(comments).toHaveLength(0);
      expect(cleanSource).toBe(src);
    });

    it("preserves line count in cleanSource", () => {
      const src = "line1\n      * comment\nline3\n      * another\nline5";
      const { cleanSource } = parseCobolComments(src);
      expect(cleanSource.split("\n").length).toBe(5);
    });
  });

  // ── Comment annotation attachment (Phase 5) ───────────────────────────

  describe("extractFromCobol — annotation attachment", () => {
    it("attaches leading comments as annotation to a paragraph", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `      * HANDLES THE MAIN LOGIC`,
        `      * FOR MONTHLY REPORTING`,
        `${A}MAIN-PARA.`,
        "           GOBACK.",
        "           .",
      ].join("\n");
      const { symbols } = extractCobolSymbols(src);
      const para = symbols.find(s => s.kind === "paragraph" && s.name === "MAIN-PARA");
      expect(para).toBeDefined();
      expect(para!.annotation).toBeDefined();
      expect(para!.annotation).toBe("HANDLES THE MAIN LOGIC\nFOR MONTHLY REPORTING");
    });

    it("attaches single comment line as annotation", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `      * QUICK NOTE ABOUT THIS PARA`,
        `${A}SINGLE-COMMENT-PARA.`,
        "           GOBACK.",
        "           .",
      ].join("\n");
      const { symbols } = extractCobolSymbols(src);
      const para = symbols.find(s => s.kind === "paragraph" && s.name === "SINGLE-COMMENT-PARA");
      expect(para).toBeDefined();
      expect(para!.annotation).toBe("QUICK NOTE ABOUT THIS PARA");
    });

    it("does not attach annotation when no comments above", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `${A}NO-COMMENT-PARA.`,
        "           GOBACK.",
        "           .",
      ].join("\n");
      const { symbols } = extractCobolSymbols(src);
      const para = symbols.find(s => s.kind === "paragraph" && s.name === "NO-COMMENT-PARA");
      expect(para).toBeDefined();
      expect(para!.annotation).toBeUndefined();
    });

    it("allows one blank line between comment block and symbol", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `      * COMMENT ABOVE BLANK`,
        "",  // blank line
        `${A}BLANK-GAP-PARA.`,
        "           GOBACK.",
        "           .",
      ].join("\n");
      const { symbols } = extractCobolSymbols(src);
      const para = symbols.find(s => s.kind === "paragraph" && s.name === "BLANK-GAP-PARA");
      expect(para).toBeDefined();
      expect(para!.annotation).toBe("COMMENT ABOVE BLANK");
    });

    it("stops at code lines (does not attach comments from distant blocks)", () => {
      const src = [
        `${A}PROCEDURE DIVISION.`,
        `      * COMMENT FOR PARA-A`,
        `${A}PARA-A.`,
        "           MOVE 1 TO X.",
        `${A}PARA-B.`,  // no comment above — should have no annotation
        "           GOBACK.",
        "           .",
      ].join("\n");
      const { symbols } = extractCobolSymbols(src);
      const paraA = symbols.find(s => s.kind === "paragraph" && s.name === "PARA-A");
      const paraB = symbols.find(s => s.kind === "paragraph" && s.name === "PARA-B");
      expect(paraA!.annotation).toBe("COMMENT FOR PARA-A");
      expect(paraB!.annotation).toBeUndefined();
    });

    it("attaches comments to sections too", () => {
      const src = [
        `${A}PROGRAM-ID. TEST.`,
        `${A}DATA DIVISION.`,
        `      * FILE SECTION DESCRIPTIONS`,
        `${A}FILE SECTION.`,
        "       FD INPUT-FILE.",
        "       01 WS-REC PIC X(80).",
      ].join("\n");
      const { symbols } = extractCobolSymbols(src);
      const section = symbols.find(s => s.kind === "section" && s.name === "FILE");
      expect(section).toBeDefined();
      expect(section!.annotation).toBe("FILE SECTION DESCRIPTIONS");
    });
  });
});
