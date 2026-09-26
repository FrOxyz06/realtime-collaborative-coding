const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const vscode = require('vscode');

exports.run = async function () {
    let timer;
    try {
        await Promise.race([workflow(), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Editor test timed out')), 45000);
        })]);
    } finally { clearTimeout(timer); }
};

async function workflow() {
    const manifest = require('./package.json');
    const extension = vscode.extensions.all.find(item => item.packageJSON.name === manifest.name);
    assert.ok(extension, 'Extension not discovered');
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const originalFile = path.join(root, 'example.py');
    const original = await fs.readFile(originalFile, 'utf8');
    const candidate = await fs.readFile(path.join(root, 'candidate.py'), 'utf8');
    const dialogs = [];
    const errors = [];
    const saved = {};
    for (const name of ['showOpenDialog', 'showWarningMessage', 'showInformationMessage', 'showErrorMessage', 'showSaveDialog', 'showInputBox']) saved[name] = vscode.window[name];
    vscode.window.showOpenDialog = async () => [vscode.Uri.file(dialogs.shift())];
    vscode.window.showSaveDialog = async () => vscode.Uri.file(path.join(root, 'report.json'));
    vscode.window.showWarningMessage = async (message, options, ...items) => items[0];
    vscode.window.showInformationMessage = async (message, options, ...items) => typeof options === 'string' ? options : items[0];
    vscode.window.showErrorMessage = message => { errors.push(message); return Promise.resolve(undefined); };
    try {
        await extension.activate();
        assert.equal(extension.isActive, true);
        const commands = await vscode.commands.getCommands(true);
        for (const command of manifest.contributes.commands) assert.ok(commands.includes(command.command));
        const doc = await vscode.workspace.openTextDocument(originalFile);
        await vscode.window.showTextDocument(doc);
        const configKey = manifest.name === 'realtime-collaborative-coding' ? 'collab' : 'performanceAnalyzer';
        await vscode.workspace.getConfiguration(configKey).update('pythonPath', process.env.TEST_PYTHON, vscode.ConfigurationTarget.Global);
        if (configKey === 'collab') {
            const { hash } = require('./proposal.cjs');
            const proposalFile = path.join(root, 'change.collab-proposal.json');
            await fs.writeFile(proposalFile, JSON.stringify({ schemaVersion: 1, target: 'example.py', baseHash: hash(original), proposedText: candidate }));
            dialogs.push(proposalFile);
            await vscode.commands.executeCommand('collab.reviewProposal');
            dialogs.push(path.join(root, 'benchmark.json'));
            await vscode.commands.executeCommand('collab.benchmarkProposal');
            await vscode.commands.executeCommand('collab.acceptProposal');
            assert.equal(doc.getText(), candidate, 'Accepted proposal did not update the real editor');
            assert.equal(doc.isDirty, true);
            assert.equal(await fs.readFile(originalFile, 'utf8'), original);
            await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
            await vscode.commands.executeCommand('undo');
            await new Promise(resolve => setTimeout(resolve, 100));
            assert.equal(doc.getText(), original, 'Undo did not restore original');
            await doc.save();
            let invite;
            const previousClipboard = await vscode.env.clipboard.readText();
            const clipboard = vscode.env.clipboard.writeText;
            const quickPick = vscode.window.showQuickPick;
            vscode.env.clipboard.writeText = async value => { invite = value; };
            vscode.window.showQuickPick = async items => items[0];
            try {
                await vscode.commands.executeCommand('collab.hostSession');
                invite = await vscode.env.clipboard.readText();
                assert.ok(invite, 'Host did not produce an invite: ' + errors.join('; '));
                const { sessionRequest } = require('./session.cjs');
                const guest = await sessionRequest(invite);
                const { snapshotRequest } = require('./session.cjs');
                await vscode.commands.executeCommand('collab.startLiveSharing');
                const ownerEditor = await vscode.window.showTextDocument(doc);
                await ownerEditor.edit(edit => edit.insert(doc.positionAt(doc.getText().length), '\n# live edit\n'));
                await until(async () => (await snapshotRequest(invite)).source.includes('# live edit'));
                await vscode.commands.executeCommand('collab.pauseLiveSharing');
                assert.equal((await snapshotRequest(invite)).live, false);
                await vscode.commands.executeCommand('undo');
                await doc.save();
                assert.equal(doc.getText(), original);
                const submitted = await sessionRequest(invite, 'POST', { schemaVersion: 1, target: guest.target,
                    baseHash: guest.baseHash, proposedText: candidate });
                await vscode.commands.executeCommand('collab.reviewSessionProposal');
                dialogs.push(path.join(root, 'benchmark.json'));
                await vscode.commands.executeCommand('collab.benchmarkProposal');
                await vscode.commands.executeCommand('collab.acceptProposal');
                assert.equal(doc.getText(), candidate);
                assert.equal((await sessionRequest(invite)).proposals.find(p => p.id === submitted.id).status, 'applied');
                await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
            await vscode.commands.executeCommand('undo');
            await new Promise(resolve => setTimeout(resolve, 100));
                await vscode.commands.executeCommand('collab.endSession');
                await assert.rejects(sessionRequest(invite));
            } finally {
                vscode.env.clipboard.writeText = clipboard;
                await vscode.env.clipboard.writeText(previousClipboard);
                vscode.window.showQuickPick = quickPick;
                await vscode.commands.executeCommand('collab.endSession');
            }

            // A separate real HTTP host plays the friend while this VS Code
            // instance exercises the guest commands against actual documents.
            const { hostSession } = require('./session.cjs');
            const friend = await hostSession('example.py', original);
            try {
                friend.setLive(true);
                vscode.window.showInputBox = async () => friend.invite;
                await vscode.commands.executeCommand('collab.joinSession');
                const independent = vscode.window.activeTextEditor.document;
                assert.equal(independent.getText(), original);
                await vscode.commands.executeCommand('collab.watchSharedFile');
                const watched = vscode.window.activeTextEditor.document;
                assert.equal(watched.uri.scheme, 'collab-preview');
                friend.publish(candidate);
                await until(async () => watched.getText().includes(candidate));
                assert.equal(independent.getText(), original, 'Watch overwrote an independent copy');
                await vscode.commands.executeCommand('collab.copySharedFile');
                assert.equal(vscode.window.activeTextEditor.document.getText(), candidate);
                await vscode.window.showTextDocument(independent);
                dialogs.push(path.join(root, 'benchmark.json'));
                await vscode.commands.executeCommand('collab.compareWithFriend');
                await vscode.commands.executeCommand('collab.exportComparison');
                const comparison = JSON.parse(await fs.readFile(path.join(root, 'report.json')));
                assert.equal(comparison.result.passed, true);
                assert.equal(comparison.yourHash, hash(original));
                assert.equal(comparison.friendHash, hash(candidate));
                assert.equal(comparison.revision, 2);
                assert.equal(JSON.stringify(comparison).includes(friend.invite), false);
                await vscode.commands.executeCommand('collab.endSession');
                await until(async () => watched.getText().includes('WATCH STOPPED'));
                assert.equal(independent.getText(), original);
            } finally {
                friend.close();
                await vscode.commands.executeCommand('collab.endSession');
            }

        } else {
            dialogs.push(path.join(root, 'candidate.py'), path.join(root, 'benchmark.json'));
            await vscode.commands.executeCommand('performanceAnalyzer.analyzeFile');
            await vscode.commands.executeCommand('performanceAnalyzer.exportReport');
            const result = JSON.parse(await fs.readFile(path.join(root, 'report.json')));
            assert.equal(result.passed, true);
            assert.equal(result.cases.length, 3);
            dialogs.push(path.join(root, 'benchmark.json'));
            await vscode.window.showTextDocument(doc);
            await vscode.commands.executeCommand('performanceAnalyzer.profileFile');
            await vscode.commands.executeCommand('performanceAnalyzer.exportReport');
            const profile = JSON.parse(await fs.readFile(path.join(root, 'report.json')));
            assert.equal(profile.mode, 'profile');
            assert.ok(profile.cases[0].hotspots.length);
        }
        assert.deepEqual(errors, []);
        console.log('EDITOR WORKFLOW PASSED: ' + manifest.name);
    } finally {
        for (const [name, method] of Object.entries(saved)) vscode.window[name] = method;
    }
}

async function until(predicate) {
    const deadline = Date.now() + 5000;
    while (!(await predicate())) {
        if (Date.now() >= deadline) throw new Error('Timed out waiting for live update');
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}
