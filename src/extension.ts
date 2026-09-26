import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
const { hash, validate, targetPath, checkBase, canAccept } = require('../src/proposal.cjs');
const { runBenchmark, report } = require('../src/benchmark.cjs');
const { hostSession, sessionRequest, snapshotRequest } = require('../src/session.cjs');
const { watchSnapshots } = require('../src/watch.cjs');
const { verifyComparison, comparisonReport } = require('../src/comparison.cjs');

type Proposal = { schemaVersion: number; target: string; baseHash: string; proposedText: string };
type Review = { proposal: Proposal; root: string; target: string; result?: any; remoteId?: string };

export function activate(context: vscode.ExtensionContext) {
    let pending: Review | undefined;
    let running = false;
    let busy = false;
    let sequence = 0;
    let host: any;
    let hostRoot: string;
    let hostTarget: string;
    let liveSharing = false;
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    let stopWatching: (() => void) | undefined;
    let lastComparison: any;
    let joined: { invite: string; session: any } | undefined;
    context.subscriptions.push({ dispose: () => { clearTimeout(publishTimer); stopWatching?.(); host?.close(); } });
    const previews = new Map<string, string>();
    const previewChanged = new vscode.EventEmitter<vscode.Uri>();
    context.subscriptions.push(previewChanged);
    const output = vscode.window.createOutputChannel('Collab Benchmark');
    context.subscriptions.push(output, vscode.workspace.registerTextDocumentContentProvider('collab-preview', {
        onDidChange: previewChanged.event,
        provideTextDocumentContent: uri => previews.get(uri.toString()) || ''
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        if (!liveSharing || !host || event.document.uri.scheme !== 'file' || event.document.uri.fsPath !== hostTarget) return;
        clearTimeout(publishTimer);
        const session = host;
        const source = event.document.getText();
        publishTimer = setTimeout(() => {
            if (!liveSharing || host !== session) return;
            try { session.publish(source); }
            catch (error) {
                liveSharing = false;
                try { session.setLive(false); } catch { /* expired */ }
                vscode.window.showErrorMessage('Live sharing stopped: ' + String(error));
            }
        }, 250);
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
        clearTimeout(publishTimer); liveSharing = false;
        host = await hostSession(target, source, { onProposal: () => {
            vscode.window.showInformationMessage('New proposal received. Run Collab: Review Session Proposal.');
        } });
        hostRoot = root;
        hostTarget = doc.uri.fsPath;
        const copy = await vscode.window.showInformationMessage('Session started on loopback. Use an SSH tunnel for another computer.', 'Copy invite');
        if (copy === 'Copy invite') await vscode.env.clipboard.writeText(host.invite);
    });

    register('startLiveSharing', async () => {
        if (!host) throw new Error('Host a session first');
        if (!vscode.workspace.isTrusted) throw new Error('Live sharing requires a trusted workspace');
        const session = host;
        const answer = await vscode.window.showWarningMessage(
            'Share ongoing edits, including unsaved changes, to the one hosted file? Guests can watch and copy it until you pause or end the session.',
            { modal: true }, 'Share live edits');
        if (answer !== 'Share live edits') return;
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(hostTarget));
        session.setLive(true);
        try { session.publish(doc.getText()); } catch (error) { session.setLive(false); throw error; }
        liveSharing = true;
        vscode.window.showInformationMessage('Live sharing is ON for ' + session.snapshot().target + '. Use Collab: Pause Live Sharing to stop updates.');
    });

    register('pauseLiveSharing', async () => {
        clearTimeout(publishTimer); liveSharing = false;
        host?.setLive(false);
        vscode.window.showInformationMessage('Live sharing paused. The last shared snapshot remains readable until the session ends.');
    });

    async function sharedSnapshot(connection: { invite: string; session: any }) {
        const snapshot = await snapshotRequest(connection.invite);
        if (snapshot.target !== connection.session.target) throw new Error('Shared file changed unexpectedly; rejoin the session');
        return snapshot;
    }

    async function copyShared(connection: { invite: string; session: any }) {
        const snapshot = await sharedSnapshot(connection);
        if (joined !== connection) return;
        const document = await vscode.workspace.openTextDocument({ content: snapshot.source, language: 'python' });
        await vscode.window.showTextDocument(document);
        vscode.window.showInformationMessage(`Independent copy of ${snapshot.target}, revision ${snapshot.revision}. Live updates never overwrite this copy.`);
    }

    register('joinSession', async () => {
        const invite = await vscode.window.showInputBox({ title: 'Paste session invite', password: true,
            prompt: 'For another computer, create an SSH tunnel first. Invitations contain a secret token.' });
        if (!invite) return;
        const session = await sessionRequest(invite);
        stopWatching?.(); stopWatching = undefined;
        joined = { invite, session };
        await copyShared(joined);
        vscode.window.showInformationMessage('Use Collab: Watch Shared File to follow your friend, or edit your copy and Compare My Solution with Friend.');
    });

    register('copySharedFile', async () => {
        if (!joined) throw new Error('Join a session first');
        await copyShared(joined);
    });

    register('watchSharedFile', async () => {
        if (!joined) throw new Error('Join a session first');
        stopWatching?.();
        const connection = joined;
        const snapshot = await sharedSnapshot(connection);
        const uri = vscode.Uri.parse(`collab-preview:/${++sequence}/friend-${path.basename(snapshot.target)}`);
        const content = (s: any) => `# Friend revision ${s.revision} — ${s.live ? 'LIVE' : 'PAUSED'} — read-only\n` + s.source;
        previews.set(uri.toString(), content(snapshot));
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.languages.setTextDocumentLanguage(doc, 'python');
        await vscode.window.showTextDocument(doc, { preview: false });
        const stopPoll = watchSnapshots(connection.invite, (next: any) => {
            if (joined !== connection) return;
            if (next.target !== snapshot.target) throw new Error('Shared file changed unexpectedly');
            const text = content(next);
            if (previews.get(uri.toString()) !== text) {
                previews.set(uri.toString(), text); previewChanged.fire(uri);
            }
        }, (error: Error) => {
            if (joined !== connection) return;
            previews.set(uri.toString(), '# WATCH STOPPED — last received snapshot below\n' + previews.get(uri.toString()));
            previewChanged.fire(uri);
            vscode.window.showErrorMessage('Shared-file watch stopped: ' + error.message + '. Rejoin or run Watch Shared File again.');
        });
        stopWatching = () => {
            stopPoll();
            const text = previews.get(uri.toString()) || '';
            if (!text.startsWith('# WATCH STOPPED')) {
                previews.set(uri.toString(), '# WATCH STOPPED — last received snapshot below\n' + text);
                previewChanged.fire(uri);
            }
        };
    });

    register('compareWithFriend', async () => {
        if (!joined) throw new Error('Join a session first');
        if (!vscode.workspace.isTrusted) throw new Error('Benchmarking requires a trusted workspace');
        const connection = joined;
        lastComparison = undefined;
        const doc = vscode.window.activeTextEditor?.document;
        if (!doc || !['file', 'untitled'].includes(doc.uri.scheme) || doc.languageId !== 'python') {
            throw new Error('Focus your own editable Python solution first');
        }
        const yours = doc.getText();
        const friend = await sharedSnapshot(connection);
        validate({ schemaVersion: 1, target: friend.target, baseHash: hash(yours), proposedText: yours });
        const mineUri = vscode.Uri.parse(`collab-preview:/${++sequence}/your-snapshot.py`);
        const friendUri = vscode.Uri.parse(`collab-preview:/${++sequence}/friend-snapshot.py`);
        previews.set(mineUri.toString(), yours); previews.set(friendUri.toString(), friend.source);
        await vscode.commands.executeCommand('vscode.diff', mineUri, friendUri, `Your solution vs Friend r${friend.revision} (snapshots)`);
        const configFile = await pick('Choose shared benchmark cases for both solutions', 'json');
        if (!configFile) return;
        if ((await fs.stat(configFile.fsPath)).size > 1000000) throw new Error('Benchmark configuration is too large');
        const config = JSON.parse(await fs.readFile(configFile.fsPath, 'utf8'));
        const answer = await vscode.window.showWarningMessage(
            'Run both reviewed snapshots on your computer with the same tests? Your friend’s code runs with your permissions, not in a sandbox.',
            { modal: true }, 'Run trusted code');
        if (answer !== 'Run trusted code') return;
        const cwd = doc.uri.scheme === 'file' ? path.dirname(doc.uri.fsPath) : workspace();
        running = true;
        try {
            const python = vscode.workspace.getConfiguration('collab').get<string>('pythonPath', 'python');
            const result = await runBenchmark(python, { ...config, mode: 'compare', before: yours, after: friend.source }, cwd);
            verifyComparison(result, yours, friend.source);
            let changed = doc.getText() !== yours;
            try { changed ||= (await sharedSnapshot(connection)).hash !== friend.hash; } catch { changed = true; }
            lastComparison = { schemaVersion: 1, target: friend.target, revision: friend.revision,
                yourHash: hash(yours), friendHash: friend.hash, sharedAt: friend.updatedAt,
                changedDuringRun: changed, result };
            output.clear(); output.appendLine(comparisonReport(lastComparison)); output.show();
        } finally { running = false; }
    });

    register('exportComparison', async () => {
        if (!lastComparison) throw new Error('Compare your solution with your friend first');
        const destination = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(workspace(), 'collab-comparison.json')), filters: { JSON: ['json'] }
        });
        if (!destination) return;
        if (!destination.fsPath.endsWith('.json')) throw new Error('Use a .json filename');
        await fs.writeFile(destination.fsPath, JSON.stringify(lastComparison, null, 2) + '\n');
        vscode.window.showInformationMessage('Comparison saved with exact source hashes. No invitation token or source text is included.');
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
        clearTimeout(publishTimer); liveSharing = false; stopWatching?.(); stopWatching = undefined;
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
