import * as vscode from "vscode";
import { Manager } from "pont-engine";

export function wait(ttl = 500) {
  return new Promise(resolve => {
    setTimeout(resolve, ttl);
  });
}

export function showProgress(
  title: string,
  manager: Manager,
  task: (report?: (info: string) => any) => Thenable<any>
) {
  return vscode.window.withProgress(
    {
      title,
      location: vscode.ProgressLocation.Notification
    },
    async p => {
      try {
        manager.setReport(info => {
          p.report({
            message: info
          });
        });

        await task(info => p.report({ message: info }));
      } catch (e) {
        vscode.window.showErrorMessage(e.toString());
      }
    }
  );
}
