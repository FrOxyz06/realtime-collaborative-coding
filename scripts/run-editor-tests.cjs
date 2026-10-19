const path = require('node:path');
const fs = require('node:fs');
const { runTests } = require('@vscode/test-electron');
const root = path.resolve(__dirname, '..');
const cache = process.env.VSCODE_TEST_CACHE || path.join(root, '.vscode-test');
const testName = require('../package.json').name + (process.env.TEST_EXTENSION_PATH ? '-package' : '-source');
const userData = path.join(cache, 'profile-' + testName);
fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
fs.writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({ 'telemetry.telemetryLevel': 'off', 'chat.disableAIFeatures': true }));
const workspace = path.join(root, '.vscode-test', 'fixture-' + testName);
fs.mkdirSync(workspace, { recursive: true });
for (const name of ['example.py', 'candidate.py', 'benchmark.json']) fs.copyFileSync(path.join(root, 'examples', name), path.join(workspace, name));
runTests({ version: '1.138.0', cachePath: cache, extensionDevelopmentPath: process.env.TEST_EXTENSION_PATH || root,
    extensionTestsPath: process.env.TEST_EXTENSION_TESTS_PATH || path.join(root, 'tests', 'host-test.cjs'),
    extensionTestsEnv: { TEST_PYTHON: process.env.TEST_PYTHON || 'python' },
    launchArgs: [workspace, '--user-data-dir=' + userData, '--extensions-dir=' + path.join(cache, 'extensions-' + testName), '--disable-gpu', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
    reuseMachineInstall: false
}).catch(error => { console.error(error); process.exitCode = 1; });

