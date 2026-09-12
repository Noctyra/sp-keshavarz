import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildImportPath, readAliasFromEnv, titleCase } from "./helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const [, , targetFolder, baseName] = process.argv;

const camelCaseRegex = /^([a-z]+[A-Za-z0-9]*)$/;
if (!camelCaseRegex.test(baseName)) {
  console.error("❌ Mutation name must be camelCase (e.g., updateUser)");
  process.exit(1);
}

const alias = readAliasFromEnv();
const TitleCaseName = titleCase(baseName);
const mutationFolderName = `${baseName}Mutation`;
const outputFolder = path.join(targetFolder, mutationFolderName);

const templates = [
  {
    file: "sampleMutation.types.txt",
    output: `${baseName}.types.ts`,
  },
  {
    file: "sampleMutation.function.txt",
    output: `${baseName}.function.ts`,
  },
  {
    file: "useSampleMutation.txt",
    output: `use${TitleCaseName}.ts`,
  },
];

fs.mkdirSync(outputFolder, { recursive: true });

templates.forEach(({ file, output }) => {
  const templatePath = path.join(__dirname, "templates", file);
  const outputPath = path.join(outputFolder, output);

  if (!fs.existsSync(templatePath)) {
    console.error(`❌ Missing template: ${file}`);
    process.exit(1);
  }

  let content = fs.readFileSync(templatePath, "utf-8");

  content = content
    .replaceAll("IMPORT_API_CLIENT", process.env.SPK_IMPORT_API_CLIENT ?? "")
    .replaceAll(
      "IMPORT_RESPONSE_TYPES",
      process.env.SPK_IMPORT_RESPONSE_TYPES ?? ""
    )
    .replaceAll("sampleMutation", baseName)
    .replaceAll("SampleMutation", TitleCaseName);

  if (file.includes("function")) {
    const typesPath = buildImportPath(
      path.join(outputFolder, `${baseName}.types.ts`),
      alias,
      outputFolder
    );
    content = content.replaceAll("IMPORT_TYPES", typesPath);
  }

  if (file.includes("useSampleMutation")) {
    const fnPath = buildImportPath(
      path.join(outputFolder, `${baseName}.function.ts`),
      alias,
      outputFolder
    );
    content = content.replaceAll("IMPORT_FUNCTION", fnPath);
  }

  fs.writeFileSync(outputPath, content, "utf-8");
});

console.log(`✅ Mutation "${baseName}" created in ${outputFolder}`);
