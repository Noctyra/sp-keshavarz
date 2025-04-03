import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";

const camelCaseRegex = /^([a-z]+[A-Za-z0-9]*)$/;

export function activate(context: vscode.ExtensionContext) {
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
          const componentName = await vscode.window.showInputBox({
            prompt: "Enter the component name (camelCase)",
            placeHolder: "myComponent",
            validateInput: (val) => {
              if (!val) {
                return "Component name is required.";
              }
              if (!camelCaseRegex.test(val)) {
                return "Component name must be camelCase (e.g., myComponent, userCard)";
              }
              return null;
            },
          });

          if (!componentName) {
            vscode.window.showErrorMessage("Component name is required.");
            return;
          }

          const extensionRoot = context.extensionPath;

          const scriptPath = path.join(
            extensionRoot,
            "src/scripts",
            "generateComponent.js"
          );

          const workspaceFolder =
            vscode.workspace.workspaceFolders?.[0].uri.fsPath;
          const srcDir = path.join(workspaceFolder ?? "", "src");

          const child = cp.spawn(
            "node",
            [scriptPath, folderPath, componentName, srcDir],
            {
              stdio: "inherit",
            }
          );

          child.on("exit", (code) => {
            if (code === 0) {
              vscode.window.showInformationMessage(
                `Component "${componentName}" created in ${folderPath}`
              );
            } else if (code === 1) {
              vscode.window.showErrorMessage("Name must be camel case");
            } else {
              vscode.window.showErrorMessage("Failed to generate component.");
            }
          });

          break;
        }
        case "✨ Generate Icon": {
          const iconName = await vscode.window.showInputBox({
            prompt: "Enter the icon name (camelCase)",
            placeHolder: "arrowDown",
            validateInput: (val) => {
              if (!val) {
                return "Icon name is required.";
              }
              if (!camelCaseRegex.test(val)) {
                return "Icon name must be camelCase (e.g., arrowDown, playNext)";
              }
              return null;
            },
          });

          if (!iconName) {
            vscode.window.showErrorMessage("Icon name is required.");
            return;
          }

          const extensionRoot = context.extensionPath;

          const scriptPath = path.join(
            extensionRoot,
            "src/scripts",
            "generateIcon.js"
          );

          const child = cp.spawn("node", [scriptPath, folderPath, iconName], {
            stdio: "inherit",
          });

          child.on("exit", (code) => {
            if (code === 0) {
              vscode.window.showInformationMessage(
                `Icon "${iconName}" created in ${folderPath}`
              );
            } else if (code === 1) {
              vscode.window.showErrorMessage("Icon name must be camelCase.");
            } else {
              vscode.window.showErrorMessage("Failed to generate icon.");
            }
          });

          break;
        }
        case "📡 Generate Sample Query": {
          const queryName = await vscode.window.showInputBox({
            prompt: "Enter the query name (camelCase)",
            placeHolder: "getUserProfile",
            validateInput: (val) => {
              if (!val) {
                return "Query name is required.";
              }
              if (!camelCaseRegex.test(val)) {
                return "Query name must be camelCase (e.g., getUserProfile)";
              }
              return null;
            },
          });

          if (!queryName) {
            vscode.window.showErrorMessage("Query name is required.");
            return;
          }

          const extensionRoot = context.extensionPath;

          const scriptPath = path.join(
            extensionRoot,
            "src/scripts",
            "generateSampleQuery.js"
          );

          const child = cp.spawn("node", [scriptPath, folderPath, queryName], {
            stdio: "inherit",
          });

          child.on("exit", (code) => {
            if (code === 0) {
              vscode.window.showInformationMessage(
                `Sample query "${queryName}" created in ${folderPath}`
              );
            } else if (code === 1) {
              vscode.window.showErrorMessage("Query name must be camelCase.");
            } else {
              vscode.window.showErrorMessage(
                "Failed to generate sample query."
              );
            }
          });

          break;
        }
        case "📤 Generate Sample Mutation": {
          const mutationName = await vscode.window.showInputBox({
            prompt: "Enter the mutation name (camelCase)",
            placeHolder: "updateUser",
            validateInput: (val) => {
              if (!val) {
                return "Mutation name is required.";
              }
              if (!/^([a-z]+[A-Za-z0-9]*)$/.test(val)) {
                return "Mutation name must be camelCase (e.g., updateUser)";
              }
              return null;
            },
          });

          if (!mutationName) {
            vscode.window.showErrorMessage("Mutation name is required.");
            return;
          }

          const extensionRoot = context.extensionPath;
          const scriptPath = path.join(
            extensionRoot,
            "src/scripts",
            "generateSampleMutation.js"
          );

          const child = cp.spawn(
            "node",
            [scriptPath, folderPath, mutationName],
            {
              stdio: "inherit",
            }
          );

          child.on("exit", (code) => {
            if (code === 0) {
              vscode.window.showInformationMessage(
                `Mutation "${mutationName}" created in ${folderPath}`
              );
            } else {
              vscode.window.showErrorMessage("Failed to generate mutation.");
            }
          });

          break;
        }

        default:
          vscode.window.showWarningMessage("Unknown option selected.");
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
