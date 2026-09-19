const { spawn } = require('node:child_process');
const path = require('node:path');

function runBenchmark(python, request, cwd) {
    return new Promise((resolve, reject) => {
        const input = JSON.stringify(request);
        if (Buffer.byteLength(input) > 1000000) return reject(new Error('Benchmark input is too large'));
        const child = spawn(python, [path.join(__dirname, 'benchmark.py')], {
            cwd, windowsHide: true, shell: false,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });
        let output = '';
        let errors = '';
        const timer = setTimeout(() => { child.kill(); reject(new Error('Benchmark timed out')); }, 15000);
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.stdout.on('data', chunk => {
            output += chunk;
            if (output.length > 2000000) {
                child.kill();
                reject(new Error('Benchmark output is too large'));
            }
        });
        child.stderr.on('data', chunk => { errors = (errors + chunk).slice(0, 2000); });
        child.stdin.on('error', () => {});
        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error(errors || 'Python benchmark exited unexpectedly'));
            try { resolve(JSON.parse(output)); } catch { reject(new Error('Invalid benchmark response')); }
        });
        child.stdin.end(input);
    });
}

function report(result) {
    if (result.error) return 'Benchmark failed: ' + result.error;
    const profile = result.mode === 'profile';
    const lines = [profile ? 'Python function profile' : (result.passed ? 'All supplied cases matched.' : 'Behavior mismatch: do not accept.'),
        'Timing excludes warm-up and diagnostic overhead. Small differences may be noise.', ''];
    function details(label, metrics) {
        if (!metrics) return;
        lines.push(`${label}: median ${metrics.medianMs.toFixed(4)} ms; range ${metrics.minMs.toFixed(4)}–${metrics.maxMs.toFixed(4)} ms; peak traced allocations ${metrics.peakBytes} bytes`);
        for (const hotspot of metrics.hotspots) {
            lines.push(`  line ${hotspot.line}: ${hotspot.function}, ${hotspot.calls} calls, ${hotspot.selfMs.toFixed(3)} ms self / ${hotspot.cumulativeMs.toFixed(3)} ms cumulative`);
        }
    }
    for (const item of result.cases) {
        lines.push(`\n${item.passed ? 'PASS' : 'FAIL'} ${item.name}`);
        if (profile) details('Profile', item);
        else {
            lines.push(`Runtime: ${item.beforeMs.toFixed(4)} -> ${item.afterMs.toFixed(4)} ms (${item.timingNote || 'sample'})`);
            if (item.speedup) lines.push(`Observed speed ratio: ${item.speedup.toFixed(2)}x (before / after)`);
            details('Before', item.before); details('After', item.after);
        }
    }
    lines.push('', 'Hotspots use cProfile; memory uses tracemalloc, not whole-process RSS.',
        'Checks cover supplied inputs, not every behavior or external side effect.');
    return lines.join('\n');
}

module.exports = { runBenchmark, report };
