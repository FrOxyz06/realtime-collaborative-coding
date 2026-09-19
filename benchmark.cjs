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
    const lines = [result.passed ? 'All supplied cases matched.' : 'Behavior mismatch: do not accept.',
        'Median runtime per case (ms). Small differences may be noise.', ''];
    for (const item of result.cases) {
        lines.push(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}: ${item.beforeMs.toFixed(4)} -> ${item.afterMs.toFixed(4)}`);
    }
    lines.push('', 'Checks return values, argument mutation, stdout, and stderr for these cases only.',
        'This is not proof of equivalence. External effects and memory use are not checked.');
    return lines.join('\n');
}

module.exports = { runBenchmark, report };
