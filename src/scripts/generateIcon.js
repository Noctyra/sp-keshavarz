import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { titleCase } from "./helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const [, , targetFolder, iconBaseName] = process.argv;

if (!targetFolder || !iconBaseName) {
  console.error("Usage: node generateIcon.js <targetFolder> <iconName>");
  process.exit(1);
}

const camelCaseRegex = /^([a-z]+[A-Za-z0-9]*)$/;

if (!camelCaseRegex.test(iconBaseName)) {
  console.error("Icon name must be camelCase (e.g., arrowDown)");
  process.exit(1);
}

const iconComponentName = `${titleCase(iconBaseName)}Icon`;
const outputFileName = `${iconBaseName}Icon.tsx`;

const TEMPLATE_PATH = path.join(__dirname, "templates", "icon.txt");
const OUTPUT_PATH = path.join(targetFolder, outputFileName);

if (!fs.existsSync(TEMPLATE_PATH)) {
  console.error("Template not found:", TEMPLATE_PATH);
  process.exit(1);
}

let template = fs.readFileSync(TEMPLATE_PATH, "utf-8");
template = template.replaceAll("MyIcon", iconComponentName);

fs.writeFileSync(OUTPUT_PATH, template, "utf-8");
