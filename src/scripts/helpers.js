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

export const getImportPath = (componentPath, componentName, SRC_DIR) => {
  const typesFile = path.join(componentPath, `${componentName}.types.ts`);
  const relativeToSrc = path.relative(SRC_DIR, typesFile);
  return relativeToSrc.startsWith("..")
    ? `./${componentName}.types`
    : `@/${relativeToSrc.replace(/\\/g, "/")}`;
};
