import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
const { hash, validate, targetPath, checkBase, canAccept } = require('../proposal.cjs');
const { runBenchmark, report } = require('../benchmark.cjs');
const { hostSession, sessionRequest } = require('../session.cjs');

type Proposal = { schemaVersion: number; target: string; baseHash: string; proposedText: string };
type Review = { proposal: Proposal; root: string; target: string; result?: any; remoteId?: string };

export function activate(context: vscode.ExtensionContext) {
    let pending: Review | undefined;
    let running = false;
    let busy = false;
    let sequence = 0;
    let host: any;
    let hostRoot: string;
    let joined: { invite: string; session: any } | undefined;
    context.subscriptions.push({ dispose: () => host?.close() });
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
        if (review.remoteId && (!host || host.get(review.remoteId).status !== 'pending')) {
            throw new Error('Session proposal expired or is no longer pending');
        }
        if (await targetPath(review.root, review.proposal) !== review.target) throw new Error('Target path changed');
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(review.target));
        if (doc.isDirty) throw new Error('Save or discard current edits before reviewing this proposal');
        checkBase(review.proposal, doc.getText());
        // Also check disk so an external edit cannot slip past a cached document.
        checkBase(review.proposal, await fs.readFile(review.target, 'utf8'));
        return doc;
    }

    async function showReview(review: Review) {
        await current(review);
        pending = review;
        const preview = vscode.Uri.parse(`collab-preview:/${++sequence}/${path.basename(review.target)}`);
        previews.set(preview.toString(), review.proposal.proposedText);
        await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(review.target), preview,
            'Original vs Proposed (read-only)');
        vscode.window.showInformationMessage('Review the diff, then run Collab: Benchmark Proposal.');
    }

    register('hostSession', async () => {
        if (!vscode.workspace.isTrusted) throw new Error('Sharing requires a trusted workspace');
        const root = workspace();
        const doc = vscode.window.activeTextEditor?.document;
        if (!doc || doc.uri.scheme !== 'file' || doc.isDirty) throw new Error('Open the saved Python file to share');
        const target = path.relative(root, doc.uri.fsPath).split(path.sep).join('/');
        const source = doc.getText();
        await targetPath(root, { schemaVersion: 1, target, baseHash: hash(source), proposedText: source });
        const answer = await vscode.window.showWarningMessage(
            `Share ${target} for 15 minutes? Anyone with the invite can read this file and propose changes, but cannot apply them.`,
            { modal: true }, 'Share this file');
        if (answer !== 'Share this file') return;
        host?.close();
        host = await hostSession(target, source, { onProposal: () => {
            vscode.window.showInformationMessage('New proposal received. Run Collab: Review Session Proposal.');
        } });
        hostRoot = root;
        const copy = await vscode.window.showInformationMessage('Session started on loopback. Use an SSH tunnel for another computer.', 'Copy invite');
        if (copy === 'Copy invite') await vscode.env.clipboard.writeText(host.invite);
    });

    register('joinSession', async () => {
        const invite = await vscode.window.showInputBox({ title: 'Paste session invite', password: true,
            prompt: 'For another computer, create an SSH tunnel first. Invitations contain a secret token.' });
        if (!invite) return;
        const session = await sessionRequest(invite);
        joined = { invite, session };
        const document = await vscode.workspace.openTextDocument({ content: session.source, language: 'python' });
        await vscode.window.showTextDocument(document);
        vscode.window.showInformationMessage('Edit this copy, then run Collab: Send Session Proposal. The owner reviews all changes.');
    });

    register('sendSessionProposal', async () => {
        if (!joined) throw new Error('Join a session first');
        const doc = vscode.window.activeTextEditor?.document;
        if (!doc) throw new Error('Open the edited Python copy first');
        const answer = await vscode.window.showInformationMessage(
            `Send the active editor contents as a proposal for ${joined.session.target}?`, { modal: true }, 'Send proposal');
        if (answer !== 'Send proposal') return;
        const result = await sessionRequest(joined.invite, 'POST', { schemaVersion: 1, target: joined.session.target,
            baseHash: joined.session.baseHash, proposedText: doc.getText() });
        vscode.window.showInformationMessage(`Proposal ${result.id.slice(0, 8)} sent. Run Collab: Session Status to check the outcome.`);
    });

    register('reviewSessionProposal', async () => {
        if (!host) throw new Error('Host a session first');
        const choices = host.list().filter((p: any) => p.status === 'pending').map((p: any) => ({ label: p.id.slice(0, 8), id: p.id }));
        if (!choices.length) throw new Error('No pending session proposals');
        const selected = await vscode.window.showQuickPick<{ label: string; id: string }>(choices, { title: 'Choose a proposal' });
        if (!selected) return;
        const proposal = host.get(selected.id);
        await showReview({ root: hostRoot, proposal, target: await targetPath(hostRoot, proposal), remoteId: selected.id });
    });

    register('sessionStatus', async () => {
        const session = joined ? await sessionRequest(joined.invite) : host ? { proposals: host.list(), expiresAt: host.expiresAt } : undefined;
        if (!session) throw new Error('No session is active');
        output.clear();
        output.appendLine('Expires: ' + new Date(session.expiresAt).toLocaleTimeString());
        for (const p of session.proposals) output.appendLine(`${p.id.slice(0, 8)}: ${p.status}`);
        output.appendLine('Applied means changed in the owner editor; the owner still chooses when to save.');
        output.show();
    });

    register('endSession', async () => {
        host?.close(); host = undefined; joined = undefined;
        if (pending?.remoteId) pending = undefined;
        vscode.window.showInformationMessage('Session ended locally. Hosted invitations are revoked.');
    });

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
        await showReview(review);
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
            const result = await runBenchmark(python, { ...config, mode: 'compare', before: doc.getText(), after: review.proposal.proposedText },
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
        if (review.remoteId) host.resolve(review.remoteId, 'applied');
        pending = undefined;
        vscode.window.showInformationMessage('Proposal applied to the editor. Review and save; Undo is available.');
    });

    register('rejectProposal', async () => {
        if (pending?.remoteId && host) host.resolve(pending.remoteId, 'rejected');
        pending = undefined;
        vscode.window.showInformationMessage('Proposal dismissed. No source file was changed.');
    });
}
