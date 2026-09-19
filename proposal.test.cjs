const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { hash, validate, targetPath, checkBase, canAccept } = require('./proposal.cjs');
const original = 'def f(): return 1\n';
const proposal = () => ({ schemaVersion: 1, target: 'example.py', baseHash: hash(original), proposedText: 'def f(): return 2\n' });

test('proposal round-trips through JSON', () => {
    assert.deepEqual(validate(JSON.parse(JSON.stringify(proposal()))), proposal());
});
test('rejects traversal, absolute paths, git internals, and non-Python files', () => {
    for (const target of ['../evil.py', '/evil.py', 'C:/evil.py', 'a\\evil.py', '.git/hook.py', 'a//b.py', 'a/./b.py', 'file.txt']) {
        assert.throws(() => validate({ ...proposal(), target }));
    }
});
test('rejects oversized proposals', () => {
    assert.throws(() => validate({ ...proposal(), proposedText: 'x'.repeat(200001) }));
});
test('stale original cannot be accepted', () => {
    assert.throws(() => checkBase(proposal(), original + '# changed'));
    assert.throws(() => canAccept(proposal(), original + '# changed', { passed: true, cases: [{ passed: true }] }));
});
test('requires an actual passing benchmark with cases', () => {
    for (const result of [undefined, { passed: false }, { passed: true, cases: [] },
        { passed: true, cases: [{ passed: false }] }, { passed: true, error: 'bad', cases: [{ passed: true }] }]) {
        assert.throws(() => canAccept(proposal(), original, result));
    }
    canAccept(proposal(), original, { passed: true, cases: [{ passed: true }] });
});
test('resolves only existing workspace targets and blocks symlink escapes', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'collab-test-'));
    try {
        const root = path.join(folder, 'workspace');
        const outside = path.join(folder, 'outside');
        await fs.mkdir(root); await fs.mkdir(outside);
        await fs.writeFile(path.join(root, 'example.py'), original);
        await fs.writeFile(path.join(outside, 'example.py'), original);
        assert.equal(await targetPath(root, proposal()), await fs.realpath(path.join(root, 'example.py')));
        await assert.rejects(targetPath(root, { ...proposal(), target: 'missing.py' }));
        await fs.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
        await assert.rejects(targetPath(root, { ...proposal(), target: 'linked/example.py' }));
    } finally { await fs.rm(folder, { recursive: true, force: true }); }
});
