import * as fs from "fs";
import * as path from "path";
import { isInside } from "./aliasResolver";

/**
 * Where a prompt's choices come from. The point is that the answers are read
 * out of the project itself, so the list is always whatever the codebase
 * actually contains rather than something kept in sync by hand.
 */
export type PromptSource =
  /** Subdirectory names of a package-root-relative folder, e.g. `src/modules`. */
  | { kind: "dirs"; base: string }
  /** Names exported from a package-root-relative file. */
  | { kind: "exports"; file: string }
  /** A fixed list written into the recipe. */
  | { kind: "values"; values: string[] };

export type RecipePrompt = {
  name: string;
  label: string;
  source: PromptSource;
  /** Asked even when the value could be inferred from the clicked folder. */
  alwaysAsk: boolean;
};

const EXPORTED = /export\s+(?:declare\s+)?(?:type|interface|enum|const|class|function)\s+([A-Za-z_$][\w$]*)/g;

const directoriesIn = (dir: string) => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
};

const exportsIn = (file: string) => {
  let text: string;

  try {
    text = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }

  const names = new Set<string>();

  for (const match of text.matchAll(EXPORTED)) {
    names.add(match[1]);
  }

  return [...names].sort((a, b) => a.localeCompare(b));
};

export const listChoices = (
  source: PromptSource,
  packageRoot: string | undefined
): string[] => {
  if (source.kind === "values") {
    return source.values;
  }

  if (!packageRoot) {
    return [];
  }

  return source.kind === "dirs"
    ? directoriesIn(path.join(packageRoot, source.base))
    : exportsIn(path.join(packageRoot, source.file));
};

/**
 * When the clicked folder already sits inside one of the choices there is
 * nothing to ask: right-clicking anywhere under `src/modules/finance` means the
 * module is `finance`. This is what turns a picker into no interaction at all.
 */
export const inferChoice = (
  source: PromptSource,
  packageRoot: string | undefined,
  targetFolder: string
): string | undefined => {
  if (source.kind !== "dirs" || !packageRoot) {
    return undefined;
  }

  const base = path.join(packageRoot, source.base);

  if (!isInside(base, targetFolder)) {
    return undefined;
  }

  const [first] = path
    .relative(base, targetFolder)
    .split(path.sep)
    .filter(Boolean);

  return first && directoriesIn(base).includes(first) ? first : undefined;
};

/**
 * Walks up from `start` looking for the folder this kind of thing belongs in.
 *
 * Invoked from the keyboard there is no clicked folder — only whichever file
 * happens to be open — and its own directory is almost never the right place: a
 * component does not belong inside the folder of the component you are reading.
 * At each level the folder itself is checked before its children, so the
 * nearest match wins and a nested `components` folder beats the module's one.
 */
export const findAnchor = (
  start: string,
  names: string[],
  stopAt?: string
): string | undefined => {
  if (!names.length) {
    return undefined;
  }

  const wanted = names.map((name) => name.toLowerCase());
  const stop = stopAt ? path.resolve(stopAt) : undefined;
  let dir = path.resolve(start);

  for (;;) {
    if (wanted.includes(path.basename(dir).toLowerCase())) {
      return dir;
    }

    for (const name of names) {
      const child = path.join(dir, name);

      try {
        if (fs.statSync(child).isDirectory()) {
          return child;
        }
      } catch {
        // Not this one.
      }
    }

    if (stop && dir === stop) {
      break;
    }

    const parent = path.dirname(dir);

    if (parent === dir) {
      break;
    }

    dir = parent;
  }

  return undefined;
};
