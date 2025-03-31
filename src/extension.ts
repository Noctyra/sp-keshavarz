import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
  console.log("✅ Extension is active!");

  const disposable = vscode.commands.registerCommand(
    "sp-keshavarz.runScriptPicker",
    async (uri) => {
      const folderPath = uri.fsPath;

      const options = [
        "🔧 Generate Component",
        "Build Module",
        "Create Test Suite",
      ];

      const selection = await vscode.window.showQuickPick(options, {
        placeHolder: "Choose a script to run",
      });

      if (!selection) {
        vscode.window.showInformationMessage("Cancelled");
        return;
      }

      switch (selection) {
        case "🔧 Generate Component": {
          const componentName = await vscode.window.showInputBox({
            prompt: "Enter the component name (camelCase)",
            placeHolder: "myComponent",
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

          // Pass it to the script
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
                `✅ Component "${componentName}" created in ${folderPath}`
              );
            } else {
              vscode.window.showErrorMessage(
                "❌ Failed to generate component."
              );
            }
          });

          break;
        }

        case "Build Module":
          vscode.window.showInformationMessage(
            `🔧 Building module in ${folderPath}`
          );
          break;

        case "Create Test Suite":
          vscode.window.showInformationMessage(
            `🧪 Creating tests in ${folderPath}`
          );
          break;

        default:
          vscode.window.showWarningMessage("Unknown option selected.");
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
