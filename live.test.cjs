const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hostSession, sessionRequest, snapshotRequest, parseInvite } = require('./session.cjs');
const { watchSnapshots } = require('./watch.cjs');
const { hash } = require('./proposal.cjs');
const source = 'def f(x): return x + 1\n';

test('live snapshots are opt-in, versioned, and never replace the proposal baseline', async () => {
    const host = await hostSession('example.py', source);
    try {
        assert.equal((await snapshotRequest(host.invite)).live, false);
        assert.throws(() => host.publish('def f(x): return x + 2'), /paused/);
        host.setLive(true);
        const copied = await snapshotRequest(host.invite);
        const update = 'def f(x): return 1 + x\n';
        host.publish(update);
        host.publish(update);
        const latest = await snapshotRequest(host.invite);
        assert.equal(latest.revision, 2);
        assert.equal(latest.source, update);
        assert.equal(latest.hash, hash(update));
        assert.equal(copied.source, source);
        assert.equal((await sessionRequest(host.invite)).source, source);
        const proposal = await sessionRequest(host.invite, 'POST', { schemaVersion: 1, target: 'example.py', baseHash: hash(source), proposedText: update });
        assert.equal(host.get(proposal.id).baseHash, hash(source));
        host.setLive(false);
        assert.equal((await snapshotRequest(host.invite)).live, false);
        assert.throws(() => host.publish(source), /paused/);
    } finally { host.close(); }
});

test('guests cannot publish updates and oversized host updates preserve the last snapshot', async () => {
    const host = await hostSession('example.py', source);
    try {
        host.setLive(true);
        assert.throws(() => host.publish('x'.repeat(200001)), /Invalid proposal/);
        assert.equal(host.snapshot().revision, 1);
        const { base, token } = parseInvite(host.invite);
        const response = await fetch(base + '/snapshot', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: source });
        assert.equal(response.status, 404);
        assert.equal((await snapshotRequest(host.invite)).source, source);
    } finally { host.close(); }
});

test('watch observes updates and stops without delivering late callbacks', async () => {
    const host = await hostSession('example.py', source);
    let stop;
    try {
        host.setLive(true);
        const received = [];
        let second;
        const done = new Promise(resolve => { second = resolve; });
        stop = watchSnapshots(host.invite, snapshot => {
            received.push(snapshot.revision);
            if (snapshot.revision === 1) host.publish('def f(x): return 1+x');
            else { stop(); second(); }
        }, error => assert.fail(error), 5);
        await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('Watch timeout')), 2000).unref())]);
        const count = received.length;
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(received.length, count);
        assert.deepEqual(received, [1, 2]);
    } finally { stop?.(); host.close(); }
});

test('watch reports revoked access once instead of retrying forever', async () => {
    const host = await hostSession('example.py', source);
    host.close();
    let failures = 0;
    let signal;
    const done = new Promise(resolve => { signal = resolve; });
    const stop = watchSnapshots(host.invite, () => assert.fail('Revoked access'), () => { failures++; signal(); }, 5);
    try {
        await done;
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(failures, 1);
    } finally { stop(); }
});
