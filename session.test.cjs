const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hostSession, sessionRequest, parseInvite } = require('./session.cjs');
const { hash } = require('./proposal.cjs');
const source = 'def f(x): return x + 1';
const proposal = () => ({ schemaVersion: 1, target: 'example.py', baseHash: hash(source), proposedText: 'def f(x): return 1 + x' });

test('two clients exchange scoped proposals and observe owner outcomes', async () => {
    let notifications = 0;
    const host = await hostSession('example.py', source, { onProposal: () => notifications++ });
    try {
        const alice = await sessionRequest(host.invite);
        assert.equal(alice.source, source);
        const first = await sessionRequest(host.invite, 'POST', proposal());
        const second = await sessionRequest(host.invite, 'POST', proposal());
        assert.equal(notifications, 2);
        assert.equal(host.get(first.id).proposedText, proposal().proposedText);
        host.resolve(first.id, 'applied');
        const bob = await sessionRequest(host.invite);
        assert.equal(bob.proposals.find(p => p.id === first.id).status, 'applied');
        assert.equal(bob.proposals.find(p => p.id === second.id).status, 'stale');
        assert.equal(bob.source, source); // transport never mutates the owner's file
        await assert.rejects(sessionRequest(host.invite, 'POST', proposal()), /already applied/);
    } finally { host.close(); }
});
test('token is required and browser-origin requests are rejected', async () => {
    const host = await hostSession('example.py', source);
    try {
        const { base, token } = parseInvite(host.invite);
        assert.equal((await fetch(base + '/session')).status, 401);
        assert.equal((await fetch(base + '/session', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
        assert.equal((await fetch(base + '/session', { headers: { Authorization: 'Bearer ' + token, Origin: 'https://example.com' } })).status, 403);
        assert.equal((await fetch(base + '/write', { method: 'POST', headers: { Authorization: 'Bearer ' + token } })).status, 404);
    } finally { host.close(); }
});
test('scope and version conflicts are rejected', async () => {
    const host = await hostSession('example.py', source);
    try {
        await assert.rejects(sessionRequest(host.invite, 'POST', { ...proposal(), target: 'other.py' }), /not shared/);
        await assert.rejects(sessionRequest(host.invite, 'POST', { ...proposal(), baseHash: hash('stale') }), /does not match/);
        await assert.rejects(sessionRequest(host.invite, 'POST', { ...proposal(), target: '../escape.py' }), /relative/);
        assert.equal(host.list().length, 0);
    } finally { host.close(); }
});
test('rejecting one proposal leaves other proposals reviewable', async () => {
    const host = await hostSession('example.py', source);
    try {
        const first = await sessionRequest(host.invite, 'POST', proposal());
        const second = await sessionRequest(host.invite, 'POST', proposal());
        host.resolve(first.id, 'rejected');
        assert.equal(host.get(second.id).status, 'pending');
        assert.throws(() => host.resolve(first.id, 'applied'), /no longer pending/);
    } finally { host.close(); }
});
test('revoked and expired sessions stop accepting connections', async () => {
    const host = await hostSession('example.py', source);
    host.close();
    await assert.rejects(sessionRequest(host.invite));
    assert.throws(() => host.list(), /ended/);
    const expired = await hostSession('example.py', source, { ttlMs: -1 });
    try { await assert.rejects(sessionRequest(expired.invite)); } finally { expired.close(); }
});
test('body limits and proposal caps are enforced', async () => {
    const host = await hostSession('example.py', source);
    try {
        await assert.rejects(sessionRequest(host.invite, 'POST', { ...proposal(), proposedText: 'x'.repeat(210000) }), /Invalid proposal/);
        const { base, token } = parseInvite(host.invite);
        const response = await fetch(base + '/proposals', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: 'x'.repeat(500001) });
        assert.equal(response.status, 413);
        for (let i = 0; i < 20; i++) await sessionRequest(host.invite, 'POST', proposal());
        await assert.rejects(sessionRequest(host.invite, 'POST', proposal()), /limit/);
    } finally { host.close(); }
});
test('invites cannot send tokens to public hosts or arbitrary paths', () => {
    const token = 'a'.repeat(64);
    for (const invite of [`http://example.com:123/#${token}`, `http://127.0.0.1:123/other#${token}`, `http://user@127.0.0.1:123/#${token}`, 'bad']) {
        assert.throws(() => parseInvite(invite));
    }
});
