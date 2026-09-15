import * as fs from "fs";
import * as path from "path";
import { buildImportPath, GeneratorContext } from "./generatorContext";
import { PromptSource, RecipePrompt } from "./sources";
import { RenderContext, renderInline } from "./templating";

/** One file a recipe produces. */
export type RecipeFile = {
  /** Referenced from templates as `<<import id>>`. */
  id: string;
  /** Templated, relative to the recipe's folder. */
  path: string;
  /** Template file name, resolved inside the recipe's own directory. */
  template: string;
  /** The file opened with its tab stops live. Exactly one file has it. */
  primary?: boolean;
  /** Name of an option; the file is only written when that option is on. */
  when?: string;
};

/** A yes/no shown before generating, readable from templates as `<<#if name>>`. */
export type RecipeOption = {
  name: string;
  label: string;
  detail?: string;
};

export type Recipe = {
  /** The recipe's directory name. */
  id: string;
  dir: string;
  label: string;
  detail: string;
  /** Used in prompts and messages: "Component name is required." */
  noun: string;
  placeholder: string;
  example: string;
  order: number;
  /** Templated subfolder to create, or "." to write into the clicked folder. */
  folder: string;
  options: RecipeOption[];
  /** Values chosen before generating, read out of the project itself. */
  prompts: RecipePrompt[];
  /** Package-root-relative folder to generate into, instead of the clicked one. */
  target?: string;
  /** Folder basenames that make this recipe the obvious pick. */
  hints: string[];
  /** Folder names to search upwards for when invoked without a clicked folder. */
  anchor: string[];
  files: RecipeFile[];
};

export type PlannedFile = {
  absolutePath: string;
  templatePath: string;
  context: RenderContext;
};

export type GenerationPlan = {
  /** The folder written into, for the confirmation message. */
  folder: string;
  files: PlannedFile[];
  /** Opened with its tab stops live once the files exist. */
  primary: string;
};

export type RecipeLoad = {
  recipes: Recipe[];
  /** Recipes that could not be loaded, described for the output channel. */
  problems: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value : fallback;

const asStrings = (value: unknown) =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? (value as string[])
    : undefined;

const parseSource = (
  entry: Record<string, unknown>
): PromptSource | undefined => {
  if (typeof entry.dirs === "string") {
    return { kind: "dirs", base: entry.dirs };
  }

  if (typeof entry.exports === "string") {
    return { kind: "exports", file: entry.exports };
  }

  const values = asStrings(entry.values);
  return values ? { kind: "values", values } : undefined;
};

/**
 * A recipe is rejected as a whole rather than partially applied: a half-loaded
 * generator would produce files in the wrong place, which is worse than a
 * generator that visibly refuses to appear.
 */
const parseRecipe = (
  id: string,
  dir: string,
  raw: unknown
): { recipe?: Recipe; problem?: string } => {
  if (!isRecord(raw)) {
    return { problem: `${id}: recipe.json must contain an object.` };
  }

  if (!Array.isArray(raw.files) || raw.files.length === 0) {
    return { problem: `${id}: recipe.json needs a non-empty "files" array.` };
  }

  const files: RecipeFile[] = [];

  for (const [index, entry] of raw.files.entries()) {
    if (!isRecord(entry)) {
      return { problem: `${id}: files[${index}] must be an object.` };
    }

    const { id: fileId, path: filePath, template } = entry;

    if (
      typeof fileId !== "string" ||
      typeof filePath !== "string" ||
      typeof template !== "string"
    ) {
      return {
        problem: `${id}: files[${index}] needs string "id", "path" and "template".`,
      };
    }

    if (!fs.existsSync(path.join(dir, template))) {
      return { problem: `${id}: template "${template}" does not exist.` };
    }

    if (entry.when !== undefined && typeof entry.when !== "string") {
      return { problem: `${id}: files[${index}] has a non-string "when".` };
    }

    files.push({
      id: fileId,
      path: filePath,
      template,
      primary: entry.primary === true,
      when: entry.when,
    });
  }

  if (files.filter((file) => file.primary).length > 1) {
    return { problem: `${id}: only one file may be marked "primary".` };
  }

  // Without an explicit primary the first file is opened, which is the common
  // case for single-file recipes.
  if (!files.some((file) => file.primary)) {
    files[0].primary = true;
  }

  const options: RecipeOption[] = [];

  if (raw.options !== undefined) {
    if (!Array.isArray(raw.options)) {
      return { problem: `${id}: "options" must be an array.` };
    }

    for (const [index, entry] of raw.options.entries()) {
      if (!isRecord(entry) || typeof entry.name !== "string") {
        return { problem: `${id}: options[${index}] needs a string "name".` };
      }

      options.push({
        name: entry.name,
        label: asString(entry.label, entry.name),
        detail: typeof entry.detail === "string" ? entry.detail : undefined,
      });
    }
  }

  const prompts: RecipePrompt[] = [];

  if (raw.prompts !== undefined) {
    if (!Array.isArray(raw.prompts)) {
      return { problem: `${id}: "prompts" must be an array.` };
    }

    for (const [index, entry] of raw.prompts.entries()) {
      if (!isRecord(entry) || typeof entry.name !== "string") {
        return { problem: `${id}: prompts[${index}] needs a string "name".` };
      }

      const source = parseSource(entry);

      if (!source) {
        return {
          problem: `${id}: prompts[${index}] needs one of "dirs", "exports" or "values".`,
        };
      }

      prompts.push({
        name: entry.name,
        label: asString(entry.label, entry.name),
        source,
        alwaysAsk: entry.alwaysAsk === true,
      });
    }
  }

  if (raw.target !== undefined && typeof raw.target !== "string") {
    return { problem: `${id}: "target" must be a string.` };
  }

  const noun = asString(raw.noun, id);

  return {
    recipe: {
      id,
      dir,
      label: asString(raw.label, noun),
      detail: asString(raw.detail, ""),
      noun,
      placeholder: asString(raw.placeholder, "myThing"),
      example: asString(raw.example, "myThing"),
      order: typeof raw.order === "number" ? raw.order : 100,
      folder: asString(raw.folder, "."),
      options,
      prompts,
      target: typeof raw.target === "string" ? raw.target : undefined,
      hints: asStrings(raw.hints) ?? [],
      // Where a recipe belongs and what folder name identifies it are the same
      // thing in practice, so `hints` doubles as the anchor unless overridden.
      anchor: asStrings(raw.anchor) ?? asStrings(raw.hints) ?? [],
      files,
    },
  };
};

/**
 * Recipes are discovered, never registered: a directory containing a
 * `recipe.json` is a generator. Later roots win on id, so a project can shadow
 * a built-in recipe with its own.
 */
export const loadRecipes = (roots: string[]): RecipeLoad => {
  const byId = new Map<string, Recipe>();
  const problems: string[] = [];

  for (const root of roots) {
    let entries: fs.Dirent[];

    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const dir = path.join(root, entry.name);
      const manifest = path.join(dir, "recipe.json");

      if (!fs.existsSync(manifest)) {
        continue;
      }

      let raw: unknown;

      try {
        raw = JSON.parse(fs.readFileSync(manifest, "utf-8"));
      } catch (error) {
        problems.push(
          `${entry.name}: recipe.json is not valid JSON (${
            error instanceof Error ? error.message : String(error)
          }).`
        );
        continue;
      }

      const { recipe, problem } = parseRecipe(entry.name, dir, raw);

      if (problem) {
        problems.push(problem);
        continue;
      }

      byId.set(entry.name, recipe as Recipe);
    }
  }

  const recipes = [...byId.values()].sort(
    (a, b) => a.order - b.order || a.noun.localeCompare(b.noun)
  );

  return { recipes, problems };
};

/**
 * Where the recipe writes. A recipe with a `target` ignores the clicked folder
 * and generates at a fixed place in the package — that is what lets you pick a
 * module from a list instead of navigating the explorer to find it.
 */
export const resolveBaseFolder = (
  recipe: Recipe,
  vars: Record<string, string>,
  clickedFolder: string,
  packageRoot: string | undefined
) => {
  if (!recipe.target || !packageRoot) {
    return clickedFolder;
  }

  const rendered = renderInline(recipe.target, {
    vars,
    imports: {},
    flags: {},
  });

  return rendered ? path.join(packageRoot, rendered) : clickedFolder;
};

export const buildPlan = (
  recipe: Recipe,
  vars: Record<string, string>,
  targetFolder: string,
  generatorContext: GeneratorContext,
  flags: Record<string, boolean>
): GenerationPlan => {
  // Paths are templated before imports exist, so they may only use variables
  // and case filters — never `<<import>>`, which would be circular.
  const pathContext: RenderContext = { vars, imports: {}, flags };

  const folderName = renderInline(recipe.folder, pathContext);
  const folder =
    folderName === "." || folderName === ""
      ? targetFolder
      : path.join(targetFolder, folderName);

  const resolved = recipe.files
    .filter((file) => !file.when || flags[file.when] === true)
    .map((file) => ({
      file,
      absolutePath: path.join(folder, renderInline(file.path, pathContext)),
    }));

  const imports: Record<string, string> = {
    apiClient: generatorContext.importApiClient,
    responseTypes: generatorContext.importResponseTypes,
  };

  // Every generated file sits next to its siblings, so imports between them are
  // always resolved from the folder the recipe just created.
  for (const { file, absolutePath } of resolved) {
    imports[file.id] = buildImportPath(
      absolutePath,
      generatorContext.alias,
      folder
    );
  }

  const context: RenderContext = { vars, imports, flags };
  // The primary may itself have been gated out; fall back to the first survivor.
  const primary = resolved.find(({ file }) => file.primary) ?? resolved[0];

  return {
    folder,
    primary: primary.absolutePath,
    files: resolved.map(({ file, absolutePath }) => ({
      absolutePath,
      templatePath: path.join(recipe.dir, file.template),
      context,
    })),
  };
};
