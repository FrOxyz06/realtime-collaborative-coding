const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

test('starter demo runs real Python, applies only to its sample buffer, and menu routes feedback without attaching data', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'collab-demo-test-'));
    const extensionPath = path.resolve(__dirname, '..');
    await fs.writeFile(path.join(root, 'keep.py'), '# my existing work\n');
    const commands = new Map(), documents = new Map(), errors = [], output = [], opened = [];
    let menuChoice = 'collab.tryDemo';
    const uri = p => ({ fsPath: p, scheme: 'file', toString: () => p });
    const openDocument = async value => {
        const file = value.fsPath;
        if (!documents.has(file)) {
            let text = await fs.readFile(file, 'utf8');
            documents.set(file, { uri: value, languageId: 'python', isDirty: false, getText: () => text,
                positionAt: n => n, replace: replacement => { text = replacement; documents.get(file).isDirty = true; } });
        }
        return documents.get(file);
    };
    const vscode = {
        StatusBarAlignment: { Left: 1 }, Range: class {},
        EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
        Uri: { file: uri, parse: value => ({ toString: () => value }), joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
        env: { openExternal: async value => { opened.push(value.toString()); return true; } },
        workspace: { isTrusted: true, workspaceFolders: [{ uri: uri(root) }],
            onDidChangeTextDocument: () => ({ dispose() {} }),
            onDidCloseTextDocument: () => ({ dispose() {} }),
            registerTextDocumentContentProvider: () => ({ dispose() {} }),
            getConfiguration: () => ({ get: () => 'python' }), openTextDocument: openDocument },
        window: { createStatusBarItem: () => ({ show() {}, dispose() {} }),
            createOutputChannel: () => ({ clear() { output.length = 0; }, appendLine(value) { output.push(value); }, show() {}, dispose() {} }),
            showErrorMessage: value => { errors.push(value); },
            showInformationMessage: async (message, options, ...items) => typeof options === 'string' ? options : items[0],
            showWarningMessage: async (message, options, ...items) => items[0],
            showQuickPick: async items => items.find(item => item.command === menuChoice),
            showOpenDialog: async () => { throw new Error('Demo must select its bundled cases'); },
            showTextDocument: async doc => ({ document: doc, edit: async callback => {
                callback({ replace: (range, text) => doc.replace(text) }); return true;
            } }) },
        commands: { registerCommand: (id, action) => { commands.set(id, action); return { dispose() {} }; },
            executeCommand: async (id, ...args) => id === 'vscode.diff' ? undefined : commands.get(id)(...args) }
    };
    const originalLoad = Module._load;
    Module._load = function (name, ...args) { return name === 'vscode' ? vscode : originalLoad.call(this, name, ...args); };
    const subscriptions = [];
    try {
        require('../out/extension.js').activate({ subscriptions, extensionPath, extensionUri: uri(extensionPath) });
        const run = name => commands.get('collab.' + name)();
        await run('openMenu');
        assert.deepEqual(errors, [], 'Starter demo failed before opening the review');
        const sample = (await fs.readdir(root)).find(name => name.startsWith('collab-demo-'));
        assert.ok(sample);
        await run('tryDemo');
        assert.match(errors.pop(), /current proposal/);
        await run('benchmarkProposal');
        assert.match(output.join('\n'), /All supplied cases matched/);
        await run('acceptProposal');
        const target = await fs.realpath(path.join(root, sample, 'deduplicate.py'));
        const candidate = await fs.readFile(path.join(root, sample, 'deduplicate-fast.py'), 'utf8');
        assert.equal(documents.get(target).getText(), candidate);
        assert.notEqual(await fs.readFile(target, 'utf8'), candidate);
        assert.equal(await fs.readFile(path.join(root, 'keep.py'), 'utf8'), '# my existing work\n');
        menuChoice = 'collab.sendFeedback';
        await run('openMenu');
        assert.equal(opened.length, 1);
        const feedback = new URL(opened[0]);
        assert.equal(feedback.origin + feedback.pathname, 'https://github.com/FrOxyz06/realtime-collaborative-coding/issues/new');
        assert.deepEqual([...feedback.searchParams.keys()], ['title', 'body']);
        assert.equal(opened[0].includes(encodeURIComponent(root)), false);
        assert.match(feedback.searchParams.get('body'), /What I tried/);
        vscode.workspace.isTrusted = false;
        await run('tryDemo');
        assert.match(errors.pop(), /trusted workspace/);
        assert.deepEqual(errors, []);
    } finally {
        Module._load = originalLoad;
        for (const subscription of subscriptions) subscription.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});
