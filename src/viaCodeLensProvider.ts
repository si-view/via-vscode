import * as vscode from "vscode";
import { t } from "./i18n";

export class ViaCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.languageId !== "skill") {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    lenses.push(
      new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
        title: t("codelens.runFile"),
        command: "via.runFile",
        arguments: [document.uri],
      }),
    );

    for (const range of collectParagraphRanges(document)) {
      lenses.push(
        new vscode.CodeLens(range, {
          title: t("codelens.runParagraph"),
          command: "via.runSelection",
          arguments: [range],
        }),
      );
    }

    return lenses;
  }
}

function collectParagraphRanges(document: vscode.TextDocument): vscode.Range[] {
  const ranges: vscode.Range[] = [];
  let startLine: number | undefined;

  for (let line = 0; line < document.lineCount; line += 1) {
    const isBlank = document.lineAt(line).text.trim().length === 0;

    if (!isBlank && startLine === undefined) {
      startLine = line;
      continue;
    }

    if (isBlank && startLine !== undefined) {
      ranges.push(toFullLineRange(document, startLine, line - 1));
      startLine = undefined;
    }
  }

  if (startLine !== undefined) {
    ranges.push(toFullLineRange(document, startLine, document.lineCount - 1));
  }

  return ranges;
}

function toFullLineRange(
  document: vscode.TextDocument,
  startLine: number,
  endLine: number,
): vscode.Range {
  const start = new vscode.Position(startLine, 0);
  const end = document.lineAt(endLine).range.end;
  return new vscode.Range(start, end);
}
