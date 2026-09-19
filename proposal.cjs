const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function hash(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function validate(proposal) {
    if (!proposal || proposal.schemaVersion !== 1 || typeof proposal.target !== 'string' ||
        !/^[a-f0-9]{64}$/.test(proposal.baseHash) || typeof proposal.proposedText !== 'string' ||
        Buffer.byteLength(proposal.proposedText) > 200000) throw new Error('Invalid proposal format');
    const parts = proposal.target.split('/');
    if (!proposal.target.endsWith('.py') || /[\\:\x00]/.test(proposal.target) ||
        parts.some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git')) {
        throw new Error('Proposal target must be a relative Python file inside the workspace');
    }
    return proposal;
}

async function targetPath(root, proposal) {
    validate(proposal);
    const realRoot = await fs.realpath(root);
    const target = await fs.realpath(path.join(root, proposal.target));
    const relative = path.relative(realRoot, target);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        throw new Error('Proposal target is outside the workspace');
    }
    return target;
}

function checkBase(proposal, currentText) {
    if (hash(currentText) !== proposal.baseHash) throw new Error('Original file changed. Create a new proposal.');
}

function canAccept(proposal, currentText, result) {
    checkBase(proposal, currentText);
    if (!result || result.passed !== true || result.error || !Array.isArray(result.cases) ||
        !result.cases.length || !result.cases.every(c => c.passed === true)) {
        throw new Error('Run a passing benchmark before accepting');
    }
}

module.exports = { hash, validate, targetPath, checkBase, canAccept };
