import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { DuplicatePlan } from "./duplicate";
import { GenerationPlan } from "./recipes";
import { renderPlain, renderSnippet } from "./templating";

export type ApplyResult =
  | { status: "created"; created: string[] }
  | { status: "cancelled" };

const readTemplate = (templatePath: string) =>
  fs.promises.readFile(templatePath, "utf-8");

const exists = (target: string) => {
  try {
    fs.statSync(target);
    return true;
  } catch {
    return false;
  }
};

/**
 * Generation happens in two passes on purpose.
 *
 * The files land on disk with their tab stops collapsed to fallbacks, so what
 * is saved is always valid code. Only then is the primary file reopened and its
 * contents replaced by the snippet form — same text, but with the tab stops
 * live, so the cursor is sitting on the first thing you actually have to type.
 * Abandoning the snippet session therefore costs nothing: the saved file is
 * already the code the old script-based generator would have produced.
 */
export const applyPlan = async (
  plan: GenerationPlan
): Promise<ApplyResult> => {
  const rendered = await Promise.all(
    plan.files.map(async (file) => {
      const template = await readTemplate(file.templatePath);
      return {
        ...file,
        plain: renderPlain(template, file.context),
        snippet: renderSnippet(template, file.context),
      };
    })
  );

  const clashes = rendered.filter((file) => exists(file.absolutePath));

  if (clashes.length) {
    const names = clashes.map((file) => path.basename(file.absolutePath));
    const choice = await vscode.window.showWarningMessage(
      `${names.join(", ")} already ${
        names.length === 1 ? "exists" : "exist"
      } in this folder.`,
      { modal: true, detail: "Overwriting cannot be undone from the editor." },
      "Overwrite"
    );

    if (choice !== "Overwrite") {
      return { status: "cancelled" };
    }
  }

  await vscode.workspace.fs.createDirectory(vscode.Uri.file(plan.folder));

  // One WorkspaceEdit so the whole generation is a single undo.
  const edit = new vscode.WorkspaceEdit();

  for (const file of rendered) {
    edit.createFile(vscode.Uri.file(file.absolutePath), {
      overwrite: true,
      contents: Buffer.from(file.plain, "utf-8"),
    });
  }

  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error("The editor refused the generated files.");
  }

  const primary = rendered.find((file) => file.absolutePath === plan.primary);

  if (primary) {
    const uri = vscode.Uri.file(primary.absolutePath);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
    });

    const whole = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );

    await editor.insertSnippet(new vscode.SnippetString(primary.snippet), whole);
  }

  return {
    status: "created",
    created: rendered.map((file) => file.absolutePath),
  };
};

/**
 * Copies a duplicate onto disk in one WorkspaceEdit, so an unwanted duplicate
 * is one Ctrl+Z away. That is deliberately instead of a dry-run mode: seeing
 * the real files and undoing beats reading a list of what would happen.
 */
export const applyDuplicate = async (plan: DuplicatePlan) => {
  const edit = new vscode.WorkspaceEdit();

  for (const file of plan.files) {
    edit.createFile(vscode.Uri.file(file.absolutePath), {
      overwrite: false,
      ignoreIfExists: false,
      contents: file.contents,
    });
  }

  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error("The editor refused the duplicated files.");
  }

  // Opening the file that most looks like the folder's entry point: the one
  // whose name matches the folder, else simply the first.
  const folderName = path.basename(plan.destination);
  const entry =
    plan.files.find(
      (file) => path.basename(file.absolutePath).split(".")[0] === folderName
    ) ?? plan.files[0];

  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(entry.absolutePath)
  );
  await vscode.window.showTextDocument(document, { preview: false });
};
