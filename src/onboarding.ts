import * as vscode from 'vscode';
import { execFile } from 'node:child_process';

export type Action = { label: string; description: string; command: string };
export function registerOnboarding(context: vscode.ExtensionContext, actions: () => Action[]) {
    context.subscriptions.push(vscode.commands.registerCommand('collab.openMenu', async () => {
        const selection = await vscode.window.showQuickPick(actions(), {
            title: 'Collab Review', placeHolder: 'Try the demo, collaborate, or send feedback',
            matchOnDescription: true
        });
        if (selection) await vscode.commands.executeCommand(selection.command);
    }));
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    status.text = '$(git-pull-request) Collab Review';
    status.tooltip = 'Open Collab Review actions';
    status.command = 'collab.openMenu';
    status.show();
    context.subscriptions.push(status);
    context.subscriptions.push(vscode.commands.registerCommand('collab.sendFeedback', async () => {
        // No source, paths, invite tokens, or machine data are attached.
        await vscode.env.openExternal(vscode.Uri.parse(
            'https://github.com/FrOxyz06/realtime-collaborative-coding/issues/new?template=beta-feedback.yml'));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('collab.openGuide', async () => {
        await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.joinPath(context.extensionUri, 'docs', 'TRY_IT.md'));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('collab.checkSetup', async () => {
        if (!vscode.workspace.isTrusted) {
            vscode.window.showErrorMessage('Trust a workspace before checking the configured Python executable.');
            return;
        }
        const python = vscode.workspace.getConfiguration('collab').get<string>('pythonPath', 'python');
        const result = await new Promise<string>(resolve => {
            execFile(python, ['-I', '-c', 'import sys; print("Python " + sys.version.split()[0]); sys.exit(0 if sys.version_info >= (3,10) else 1)'],
                { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error
                    ? 'Python 3.10+ could not be started. Set Collab: Python Path to your Python executable (not a command with arguments).'
                    : stdout.trim() + ' is ready.'));
        });
        const choice = await vscode.window.showInformationMessage(result, 'Open Python setting');
        if (choice) await vscode.commands.executeCommand('workbench.action.openSettings', 'collab.pythonPath');
    }));
}
