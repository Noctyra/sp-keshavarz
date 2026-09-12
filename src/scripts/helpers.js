import path from "path";

export const replaceNameInContent = (content, original, replacement) =>
  content.replaceAll(original, replacement);

export const titleCase = (str) => str.charAt(0).toUpperCase() + str.slice(1);

export const injectPropsImport = (content, componentName, importPath) => {
  const propsName = `${titleCase(componentName)}Props`;
  const importLine = `import { ${propsName} } from "${importPath}";\n`;
  return content.includes(importLine) ? content : importLine + content;
};

export const injectHookImport = (content, componentName, importPath) => {
  const hookName = `use${titleCase(componentName)}`;
  const importLine = `import ${hookName} from "${importPath}";\n`;
  return content.includes(importLine) ? content : importLine + content;
};

/**
 * The alias is resolved by the extension from the owning package's tsconfig and
 * handed over in the environment, because it differs per project:
 * `@/*` -> `./src/*` (vite apps), `@/*` -> `./*` (next app), `#shared/*` -> `src/*`.
 */
export const readAliasFromEnv = () => {
  const prefix = process.env.SPK_ALIAS_PREFIX;
  const baseDir = process.env.SPK_ALIAS_BASE_DIR;

  if (!prefix || !baseDir) {
    return null;
  }

  return {
    prefix,
    baseDir,
    allowTsExtensions: process.env.SPK_ALLOW_TS_EXT === "1",
  };
};

/**
 * Absolute import for `absFile` when the alias is known, otherwise a relative
 * one from `fromDir` so generation still produces valid code.
 */
export const buildImportPath = (absFile, alias, fromDir) => {
  if (alias) {
    const relative = path
      .relative(alias.baseDir, absFile)
      .split(path.sep)
      .join("/");

    if (!relative.startsWith("..")) {
      const specifier = alias.allowTsExtensions
        ? relative
        : relative.replace(/\.tsx?$/, "");
      return `${alias.prefix}${specifier}`;
    }
  }

  const relative = path
    .relative(fromDir ?? path.dirname(absFile), absFile)
    .split(path.sep)
    .join("/")
    .replace(/\.tsx?$/, "");

  return relative.startsWith(".") ? relative : `./${relative}`;
};
