import * as fs from "fs";
import * as path from "path";
import {
  bestMapping,
  findPackageContext,
  findPackageRoot,
  specifierFor,
} from "./aliasResolver";

export type GeneratorContext = {
  env: Record<string, string>;
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

export const buildGeneratorContext = (
  targetFolder: string,
  workspaceRoot?: string
): GeneratorContext => {
  const warnings: string[] = [];
  const context = findPackageContext(targetFolder, workspaceRoot);

  if (!context) {
    warnings.push(
      "No tsconfig with matching `paths` was found above this folder — imports were generated as relative paths."
    );
    return { env: {}, warnings };
  }

  const mapping = bestMapping(context, targetFolder);

  if (!mapping) {
    warnings.push(
      `\`${context.configFile}\` has no \`paths\` entry covering this folder — imports were generated as relative paths.`
    );
    return { env: {}, warnings, configFile: context.configFile };
  }

  const packageRoot = findPackageRoot(targetFolder, workspaceRoot);

  // Nearest first: the alias root, then the package's own src, then whatever
  // other aliases (e.g. `#shared/*`) this package can reach.
  const searchDirs = dedupe([
    mapping.baseDir,
    packageRoot ? path.join(packageRoot, "src") : undefined,
    packageRoot,
    ...context.mappings.map((m) => m.baseDir),
  ]);

  const locate = (relativeCandidates: string[], label: string) => {
    for (const dir of searchDirs) {
      for (const candidate of relativeCandidates) {
        const absolute = path.join(dir, candidate);
        if (!isFile(absolute)) {
          continue;
        }
        const specifier = specifierFor(context, absolute);
        if (specifier) {
          return specifier;
        }
      }
    }

    const guess = `${mapping.prefix}${relativeCandidates[0].replace(
      /\.tsx?$/,
      ""
    )}`;
    warnings.push(`Could not find ${label} in this package — used \`${guess}\`.`);
    return guess;
  };

  return {
    configFile: context.configFile,
    warnings,
    env: {
      SPK_ALIAS_PREFIX: mapping.prefix,
      SPK_ALIAS_BASE_DIR: mapping.baseDir,
      SPK_ALLOW_TS_EXT: context.allowTsExtensions ? "1" : "0",
      SPK_IMPORT_API_CLIENT: locate(API_CLIENT_FILES, "the api client"),
      SPK_IMPORT_RESPONSE_TYPES: locate(
        RESPONSE_TYPES_FILES,
        "the response types"
      ),
    },
  };
};
