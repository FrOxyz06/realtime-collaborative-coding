const http = require('node:http');
const crypto = require('node:crypto');
const { validate, hash } = require('./proposal.cjs');

// A session shares one immutable baseline and accepts proposals, never file writes.
async function hostSession(target, source, options = {}) {
    const baseHash = hash(source);
    validate({ schemaVersion: 1, target, baseHash, proposedText: source });
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + (options.ttlMs || 15 * 60 * 1000);
    const proposals = new Map();
    let closed = false;
    let timer;
    function active() {
        if (closed || Date.now() >= expiresAt) throw new Error('Session expired or ended');
    }
    function get(id) {
        active();
        const proposal = proposals.get(id);
        if (!proposal) throw new Error('Proposal not found');
        return { ...proposal };
    }
    const server = http.createServer(async (req, res) => {
        const send = (status, body) => {
            res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(body));
        };
        if (req.headers.origin) return send(403, { error: 'Browser requests are not supported' });
        const provided = Buffer.from(req.headers.authorization || '');
        const expected = Buffer.from('Bearer ' + token);
        if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
            return send(401, { error: 'Invalid session token' });
        }
        if (closed || Date.now() >= expiresAt) return send(410, { error: 'Session expired or ended' });
        if (req.method === 'GET' && req.url === '/session') {
            return send(200, { schemaVersion: 1, target, source, baseHash, expiresAt,
                proposals: [...proposals.values()].map(({ id, status }) => ({ id, status })) });
        }
        if (req.method !== 'POST' || req.url !== '/proposals') return send(404, { error: 'Unknown route' });
        if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'JSON required' });
        if (proposals.size >= 20) return send(429, { error: 'Session proposal limit reached' });
        let bytes = 0, chunks = [];
        try {
            for await (const chunk of req) {
                bytes += chunk.length;
                if (bytes > 500000) { send(413, { error: 'Proposal is too large' }); return; }
                chunks.push(chunk);
            }
            active();
            if (proposals.size >= 20) return send(429, { error: 'Session proposal limit reached' });
            const proposal = validate(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            if (proposal.target !== target) return send(403, { error: 'This file is not shared in the session' });
            if (proposal.baseHash !== baseHash) return send(409, { error: 'Original file version does not match' });
            if ([...proposals.values()].some(p => p.status === 'applied')) return send(409, { error: 'A proposal was already applied; start a new session' });
            const id = crypto.randomUUID();
            proposals.set(id, { ...proposal, id, status: 'pending' });
            send(201, { id, status: 'pending' });
            options.onProposal?.(id);
        } catch (error) {
            if (!res.headersSent) send(400, { error: error.message });
        }
    });
    server.requestTimeout = 10000;
    server.headersTimeout = 5000;
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const close = () => { closed = true; clearTimeout(timer); server.close(); server.closeAllConnections(); };
    timer = setTimeout(close, Math.max(1, expiresAt - Date.now()));
    timer.unref();
    return {
        invite: `http://127.0.0.1:${server.address().port}/#${token}`, expiresAt,
        list() { active(); return [...proposals.values()].map(p => ({ ...p })); }, get,
        resolve(id, status) {
            if (!['applied', 'rejected'].includes(status)) throw new Error('Invalid outcome');
            const proposal = get(id);
            if (proposal.status !== 'pending') throw new Error('Proposal is no longer pending');
            proposals.get(id).status = status;
            if (status === 'applied') for (const other of proposals.values()) {
                if (other.id !== id && other.status === 'pending') other.status = 'stale';
            }
        }, close
    };
}

function parseInvite(invite) {
    const url = new URL(invite);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
        url.username || url.password || url.pathname !== '/' || url.search || !url.port || !/^#[a-f0-9]{64}$/.test(url.hash)) {
        throw new Error('Use a loopback session invite, through an SSH tunnel for another computer');
    }
    return { base: url.origin, token: url.hash.slice(1) };
}

async function sessionRequest(invite, method = 'GET', proposal) {
    const { base, token } = parseInvite(invite);
    const response = await fetch(base + (method === 'GET' ? '/session' : '/proposals'), {
        method, redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: proposal === undefined ? undefined : JSON.stringify(proposal)
    });
    const text = await response.text();
    if (text.length > 500000) throw new Error('Session response too large');
    const result = JSON.parse(text);
    if (!response.ok) throw new Error(result.error || 'Session request failed');
    return result;
}
module.exports = { hostSession, parseInvite, sessionRequest };
