import * as fs from "fs";
import * as path from "path";
import {
  bestMapping,
  findPackageContext,
  findPackageRoot,
  specifierFor,
} from "./aliasResolver";

/** The tsconfig `paths` entry that generated imports should be written against. */
export type Alias = {
  prefix: string;
  baseDir: string;
};

export type GeneratorContext = {
  /** Absent when no tsconfig `paths` entry covers the folder — imports go relative. */
  alias?: Alias;
  /** Where this package keeps its axios instance, as an import specifier. */
  importApiClient: string;
  /** Where this package keeps `GlobalData`, as an import specifier. */
  importResponseTypes: string;
  /** Non-fatal problems worth surfacing in the UI. */
  warnings: string[];
  /** The tsconfig the alias was read from, for the output channel. */
  configFile?: string;
};

/**
 * The api client and response types live at different alias paths in every
 * project (and in a different package entirely for the Next app), so the
 * templates carry placeholders and we look the real files up per package.
 */
const API_CLIENT_FILES = ["settings/axiosConfig.ts", "settings/axiosConfig.tsx"];

const RESPONSE_TYPES_FILES = [
  "types/responses/responsesTypes.ts",
  "types/responses.types.ts",
];

const isFile = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

const dedupe = (values: (string | undefined)[]) => {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }

  return out;
};

const stripExtension = (specifier: string) => specifier.replace(/\.tsx?$/, "");

/**
 * Absolute import for `absFile` when the alias covers it, otherwise a relative
 * one from `fromDir` so generation still produces valid code.
 */
export const buildImportPath = (
  absFile: string,
  alias: Alias | undefined,
  fromDir: string
) => {
  if (alias) {
    const relative = path
      .relative(alias.baseDir, absFile)
      .split(path.sep)
      .join("/");

    if (!relative.startsWith("..")) {
      return `${alias.prefix}${stripExtension(relative)}`;
    }
  }

  const relative = stripExtension(
    path.relative(fromDir, absFile).split(path.sep).join("/")
  );

  return relative.startsWith(".") ? relative : `./${relative}`;
};

export const buildGeneratorContext = (
  targetFolder: string,
  workspaceRoot?: string
): GeneratorContext => {
  const warnings: string[] = [];
  const context = findPackageContext(targetFolder, workspaceRoot);
  const mapping = context && bestMapping(context, targetFolder);

  if (!context) {
    warnings.push(
      "No tsconfig with matching `paths` was found above this folder — imports were generated as relative paths."
    );
  } else if (!mapping) {
    warnings.push(
      `\`${context.configFile}\` has no \`paths\` entry covering this folder — imports were generated as relative paths.`
    );
  }

  const alias: Alias | undefined = mapping
    ? { prefix: mapping.prefix, baseDir: mapping.baseDir }
    : undefined;

  const packageRoot = findPackageRoot(targetFolder, workspaceRoot);

  // Nearest first: the alias root, then the package's own src, then whatever
  // other aliases (e.g. `#shared/*`) this package can reach.
  const searchDirs = dedupe([
    mapping?.baseDir,
    packageRoot ? path.join(packageRoot, "src") : undefined,
    packageRoot,
    ...(context?.mappings ?? []).map((m) => m.baseDir),
  ]);

  const locate = (relativeCandidates: string[], label: string) => {
    for (const dir of searchDirs) {
      for (const candidate of relativeCandidates) {
        const absolute = path.join(dir, candidate);
        if (!isFile(absolute)) {
          continue;
        }
        // Prefer any alias that reaches the file, not just the folder's own.
        const specifier =
          (context && specifierFor(context, absolute)) ??
          buildImportPath(absolute, alias, targetFolder);
        if (specifier) {
          return specifier;
        }
      }
    }

    const guess = alias
      ? `${alias.prefix}${stripExtension(relativeCandidates[0])}`
      : `./${stripExtension(relativeCandidates[0])}`;
    warnings.push(`Could not find ${label} in this package — used \`${guess}\`.`);
    return guess;
  };

  return {
    alias,
    configFile: context?.configFile,
    warnings,
    importApiClient: locate(API_CLIENT_FILES, "the api client"),
    importResponseTypes: locate(RESPONSE_TYPES_FILES, "the response types"),
  };
};
