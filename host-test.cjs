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
    for (const name of ['showOpenDialog', 'showWarningMessage', 'showInformationMessage', 'showErrorMessage', 'showSaveDialog']) saved[name] = vscode.window[name];
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
