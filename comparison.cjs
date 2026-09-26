const { hash } = require('./proposal.cjs');

function verifyComparison(result, yours, friend) {
    if (!result || result.error) throw new Error(result?.error || 'No benchmark result');
    if (result.sourceHashes?.before !== hash(yours) || result.sourceHashes?.after !== hash(friend)) {
        throw new Error('Benchmark result does not match the compared snapshots');
    }
    if (!Array.isArray(result.cases) || !result.cases.length) throw new Error('Benchmark returned no cases');
}

function runtimeWinner(item, allPassed) {
    const a = item.before, b = item.after;
    if (!allPassed || item.passed !== true || item.timingNote !== 'measurable' || !a || !b) return 'inconclusive';
    if (![a.medianMs, b.medianMs, a.minMs, a.maxMs, b.minMs, b.maxMs].every(n => Number.isFinite(n) && n > 0)) return 'inconclusive';
    const ratio = a.medianMs / b.medianMs;
    // Observed non-overlapping ranges and a 5% margin, not a significance test.
    if (a.maxMs < b.minMs && ratio < 1 / 1.05) return 'yours';
    if (b.maxMs < a.minMs && ratio > 1.05) return 'friend';
    return 'inconclusive';
}

function comparisonReport(record) {
    const result = record.result;
    const allPassed = result.passed === true && result.cases.every(c => c.passed === true);
    const lines = ['Your solution vs friend’s snapshot',
        `Friend: ${record.target}, revision ${record.revision}`,
        `Your source SHA-256: ${record.yourHash}`, `Friend source SHA-256: ${record.friendHash}`,
        allPassed ? 'All supplied cases matched. This does not prove general correctness.' : 'Behavior differs. No efficiency winner is reported.',
        'Both solutions ran locally with the same Python interpreter and inputs.', ''];
    if (record.changedDuringRun) lines.push('An editor or shared snapshot changed during the run. Results refer only to the hashes above.', '');
    for (const item of result.cases) {
        const winner = runtimeWinner(item, allPassed);
        lines.push(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}`,
            `  Median runtime: yours ${item.beforeMs.toFixed(4)} ms; friend ${item.afterMs.toFixed(4)} ms`,
            winner === 'inconclusive' ? '  Runtime conclusion: inconclusive (mismatch, noise, overlap or too small a difference).' :
                `  Observed lower runtime: ${winner}; not a statistical significance claim.`,
            `  Peak traced Python allocations: yours ${item.before.peakBytes} bytes; friend ${item.after.peakBytes} bytes`);
    }
    lines.push('', 'Memory is Python allocation tracing, not whole-process RAM. Runtime and memory can favor different solutions.',
        'No file was replaced. Use Collab: Export Comparison to save this report.');
    return lines.join('\n');
}

module.exports = { verifyComparison, runtimeWinner, comparisonReport };
