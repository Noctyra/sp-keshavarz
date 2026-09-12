import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import { buildGeneratorContext } from "./generatorContext";

const camelCaseRegex = /^([a-z]+[A-Za-z0-9]*)$/;

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("My Workflow");

  const runScript = (scriptName: string, folderPath: string, args: string[]) => {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(folderPath)
    );
    const generatorContext = buildGeneratorContext(
      folderPath,
      workspaceFolder?.uri.fsPath
    );

    const scriptPath = path.join(context.extensionPath, "src/scripts", scriptName);

    output.appendLine(`$ ${scriptName} ${args.join(" ")}`);
    output.appendLine(`  folder: ${folderPath}`);
    output.appendLine(`  tsconfig: ${generatorContext.configFile ?? "none"}`);
    output.appendLine(
      `  alias: ${
        generatorContext.env.SPK_ALIAS_PREFIX
          ? `${generatorContext.env.SPK_ALIAS_PREFIX}* -> ${generatorContext.env.SPK_ALIAS_BASE_DIR}`
          : "none (relative imports)"
      }`
    );

    for (const warning of generatorContext.warnings) {
      output.appendLine(`  ⚠️ ${warning}`);
      vscode.window.showWarningMessage(warning);
    }

    return new Promise<number | null>((resolve) => {
      const child = cp.spawn("node", [scriptPath, folderPath, ...args], {
        env: { ...process.env, ...generatorContext.env },
      });

      child.stdout?.on("data", (data) => output.append(String(data)));
      child.stderr?.on("data", (data) => output.append(String(data)));
      child.on("error", (error) => {
        output.appendLine(`  ❌ ${error.message}`);
        resolve(null);
      });
      child.on("exit", (code) => resolve(code));
    });
  };

  const askForName = (
    prompt: string,
    placeHolder: string,
    label: string,
    example: string
  ) =>
    vscode.window.showInputBox({
      prompt,
      placeHolder,
      validateInput: (val) => {
        if (!val) {
          return `${label} name is required.`;
        }
        if (!camelCaseRegex.test(val)) {
          return `${label} name must be camelCase (e.g., ${example})`;
        }
        return null;
      },
    });

  const disposable = vscode.commands.registerCommand(
    "sp-keshavarz.runScriptPicker",
    async (uri) => {
      const folderPath = uri.fsPath;

      const options = [
        "⚙️ Generate Component",
        "✨ Generate Icon",
        "📡 Generate Sample Query",
        "📤 Generate Sample Mutation",
      ];

      const selection = await vscode.window.showQuickPick(options, {
        placeHolder: "Choose a script to run",
      });

      if (!selection) {
        vscode.window.showInformationMessage("Cancelled");
        return;
      }

      switch (selection) {
        case "⚙️ Generate Component": {
          const componentName = await askForName(
            "Enter the component name (camelCase)",
            "myComponent",
            "Component",
            "myComponent, userCard"
          );

          if (!componentName) {
            vscode.window.showErrorMessage("Component name is required.");
            return;
          }

          const code = await runScript("generateComponent.js", folderPath, [
            componentName,
          ]);

          if (code === 0) {
            vscode.window.showInformationMessage(
              `Component "${componentName}" created in ${folderPath}`
            );
          } else if (code === 1) {
            vscode.window.showErrorMessage("Name must be camel case");
          } else {
            vscode.window.showErrorMessage("Failed to generate component.");
          }

          break;
        }
        case "✨ Generate Icon": {
          const iconName = await askForName(
            "Enter the icon name (camelCase)",
            "arrowDown",
            "Icon",
            "arrowDown, playNext"
          );

          if (!iconName) {
            vscode.window.showErrorMessage("Icon name is required.");
            return;
          }

          const code = await runScript("generateIcon.js", folderPath, [
            iconName,
          ]);

          if (code === 0) {
            vscode.window.showInformationMessage(
              `Icon "${iconName}" created in ${folderPath}`
            );
          } else if (code === 1) {
            vscode.window.showErrorMessage("Icon name must be camelCase.");
          } else {
            vscode.window.showErrorMessage("Failed to generate icon.");
          }

          break;
        }
        case "📡 Generate Sample Query": {
          const queryName = await askForName(
            "Enter the query name (camelCase)",
            "getUserProfile",
            "Query",
            "getUserProfile"
          );

          if (!queryName) {
            vscode.window.showErrorMessage("Query name is required.");
            return;
          }

          const code = await runScript("generateSampleQuery.js", folderPath, [
            queryName,
          ]);

          if (code === 0) {
            vscode.window.showInformationMessage(
              `Sample query "${queryName}" created in ${folderPath}`
            );
          } else if (code === 1) {
            vscode.window.showErrorMessage("Query name must be camelCase.");
          } else {
            vscode.window.showErrorMessage("Failed to generate sample query.");
          }

          break;
        }
        case "📤 Generate Sample Mutation": {
          const mutationName = await askForName(
            "Enter the mutation name (camelCase)",
            "updateUser",
            "Mutation",
            "updateUser"
          );

          if (!mutationName) {
            vscode.window.showErrorMessage("Mutation name is required.");
            return;
          }

          const code = await runScript("generateSampleMutation.js", folderPath, [
            mutationName,
          ]);

          if (code === 0) {
            vscode.window.showInformationMessage(
              `Mutation "${mutationName}" created in ${folderPath}`
            );
          } else {
            vscode.window.showErrorMessage("Failed to generate mutation.");
          }

          break;
        }

        default:
          vscode.window.showWarningMessage("Unknown option selected.");
      }
    }
  );

  context.subscriptions.push(disposable, output);
}

export function deactivate() {}
