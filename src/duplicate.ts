import * as fs from "fs";
import * as path from "path";

/** Guards against a mis-click on a huge tree. */
const MAX_FILES = 500;

export type DuplicatePlan = {
  /** The identifier being replaced throughout, e.g. `getWallet`. */
  stem: string;
  source: string;
  destination: string;
  files: { absolutePath: string; contents: Buffer }[];
};

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

const words = (value: string) =>
  value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());

/**
 * The casings a name plausibly appears in across a folder: the identifier
 * itself, the type/component form, a route or storage key, and so on. Anything
 * rarer than these is left alone rather than risking a false positive — a bare
 * lowercase form like `getwallet` would match inside unrelated words.
 */
const casings = (value: string) => {
  const parts = words(value);

  return [
    parts.map((word, index) => (index ? capitalize(word) : word)).join(""),
    parts.map(capitalize).join(""),
    parts.join("_").toUpperCase(),
    parts.join("-"),
    parts.join("_"),
    // Verbatim, because splitting into words normalises acronyms: the derived
    // camel form of `getFileSMSStatus` is `getFileSmsStatus`, which matches
    // nothing in a codebase that actually writes `SMS`.
    value,
    capitalize(value),
  ];
};

/** Rewrites every casing of `from` to the matching casing of `to`. */
export const rename = (text: string, from: string, to: string) => {
  const sources = casings(from);
  const targets = casings(to);

  return sources.reduce(
    (carry, source, index) =>
      source ? carry.split(source).join(targets[index]) : carry,
    text
  );
};

const walk = (dir: string, found: string[] = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(absolute, found);
    } else if (entry.isFile()) {
      found.push(absolute);
    }

    if (found.length > MAX_FILES) {
      return found;
    }
  }

  return found;
};

/** A null byte in the first block is the usual heuristic for "not text". */
const isBinary = (contents: Buffer) =>
  contents.subarray(0, 8000).includes(0);

const commonPrefix = (values: string[]) => {
  if (!values.length) {
    return "";
  }

  let prefix = values[0];

  for (const value of values.slice(1)) {
    while (prefix && !value.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }

  return prefix;
};

/** How many of `names` contain `candidate` in any of its casings. */
const coverage = (candidate: string, names: string[]) => {
  const forms = casings(candidate).filter(Boolean);
  return names.filter((name) => forms.some((form) => name.includes(form)))
    .length;
};

/**
 * What to rename. The folder name is often not the answer: a `getWalletQuery`
 * folder holds `getWallet.*`, and an `activateUserMutation` folder holds
 * `activateUser.*` plus `useActivateUser.ts` — where a shared prefix does not
 * even exist, because one file is prefixed with `use`.
 *
 * So every plausible name is scored by how many of the folder's own file names
 * it actually occurs in, and the best-covering one wins. The folder name is
 * only the fallback, for folders whose files have nothing in common.
 */
export const detectStem = (folder: string, files: string[]) => {
  const folderName = path.basename(folder);

  const names = files
    .filter((file) => path.dirname(file) === folder)
    .map((file) => path.basename(file));

  const bases = names.map((name) => name.split(".")[0]).filter(Boolean);

  const candidates = [folderName, commonPrefix(bases), ...bases].filter(
    (candidate, index, all) =>
      candidate.length >= 3 && all.indexOf(candidate) === index
  );

  let best = folderName;
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = coverage(candidate, names);

    // Longer wins ties, so `activateUser` beats `activate` when both cover
    // every file.
    if (
      score > bestScore ||
      (score === bestScore && score > 0 && candidate.length > best.length)
    ) {
      best = candidate;
      bestScore = score;
    }
  }

  // A name has to account for most of the folder to be the folder's name. In a
  // grab-bag like `assets/icons`, one file's name covering two of forty files
  // is a coincidence, not the thing being renamed — there the folder name is
  // the honest answer, and only the folder gets renamed.
  return bestScore * 2 >= names.length && bestScore > 0 ? best : folderName;
};

/** The stem and size of a folder, for the prompt shown before duplicating. */
export const inspect = (source: string) => {
  const files = walk(source);
  return { stem: detectStem(source, files), count: files.length };
};

export const planDuplicate = (
  source: string,
  newName: string
): DuplicatePlan => {
  const files = walk(source);

  if (files.length > MAX_FILES) {
    throw new Error(
      `"${path.basename(source)}" holds more than ${MAX_FILES} files — too big to duplicate.`
    );
  }

  if (!files.length) {
    throw new Error(`"${path.basename(source)}" has no files to duplicate.`);
  }

  const stem = detectStem(source, files);
  const parent = path.dirname(source);
  const folderName = path.basename(source);
  const renamedFolder = rename(folderName, stem, newName);

  // When the stem does not occur in the folder's own name there is nothing to
  // substitute, so the name the user typed becomes the folder name outright.
  const destination = path.join(
    parent,
    renamedFolder === folderName ? newName : renamedFolder
  );

  if (fs.existsSync(destination)) {
    throw new Error(`"${path.basename(destination)}" already exists.`);
  }

  return {
    stem,
    source,
    destination,
    files: files.map((file) => {
      const relative = rename(path.relative(source, file), stem, newName);
      const contents = fs.readFileSync(file);

      return {
        absolutePath: path.join(destination, relative),
        contents: isBinary(contents)
          ? contents
          : Buffer.from(rename(contents.toString("utf-8"), stem, newName), "utf-8"),
      };
    }),
  };
};
