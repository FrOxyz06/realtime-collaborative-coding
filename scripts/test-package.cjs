const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const JSZip = require('jszip');

(async () => {
    const root = path.resolve(__dirname, '..');
    const version = require('../package.json').version;
    const archive = await JSZip.loadAsync(await fs.readFile(path.join(root, `collab-review-${version}.vsix`)));
    for (const name of ['extension/package.json', 'extension/out/extension.js', 'extension/out/onboarding.js',
        'extension/src/benchmark.py', 'extension/src/benchmark.cjs', 'extension/src/session.cjs',
        'extension/examples/deduplicate.py', 'extension/examples/deduplicate-fast.py',
        'extension/examples/deduplicate-benchmark.json', 'extension/docs/TRY_IT.md']) {
        if (!archive.file(name)) throw new Error('Installer is missing ' + name);
    }
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'collab-package-'));
    try {
        for (const entry of Object.values(archive.files)) {
            if (entry.dir || !entry.name.startsWith('extension/')) continue;
            const target = path.resolve(destination, entry.name);
            if (!target.startsWith(destination + path.sep)) throw new Error('Invalid package path');
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, await entry.async('nodebuffer'));
        }
        const result = spawnSync(process.execPath, [path.join(__dirname, 'run-editor-tests.cjs')], {
            stdio: 'inherit', windowsHide: true,
            env: { ...process.env, TEST_EXTENSION_PATH: path.join(destination, 'extension') }
        });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error('Packaged editor tests failed');
    } finally { await fs.rm(destination, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
