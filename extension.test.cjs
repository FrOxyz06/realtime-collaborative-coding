const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { hash } = require('./proposal.cjs');

test('review -> benchmark -> accept, and stale/dirty/rejected proposals stay unchanged', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'collab-flow-'));
    const filename = path.join(root, 'example.py');
    const original = 'def f(x): return x+1\n';
    const proposed = 'def f(x): return 1+x\n';
    const proposalFile = path.join(root, 'change.collab-proposal.json');
    const configFile = path.join(root, 'benchmark.json');
    await fs.writeFile(filename, original);
    await fs.writeFile(proposalFile, JSON.stringify({ schemaVersion: 1, target: 'example.py', baseHash: hash(original), proposedText: proposed }));
    await fs.writeFile(configFile, JSON.stringify({ schemaVersion: 1, function: 'f', cases: [{ args: [1] }] }));
    const commands = new Map();
    const errors = [];
    let choices = [], text = original, dirty = false, edits = 0, called = 0, provider;
    let result = { schemaVersion: 1, passed: true, cases: [{ passed: true, name: 'case', beforeMs: 1, afterMs: 1 }] };
    const uri = value => ({ fsPath: value, scheme: 'file', toString: () => value });
    const doc = { uri: uri(filename), fileName: filename, getText: () => text, get isDirty() { return dirty; }, positionAt: n => n };
    const editor = { document: doc, edit: async callback => { callback({ replace: (range, replacement) => { text = replacement; dirty = true; edits++; } }); return true; } };
    const vscode = {
        Uri: { file: uri, parse: value => ({ toString: () => value }) }, Range: class {},
        workspace: { isTrusted: true, workspaceFolders: [{ uri: uri(root) }],
            registerTextDocumentContentProvider: (scheme, value) => { provider = value; return { dispose() {} }; },
            openTextDocument: async () => doc, getConfiguration: () => ({ get: () => 'python' }) },
        window: { activeTextEditor: editor, createOutputChannel: () => ({ clear() {}, appendLine() {}, show() {}, dispose() {} }),
            showErrorMessage: value => errors.push(value), showInformationMessage: async (...args) => args.length > 1 ? 'Apply proposal' : undefined,
            showWarningMessage: async () => 'Run trusted code', showOpenDialog: async () => [uri(choices.shift())],
            showSaveDialog: async () => uri(path.join(root, 'export.collab-proposal.json')), showTextDocument: async () => editor },
        commands: { registerCommand: (id, action) => { commands.set(id, action); return { dispose() {} }; },
            executeCommand: async (id, left, right) => { assert.equal(id, 'vscode.diff'); assert.equal(provider.provideTextDocumentContent(right), proposed); } }
    };
    const load = Module._load;
    Module._load = function (name, ...args) {
        if (name === 'vscode') return vscode;
        if (name === '../benchmark.cjs') return { report: () => 'report', runBenchmark: async (python, request) => {
            called++; assert.equal(request.before, original); assert.equal(request.after, proposed); return result;
        } };
        return load.call(this, name, ...args);
    };
    try {
        require('./out/extension.js').activate({ subscriptions: [] });
        const run = name => commands.get('collab.' + name)();
        choices = [proposalFile]; await run('reviewProposal'); assert.equal(edits, 0);
        await run('acceptProposal'); assert.match(errors.pop(), /passing benchmark/);
        vscode.workspace.isTrusted = false;
        await run('benchmarkProposal'); assert.match(errors.pop(), /trusted/); assert.equal(called, 0);
        vscode.workspace.isTrusted = true;
        result = { passed: false, cases: [{ passed: false }] };
        choices = [configFile]; await run('benchmarkProposal'); await run('acceptProposal');
        assert.match(errors.pop(), /passing benchmark/); assert.equal(edits, 0);
        result = { passed: true, cases: [{ passed: true }] };
        choices = [configFile]; await run('benchmarkProposal');
        text = original + '# edited'; dirty = true;
        await run('acceptProposal'); assert.match(errors.pop(), /Save or discard/); assert.equal(edits, 0);
        text = original; dirty = false;
        await fs.writeFile(filename, original + '# external change');
        await run('acceptProposal'); assert.match(errors.pop(), /Original file changed/); assert.equal(edits, 0);
        await fs.writeFile(filename, original);
        await run('acceptProposal'); assert.equal(text, proposed); assert.equal(edits, 1);
        assert.equal(await fs.readFile(filename, 'utf8'), original); // saving remains the owner's decision
        text = original; dirty = false;
        choices = [proposalFile]; await run('reviewProposal'); await run('rejectProposal');
        await run('acceptProposal'); assert.match(errors.pop(), /Open a proposal/); assert.equal(edits, 1);
        const candidate = path.join(root, 'candidate.py'); await fs.writeFile(candidate, proposed);
        choices = [candidate]; await run('createProposal');
        const exported = JSON.parse(await fs.readFile(path.join(root, 'export.collab-proposal.json')));
        assert.equal(exported.baseHash, hash(original)); assert.equal(exported.proposedText, proposed);
        assert.deepEqual(errors, []);
    } finally {
        Module._load = load;
        await fs.rm(root, { recursive: true, force: true });
    }
});
