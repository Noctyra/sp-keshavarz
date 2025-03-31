import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEMPLATE_DIR = path.join(__dirname, "templates");
const SRC_DIR = process.argv[4];

const replaceNameInContent = (content, original, replacement) =>
  content.replaceAll(original, replacement);

const titleCase = (str) => str.charAt(0).toUpperCase() + str.slice(1);

const injectPropsImport = (content, componentName, importPath) => {
  const propsName = `${titleCase(componentName)}Props`;
  const importLine = `import { ${propsName} } from "${importPath}";\n`;
  return content.includes(importLine) ? content : importLine + content;
};

const injectHookImport = (content, componentName, importPath) => {
  const hookName = `use${titleCase(componentName)}`;
  const importLine = `import ${hookName} from "${importPath}";\n`;
  return content.includes(importLine) ? content : importLine + content;
};

const getImportPath = (componentPath, componentName) => {
  const typesFile = path.join(componentPath, `${componentName}.types.ts`);
  const relativeToSrc = path.relative(SRC_DIR, typesFile);
  return relativeToSrc.startsWith("..")
    ? `./${componentName}.types`
    : `@/${relativeToSrc.replace(/\\/g, "/")}`;
};

const createComponent = async () => {
  const inputPath = path.resolve(process.argv[2] || ".");
  const componentName = process.argv[3];

  if (!componentName || !/^[a-z][A-Za-z0-9]*$/.test(componentName)) {
    console.error("❌ Invalid component name. Use camelCase (e.g. myButton)");
    process.exit(1);
  }

  const componentPath = path.join(inputPath, componentName);
  const importPath = getImportPath(componentPath, componentName);

  await fs.mkdir(componentPath, { recursive: true });

  const templateFiles = [
    {
      template: "component.txt",
      output: `${componentName}.tsx`,
      type: "component",
    },
    {
      template: "component.types.txt",
      output: `${componentName}.types.ts`,
      type: "type",
    },
    {
      template: "component.biz.txt",
      output: `${componentName}.biz.ts`,
      type: "hook",
    },
  ];

  for (const file of templateFiles) {
    const templatePath = path.join(TEMPLATE_DIR, file.template);
    const outputPath = path.join(componentPath, file.output);

    let content = await fs.readFile(templatePath, "utf-8");

    const componentTitle = titleCase(componentName);
    const propsName = `${componentTitle}Props`;

    if (file.type === "type") {
      content = replaceNameInContent(content, "MyComponentProps", propsName);
    } else if (file.type === "component") {
      content = replaceNameInContent(content, "myComponent", componentTitle);
      content = replaceNameInContent(content, "myComponentProps", propsName);
      content = injectPropsImport(content, componentName, importPath);
      content = replaceNameInContent(
        content,
        "useMyComponent",
        `use${componentTitle}`
      );
      const hookImportPath = importPath.replace(".types", ".biz");
      content = injectHookImport(content, componentName, hookImportPath);
    } else if (file.type === "hook") {
      content = replaceNameInContent(
        content,
        "useMyComponent",
        `use${componentTitle}`
      );
      content = replaceNameInContent(content, "MyComponentProps", propsName);
      content = injectPropsImport(content, componentName, importPath);
    }

    await fs.writeFile(outputPath, content, "utf-8");
  }
};

createComponent();
