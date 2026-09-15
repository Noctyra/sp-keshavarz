import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { findPackageRoot } from "./aliasResolver";
import { applyDuplicate, applyPlan } from "./apply";
import { inspect, planDuplicate } from "./duplicate";
import { buildGeneratorContext } from "./generatorContext";
import { buildPlan, loadRecipes, Recipe, resolveBaseFolder } from "./recipes";
import { findAnchor, inferChoice, listChoices, RecipePrompt } from "./sources";
import { parseJson, toTypeAlias, unwrapEnvelope } from "./jsonToType";
import { pascalCase } from "./templating";

const CAMEL_CASE = /^[a-z][A-Za-z0-9]*$/;

/**
 * What a keybinding can pass. Naming a `recipe` skips the picker entirely, so a
 * key can be bound straight to one generator:
 *
 *   { "key": "ctrl+alt+q", "command": "sp-keshavarz.generate",
 *     "args": { "recipe": "query" } }
 */
type GenerateArgs = { recipe?: string; uri?: string };

/**
 * The command is on the explorer context menu, but it is also reachable from the
 * command palette, where there is no uri — fall back to whatever is in focus so
 * the palette (and any keybinding) works without touching the mouse.
 */
const resolveClickedFolder = (uri?: vscode.Uri) => {
  const candidate =
    uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;

  if (candidate) {
    try {
      return fs.statSync(candidate).isDirectory()
        ? candidate
        : path.dirname(candidate);
    } catch {
      // Fall through to the workspace root.
    }
  }

  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
};

/**
 * A recipe that names the folder you are standing in is almost always the one
 * you want, so it goes to the top: right-clicking `queries` puts Query first.
 */
const byRelevance = (recipes: Recipe[], folder: string) => {
  const here = path.basename(folder).toLowerCase();

  return [...recipes].sort((a, b) => {
    const scoreA = a.hints.some((hint) => hint.toLowerCase() === here) ? 0 : 1;
    const scoreB = b.hints.some((hint) => hint.toLowerCase() === here) ? 0 : 1;
    return scoreA - scoreB || a.order - b.order;
  });
};

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("My Workflow");

  const builtInRecipes = path.join(context.extensionPath, "recipes");

  /**
   * Recipes are re-read on every run rather than cached at activation, so
   * editing a recipe takes effect on the next generate — no window reload.
   */
  const recipes = () => {
    const { recipes: loaded, problems } = loadRecipes([builtInRecipes]);

    for (const problem of problems) {
      output.appendLine(`  ! ${problem}`);
      vscode.window.showWarningMessage(`Recipe skipped — ${problem}`);
    }

    return loaded;
  };

  const pickRecipe = async (available: Recipe[]) => {
    const picked = await vscode.window.showQuickPick(
      available.map((recipe) => ({
        label: recipe.label,
        detail: recipe.detail,
        recipe,
      })),
      { placeHolder: "What do you want to generate?", matchOnDetail: true }
    );

    return picked?.recipe;
  };

  const askForName = (recipe: Recipe) =>
    vscode.window.showInputBox({
      prompt: `${recipe.noun} name (camelCase)`,
      placeHolder: recipe.placeholder,
      validateInput: (value) => {
        if (!value) {
          return `${recipe.noun} name is required.`;
        }
        if (!CAMEL_CASE.test(value)) {
          return `${recipe.noun} name must be camelCase (e.g. ${recipe.example})`;
        }
        return null;
      },
    });

  /**
   * A prompt whose choices came up empty falls back to a free-text box rather
   * than dead-ending: the folder it reads may simply not exist in this project.
   *
   * When the recipe would redirect somewhere else, "Here" is offered first so a
   * chooser can never trap you into generating away from the folder you picked.
   */
  const askForChoice = async (
    prompt: RecipePrompt,
    choices: string[],
    hereLabel?: string
  ): Promise<{ value?: string; here?: boolean } | undefined> => {
    if (!choices.length && !hereLabel) {
      const typed = await vscode.window.showInputBox({
        prompt: prompt.label,
        placeHolder: "Nothing found to choose from — type a value",
      });

      return typed === undefined ? undefined : { value: typed };
    }

    const items = [
      ...(hereLabel
        ? [{ label: `$(file-directory) ${hereLabel}`, here: true, value: "" }]
        : []),
      ...choices.map((choice) => ({ label: choice, here: false, value: choice })),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: prompt.label,
      matchOnDetail: true,
    });

    return picked ? { value: picked.value, here: picked.here } : undefined;
  };

  /** Undefined means the user dismissed the picker; {} means "none selected". */
  const askForOptions = async (recipe: Recipe) => {
    if (!recipe.options.length) {
      return {};
    }

    const picked = await vscode.window.showQuickPick(
      recipe.options.map((option) => ({
        label: option.label,
        detail: option.detail,
        option,
      })),
      {
        canPickMany: true,
        placeHolder: `${recipe.noun} options (Space to toggle, Enter to confirm)`,
      }
    );

    if (!picked) {
      return undefined;
    }

    const flags: Record<string, boolean> = {};

    for (const option of recipe.options) {
      flags[option.name] = picked.some(
        (entry) => entry.option.name === option.name
      );
    }

    return flags;
  };

  const run = async (
    recipe: Recipe,
    vars: Record<string, string>,
    folder: string,
    flags: Record<string, boolean>,
    workspaceRoot?: string
  ) => {
    const generatorContext = buildGeneratorContext(folder, workspaceRoot);
    const enabled = Object.keys(flags).filter((flag) => flags[flag]);

    output.appendLine(`$ ${recipe.id} ${vars.name}`);
    output.appendLine(`  folder: ${folder}`);
    output.appendLine(`  recipe: ${recipe.dir}`);
    output.appendLine(`  tsconfig: ${generatorContext.configFile ?? "none"}`);
    output.appendLine(
      `  alias: ${
        generatorContext.alias
          ? `${generatorContext.alias.prefix}* -> ${generatorContext.alias.baseDir}`
          : "none (relative imports)"
      }`
    );

    if (enabled.length) {
      output.appendLine(`  options: ${enabled.join(", ")}`);
    }

    for (const warning of generatorContext.warnings) {
      output.appendLine(`  ! ${warning}`);
      vscode.window.showWarningMessage(warning);
    }

    const plan = buildPlan(recipe, vars, folder, generatorContext, flags);
    const result = await applyPlan(plan);

    if (result.status === "cancelled") {
      output.appendLine("  cancelled (files already existed)");
      return;
    }

    for (const created of result.created) {
      output.appendLine(`  + ${created}`);
    }

    vscode.window.setStatusBarMessage(
      `${recipe.noun} "${vars.name}" created — Tab through the placeholders`,
      4000
    );
  };

  /**
   * One handler behind both commands. The explorer menu hands over a Uri; a
   * keybinding hands over its `args` object instead.
   */
  const generate = async (arg?: vscode.Uri | GenerateArgs) => {
    const fromExplorer = arg instanceof vscode.Uri;
    const args: GenerateArgs = fromExplorer ? {} : (arg ?? {});
    const uri = fromExplorer
      ? arg
      : args.uri
        ? vscode.Uri.file(args.uri)
        : undefined;

    const startFolder = resolveClickedFolder(uri);

    if (!startFolder) {
      vscode.window.showErrorMessage(
        "Open a folder or a file first — there is nowhere to generate into."
      );
      return;
    }

    let clicked: string = startFolder;

    const available = recipes();

    if (!available.length) {
      vscode.window.showErrorMessage(
        "No recipes found. Every generator is a folder with a recipe.json in it."
      );
      return;
    }

    const recipe = args.recipe
      ? available.find((entry) => entry.id === args.recipe)
      : await pickRecipe(byRelevance(available, clicked));

    if (args.recipe && !recipe) {
      vscode.window.showErrorMessage(
        `No recipe named "${args.recipe}". Available: ${available
          .map((entry) => entry.id)
          .join(", ")}`
      );
      return;
    }

    if (!recipe) {
      return;
    }

    const workspaceRoot = vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(clicked)
    )?.uri.fsPath;
    const packageRoot = findPackageRoot(clicked, workspaceRoot);

    // A folder picked in the explorer is an instruction and is obeyed. A folder
    // that merely happens to hold the file you have open is not, so recipes
    // with somewhere to be go and find it.
    const anchored =
      !fromExplorer && !recipe.target
        ? findAnchor(clicked, recipe.anchor, packageRoot)
        : undefined;

    if (anchored && anchored !== clicked) {
      output.appendLine(`  ~ anchored to ${anchored}`);
      clicked = anchored;
    }

    const vars: Record<string, string> = {};
    let generateHere = false;

    for (const prompt of recipe.prompts) {
      const inferred = prompt.alwaysAsk
        ? undefined
        : inferChoice(prompt.source, packageRoot, clicked);

      if (inferred) {
        output.appendLine(`  = ${prompt.name}: ${inferred} (from the folder)`);
        vars[prompt.name] = inferred;
        continue;
      }

      const here =
        recipe.target && packageRoot
          ? `Here — ${path.relative(packageRoot, clicked) || "."}`
          : undefined;

      const answer = await askForChoice(
        prompt,
        listChoices(prompt.source, packageRoot),
        here
      );

      if (!answer) {
        return;
      }

      if (answer.here) {
        generateHere = true;
        break;
      }

      vars[prompt.name] = answer.value ?? "";
    }

    const name = await askForName(recipe);
    if (!name) {
      return;
    }

    vars.name = name;

    const flags = await askForOptions(recipe);
    if (!flags) {
      return;
    }

    try {
      const folder = generateHere
        ? clicked
        : resolveBaseFolder(recipe, vars, clicked, packageRoot);
      await run(recipe, vars, folder, flags, workspaceRoot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`  x ${message}`);
      vscode.window.showErrorMessage(`Generation failed: ${message}`);
    }
  };

  /**
   * Duplicating an existing folder is the other half of generating a new one:
   * for anything more specific than a canonical shape, the most accurate
   * template is a real folder you already wrote and trust.
   */
  const duplicate = async (uri?: vscode.Uri) => {
    const source = uri?.fsPath ?? resolveClickedFolder(uri);

    if (!source) {
      vscode.window.showErrorMessage("Right-click a folder to duplicate it.");
      return;
    }

    let stem: string;
    let count: number;

    try {
      ({ stem, count } = inspect(source));
    } catch (error) {
      vscode.window.showErrorMessage(
        `Cannot read that folder: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }

    const newName = await vscode.window.showInputBox({
      prompt: `Duplicate ${count} file${count === 1 ? "" : "s"}, renaming "${stem}"`,
      placeHolder: stem,
      value: stem,
      valueSelection: [0, stem.length],
      validateInput: (value) => {
        if (!value) {
          return "A new name is required.";
        }
        if (value === stem) {
          return "That is the current name — type a different one.";
        }
        return null;
      },
    });

    if (!newName) {
      return;
    }

    try {
      const plan = planDuplicate(source, newName);

      output.appendLine(`$ duplicate ${path.basename(source)} -> ${newName}`);
      output.appendLine(`  renaming: ${plan.stem} -> ${newName}`);
      output.appendLine(`  into: ${plan.destination}`);

      await applyDuplicate(plan);

      for (const file of plan.files) {
        output.appendLine(`  + ${file.absolutePath}`);
      }

      vscode.window.setStatusBarMessage(
        `Duplicated as "${path.basename(plan.destination)}" — Ctrl+Z to undo`,
        4000
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`  x ${message}`);
      vscode.window.showErrorMessage(`Duplicate failed: ${message}`);
    }
  };

  /**
   * Writing the response type by hand is the expensive half of adding a query:
   * the skeleton is four lines, the type is forty. This turns a sample response
   * into that type, which is pure structural inference — no network, no guessing.
   */
  const typeFromJson = async () => {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showErrorMessage("Open the file you want the type in first.");
      return;
    }

    const selected = editor.document.getText(editor.selection);
    const clipboard = await vscode.env.clipboard.readText();

    // The selection wins so that JSON already pasted into the file can be
    // turned into the type in place; otherwise whatever was just copied.
    const attempts: { text: string; replacing: boolean }[] = [
      { text: selected, replacing: true },
      { text: clipboard, replacing: false },
    ];

    let sample: unknown;
    let replacing = false;
    let found = false;

    for (const attempt of attempts) {
      if (!attempt.text.trim()) {
        continue;
      }

      try {
        sample = parseJson(attempt.text);
        replacing = attempt.replacing;
        found = true;
        break;
      } catch {
        // Try the next source.
      }
    }

    if (!found) {
      const typed = await vscode.window.showInputBox({
        prompt: "Paste the JSON response",
        placeHolder: '{ "id": 1, "title": "..." }',
      });

      if (!typed) {
        return;
      }

      try {
        sample = parseJson(typed);
      } catch (error) {
        vscode.window.showErrorMessage(
          `That is not valid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return;
      }
    }

    const { value, steps } = unwrapEnvelope(sample);

    const base = path.basename(editor.document.fileName).split(".")[0];
    const folder = path.basename(path.dirname(editor.document.fileName));
    const suffix = folder.endsWith("Mutation") ? "MutationResponse" : "Response";
    const suggestion = base ? `${pascalCase(base)}${suffix}` : "Response";

    const name = await vscode.window.showInputBox({
      prompt: steps.length
        ? `Type name (unwrapped ${steps.join(" -> ")})`
        : "Type name",
      value: suggestion,
      valueSelection: [0, suggestion.length],
      validateInput: (entry) =>
        /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry)
          ? null
          : "Must be a valid TypeScript identifier.",
    });

    if (!name) {
      return;
    }

    const text = toTypeAlias(name, value);
    const edit = new vscode.WorkspaceEdit();

    edit.replace(
      editor.document.uri,
      replacing ? editor.selection : new vscode.Range(editor.selection.active, editor.selection.active),
      text
    );

    await vscode.workspace.applyEdit(edit);

    output.appendLine(`$ typeFromJson ${name}`);
    output.appendLine(`  source: ${replacing ? "selection" : "clipboard"}`);

    if (steps.length) {
      output.appendLine(`  unwrapped: ${steps.join(" -> ")}`);
    }

    vscode.window.setStatusBarMessage(
      steps.length
        ? `${name} written — unwrapped ${steps.join(" -> ")}`
        : `${name} written`,
      4000
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("sp-keshavarz.typeFromJson", typeFromJson),
    vscode.commands.registerCommand("sp-keshavarz.duplicate", duplicate),
    vscode.commands.registerCommand("sp-keshavarz.runScriptPicker", generate),
    vscode.commands.registerCommand("sp-keshavarz.generate", generate),
    output
  );
}

export function deactivate() {}
