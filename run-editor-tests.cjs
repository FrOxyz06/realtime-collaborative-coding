const path = require('node:path');
const fs = require('node:fs');
const { runTests } = require('@vscode/test-electron');
const root = __dirname;
const cache = process.env.VSCODE_TEST_CACHE || path.join(root, '.vscode-test');
const userData = path.join(cache, 'profile-' + require('./package.json').name);
fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
fs.writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({ 'telemetry.telemetryLevel': 'off', 'chat.disableAIFeatures': true }));
const workspace = path.join(root, '.vscode-test', 'fixture');
fs.mkdirSync(workspace, { recursive: true });
for (const name of ['example.py', 'candidate.py', 'benchmark.json']) fs.copyFileSync(path.join(root, name), path.join(workspace, name));
runTests({ version: '1.138.0', cachePath: cache, extensionDevelopmentPath: root, extensionTestsPath: path.join(root, 'host-test.cjs'),
    extensionTestsEnv: { TEST_PYTHON: process.env.TEST_PYTHON || 'python' },
    launchArgs: [workspace, '--user-data-dir=' + userData, '--extensions-dir=' + path.join(cache, 'extensions-' + require('./package.json').name), '--disable-gpu', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
    reuseMachineInstall: false
}).catch(error => { console.error(error); process.exitCode = 1; });
