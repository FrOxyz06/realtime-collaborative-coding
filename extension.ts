import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
const { hash, validate, targetPath, checkBase, canAccept } = require('../proposal.cjs');
const { runBenchmark, report } = require('../benchmark.cjs');

type Proposal = { schemaVersion: number; target: string; baseHash: string; proposedText: string };
type Review = { proposal: Proposal; root: string; target: string; result?: any };

export function activate(context: vscode.ExtensionContext) {
    let pending: Review | undefined;
    let running = false;
    let busy = false;
    let sequence = 0;
    const previews = new Map<string, string>();
    const output = vscode.window.createOutputChannel('Collab Benchmark');
    context.subscriptions.push(output, vscode.workspace.registerTextDocumentContentProvider('collab-preview', {
        provideTextDocumentContent: uri => previews.get(uri.toString()) || ''
    }));

    function register(name: string, action: () => Promise<void>) {
        context.subscriptions.push(vscode.commands.registerCommand('collab.' + name, async () => {
            if (busy) { vscode.window.showErrorMessage('Finish the current Collab action first'); return; }
            busy = true;
            try { await action(); } catch (error) {
                vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
            } finally { busy = false; }
        }));
    }

    function workspace() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length !== 1 || folders[0].uri.scheme !== 'file') {
            throw new Error('Open one local workspace folder first');
        }
        return folders[0].uri.fsPath;
    }

    async function pick(title: string, extension: string) {
        const selected = await vscode.window.showOpenDialog({ title, canSelectMany: false,
            filters: { Files: [extension] } });
        return selected?.[0];
    }

    async function current(review: Review) {
        if (await targetPath(review.root, review.proposal) !== review.target) throw new Error('Target path changed');
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(review.target));
        if (doc.isDirty) throw new Error('Save or discard current edits before reviewing this proposal');
        checkBase(review.proposal, doc.getText());
        // Also check disk so an external edit cannot slip past a cached document.
        checkBase(review.proposal, await fs.readFile(review.target, 'utf8'));
        return doc;
    }

    register('createProposal', async () => {
        const root = workspace();
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== 'file' || editor.document.isDirty) {
            throw new Error('Open the saved original Python file first');
        }
        const target = path.relative(root, editor.document.uri.fsPath).split(path.sep).join('/');
        const candidate = await pick('Choose the proposed Python file', 'py');
        if (!candidate) return;
        const proposal = validate({ schemaVersion: 1, target, baseHash: hash(editor.document.getText()),
            proposedText: await fs.readFile(candidate.fsPath, 'utf8') });
        await targetPath(root, proposal);
        const destination = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(root, 'change.collab-proposal.json')), filters: { Proposal: ['json'] }
        });
        if (!destination) return;
        if (!destination.fsPath.endsWith('.collab-proposal.json')) throw new Error('Use a .collab-proposal.json filename');
        await fs.writeFile(destination.fsPath, JSON.stringify(proposal, null, 2) + '\n');
        vscode.window.showInformationMessage('Proposal saved. Share it with the file owner.');
    });

    register('reviewProposal', async () => {
        const root = workspace();
        const source = await pick('Open a proposal to review', 'json');
        if (!source) return;
        const stat = await fs.stat(source.fsPath);
        if (stat.size > 1000000) throw new Error('Proposal file is too large');
        const proposal: Proposal = validate(JSON.parse(await fs.readFile(source.fsPath, 'utf8')));
        const review: Review = { proposal, root, target: await targetPath(root, proposal) };
        await current(review);
        pending = review;
        const preview = vscode.Uri.parse(`collab-preview:/${++sequence}/${path.basename(review.target)}`);
        previews.set(preview.toString(), proposal.proposedText);
        await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(review.target), preview,
            'Original â†” Proposed (read-only)');
        vscode.window.showInformationMessage('Review the diff, then run Collab: Benchmark Proposal.');
    });

    register('benchmarkProposal', async () => {
        if (!pending) throw new Error('Open a proposal first');
        if (running) throw new Error('A benchmark is already running');
        if (!vscode.workspace.isTrusted) throw new Error('Benchmarking requires a trusted workspace');
        const review = pending;
        review.result = undefined;
        const configFile = await pick('Choose benchmark.json', 'json');
        if (!configFile) return;
        const config = JSON.parse(await fs.readFile(configFile.fsPath, 'utf8'));
        const doc = await current(review);
        const answer = await vscode.window.showWarningMessage(
            'Run the original and proposed Python code? Both run with your local permissions, not in a sandbox.',
            { modal: true }, 'Run trusted code');
        if (answer !== 'Run trusted code') return;
        await current(review);
        running = true;
        try {
            const python = vscode.workspace.getConfiguration('collab').get<string>('pythonPath', 'python');
            const result = await runBenchmark(python, { ...config, before: doc.getText(), after: review.proposal.proposedText },
                path.dirname(review.target));
            await current(review);
            if (pending !== review) throw new Error('Review changed while benchmarking; run again');
            review.result = result;
            output.clear(); output.appendLine(report(result)); output.show();
        } finally { running = false; }
    });

    register('acceptProposal', async () => {
        if (!pending) throw new Error('Open a proposal first');
        if (running) throw new Error('Wait for the benchmark to finish');
        if (!vscode.workspace.isTrusted) throw new Error('Accepting requires a trusted workspace');
        const review = pending;
        const doc = await current(review);
        canAccept(review.proposal, doc.getText(), review.result);
        const answer = await vscode.window.showInformationMessage(
            'Apply the reviewed proposal? Passing cases do not prove correctness for every input.',
            { modal: true }, 'Apply proposal');
        if (answer !== 'Apply proposal') return;
        if (pending !== review) throw new Error('Review changed; inspect it again');
        await current(review);
        const editor = await vscode.window.showTextDocument(doc);
        await current(review);
        canAccept(review.proposal, doc.getText(), review.result);
        const applied = await editor.edit(edit => edit.replace(
            new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), review.proposal.proposedText));
        if (!applied) throw new Error('File changed before the edit could be applied');
        pending = undefined;
        vscode.window.showInformationMessage('Proposal applied to the editor. Review and save; Undo is available.');
    });

    register('rejectProposal', async () => {
        pending = undefined;
        vscode.window.showInformationMessage('Proposal dismissed. No source file was changed.');
    });
}
