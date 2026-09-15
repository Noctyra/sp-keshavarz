import * as fs from "fs";
import * as path from "path";

export type AliasMapping = {
  /** The literal text before the `*` in a tsconfig `paths` key, e.g. `@/` or `#shared/`. */
  prefix: string;
  /** Absolute directory the `*` is resolved against. */
  baseDir: string;
};

export type PackageContext = {
  /** The tsconfig that actually owns the clicked folder. */
  configFile: string;
  mappings: AliasMapping[];
};

const isWin = process.platform === "win32";

const forCompare = (p: string) => (isWin ? p.toLowerCase() : p);

export const isInside = (parent: string, child: string) => {
  const rel = path.relative(forCompare(parent), forCompare(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

const isFile = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * tsconfigs are JSONC: they carry comments and trailing commas, so JSON.parse
 * alone chokes on them. Strips both in a single string-aware pass.
 */
export const parseJsonc = (text: string): any => {
  let out = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  let pendingComma = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        out += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (char === '"') {
      pendingComma = -1;
      inString = true;
      out += char;
      continue;
    }

    if (char === ",") {
      out += char;
      pendingComma = out.length - 1;
      continue;
    }

    if (/\s/.test(char)) {
      out += char;
      continue;
    }

    if ((char === "}" || char === "]") && pendingComma >= 0) {
      out = out.slice(0, pendingComma) + out.slice(pendingComma + 1);
    }
    pendingComma = -1;
    out += char;
  }

  return JSON.parse(out);
};

type RawConfig = {
  file: string;
  paths?: Record<string, string[]>;
  pathsBaseDir?: string;
  references: string[];
};

const resolveConfigPath = (spec: string, fromDir: string) => {
  const candidates =
    spec.startsWith(".") || path.isAbsolute(spec)
      ? [
          path.resolve(fromDir, spec),
          `${path.resolve(fromDir, spec)}.json`,
          path.join(path.resolve(fromDir, spec), "tsconfig.json"),
        ]
      : [
          path.join(fromDir, "node_modules", spec),
          `${path.join(fromDir, "node_modules", spec)}.json`,
          path.join(fromDir, "node_modules", spec, "tsconfig.json"),
        ];

  return candidates.find(isFile);
};

const readConfig = (
  file: string,
  visited = new Set<string>()
): RawConfig | undefined => {
  const abs = path.resolve(file);
  if (visited.has(forCompare(abs))) {
    return undefined;
  }
  visited.add(forCompare(abs));

  let json: any;
  try {
    json = parseJsonc(fs.readFileSync(abs, "utf-8"));
  } catch {
    return undefined;
  }

  const dir = path.dirname(abs);
  const merged: RawConfig = { file: abs, references: [] };

  const extendsList = !json.extends
    ? []
    : Array.isArray(json.extends)
      ? json.extends
      : [json.extends];

  for (const spec of extendsList) {
    const parentFile = resolveConfigPath(String(spec), dir);
    const parent = parentFile && readConfig(parentFile, visited);
    if (parent) {
      merged.paths = parent.paths ?? merged.paths;
      merged.pathsBaseDir = parent.pathsBaseDir ?? merged.pathsBaseDir;
    }
  }

  const compilerOptions = json.compilerOptions ?? {};

  if (compilerOptions.paths && typeof compilerOptions.paths === "object") {
    merged.paths = compilerOptions.paths;
    // Relative `paths` resolve against baseUrl when set, otherwise against the
    // directory of the tsconfig that declared them.
    merged.pathsBaseDir = compilerOptions.baseUrl
      ? path.resolve(dir, String(compilerOptions.baseUrl))
      : dir;
  }

  if (Array.isArray(json.references)) {
    merged.references = json.references
      .map((ref: any) =>
        ref && ref.path ? resolveConfigPath(String(ref.path), dir) : undefined
      )
      .filter((p: string | undefined): p is string => !!p);
  }

  return merged;
};

const toMappings = (config: RawConfig): AliasMapping[] => {
  if (!config.paths || !config.pathsBaseDir) {
    return [];
  }

  const mappings: AliasMapping[] = [];

  for (const [key, substitutions] of Object.entries(config.paths)) {
    const keyStar = key.indexOf("*");
    if (keyStar === -1 || !Array.isArray(substitutions)) {
      continue;
    }

    for (const substitution of substitutions) {
      const value = String(substitution);
      const valueStar = value.indexOf("*");
      if (valueStar === -1) {
        continue;
      }

      mappings.push({
        prefix: key.slice(0, keyStar),
        baseDir: path.resolve(config.pathsBaseDir, value.slice(0, valueStar)),
      });
    }
  }

  return mappings;
};

const tsconfigsIn = (dir: string) => {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  return entries
    .filter((entry) => /^tsconfig(\..+)?\.json$/i.test(entry))
    .sort((a, b) => {
      if (a.toLowerCase() === "tsconfig.json") {
        return -1;
      }
      if (b.toLowerCase() === "tsconfig.json") {
        return 1;
      }
      return a.localeCompare(b);
    })
    .map((entry) => path.join(dir, entry));
};

const contextFromDir = (dir: string, targetDir: string) => {
  for (const file of tsconfigsIn(dir)) {
    const config = readConfig(file);
    if (!config) {
      continue;
    }

    // `tsconfig.json` is often just a solution file (`files: []` + references),
    // with the real paths living in `tsconfig.app.json`.
    const candidates = [
      config,
      ...config.references
        .map((ref) => readConfig(ref))
        .filter((c): c is RawConfig => !!c),
    ];

    for (const candidate of candidates) {
      const mappings = toMappings(candidate);
      if (mappings.some((mapping) => isInside(mapping.baseDir, targetDir))) {
        return { configFile: candidate.file, mappings };
      }
    }
  }

  return undefined;
};

/**
 * Walks up from the clicked folder to the first tsconfig whose `paths` actually
 * cover it. In a monorepo that lands on the owning app/package, not the root.
 */
export const findPackageContext = (
  startDir: string,
  stopDir?: string
): PackageContext | undefined => {
  let dir = path.resolve(startDir);
  const stop = stopDir ? path.resolve(stopDir) : undefined;

  for (;;) {
    const context = contextFromDir(dir, startDir);
    if (context) {
      return context;
    }

    if (stop && forCompare(dir) === forCompare(stop)) {
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

/** The most specific mapping covering `absPath` — longest matching baseDir wins. */
export const bestMapping = (context: PackageContext, absPath: string) => {
  let best: AliasMapping | undefined;

  for (const mapping of context.mappings) {
    if (!isInside(mapping.baseDir, absPath)) {
      continue;
    }
    if (!best || mapping.baseDir.length > best.baseDir.length) {
      best = mapping;
    }
  }

  return best;
};

/**
 * Extensions are always stripped. `allowImportingTsExtensions` permits `.ts` in
 * a specifier but never requires it, so the extensionless form is the one that
 * compiles in every project — which is the point of a project-independent tool.
 */
export const toImportPath = (absFile: string, mapping: AliasMapping) => {
  const relative = path
    .relative(mapping.baseDir, absFile)
    .split(path.sep)
    .join("/");

  return `${mapping.prefix}${relative.replace(/\.tsx?$/, "")}`;
};

/** Builds the alias specifier for any file the context can reach. */
export const specifierFor = (context: PackageContext, absFile: string) => {
  const mapping = bestMapping(context, absFile);
  return mapping ? toImportPath(absFile, mapping) : undefined;
};

export const findPackageRoot = (startDir: string, stopDir?: string) => {
  let dir = path.resolve(startDir);
  const stop = stopDir ? path.resolve(stopDir) : undefined;

  for (;;) {
    if (isFile(path.join(dir, "package.json"))) {
      return dir;
    }
    if (stop && forCompare(dir) === forCompare(stop)) {
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
