// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.log("Extension is active!");

  const disposable = vscode.commands.registerCommand(
    "sp-keshavarz.testMyScript",
    async (uri: vscode.Uri) => {
      const clickedPath = uri?.fsPath;

      if (!clickedPath) {
        vscode.window.showErrorMessage("No folder selected.");
        return;
      }

      const input = await vscode.window.showInputBox({
        prompt: "Enter a name to use with the folder",
        placeHolder: "MyAwesomeComponent",
	  });
		
      if (input !== undefined) {
        vscode.window.showInformationMessage(
          `Folder path: ${clickedPath}\nYour input: ${input}`
        );

        // You could now call your Node script or generate files here
      } else {
        vscode.window.showInformationMessage("Input was canceled.");
      }
    }
  );

  context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
