# Try Collab Review (beta)

Collab Review lets you review a Python change before applying it, or watch a friend's file and compare independent solutions. This beta supports one Python file at a time.

## Install without building

1. Download the `collab-review-beta` artifact from a successful [Tests workflow run](https://github.com/FrOxyz06/realtime-collaborative-coding/actions/workflows/test.yml) for the beta branch. GitHub requires signing in to download workflow artifacts. Extract the ZIP to find `collab-review-0.4.0.vsix`.
2. In VS Code 1.138 or newer, open Extensions, select the **…** menu, then **Install from VSIX…** and choose that file. Reload VS Code if prompted.
3. Install Python 3.10+ if you want to run comparisons. Node.js is only needed to develop/build the extension, not to use the installed package.
4. Open one local folder that you trust. Click **Collab Review** in the bottom status bar, or run **Collab: Open Menu** from the Command Palette.
5. Choose **Check Python setup**. If Python cannot start, set **Collab: Python Path** to the full executable path. On macOS/Linux this may be `python3`; on Windows use the executable path printed by `py -0p`, not `py -3`.

## First trial: no partner needed

1. Choose **Try the starter demo**, then **Create demo**. A new `collab-demo-…` folder is created; existing files are not replaced.
2. Inspect the original and proposed Python code in the diff. Both remove repeated values while preserving order.
3. Open the Collab Review menu and choose **Check the reviewed proposal**. The demo's test cases are selected automatically. Approve execution only after reviewing the code.
4. Read the **Collab Benchmark** output: behavior checks, runtime samples, and Python allocation measurements. A passing demo does not prove every input or guarantee a speedup on your computer.
5. Choose **Accept the reviewed proposal** or **Dismiss the reviewed proposal**. Acceptance changes only the sample editor buffer. Saving is your choice; focus the source editor to Undo.
6. Choose **Give feedback**. Describe the first confusing or broken step and what you expected. The form is not submitted automatically.

## Try collaboration in two windows on one computer

1. Open two VS Code windows with the extension installed and one local folder in each. Save a Python file in the host's folder (the demo original works).
2. Host: focus that saved file, choose **Host the current Python file**, and confirm sharing. Choose **Copy invite**; you can copy it again from the menu.
3. Guest: choose **Join with an invite** and paste it. A separate editable Python copy opens.
4. Host: choose **Start live sharing** and confirm. Guest: choose **Watch your friend**. Change the host file and check that the read-only view updates; the guest's independent copy must remain unchanged.
5. Guest: focus the editable copy, make a change, and choose **Compare your solution with your friend**. Select a benchmark JSON with the same function and cases for both; the demo folder includes one.
6. To propose that change instead, focus the editable copy and choose **Send your changes for review**. The host chooses **Review incoming proposals**, checks the code and benchmarks it, then accepts or dismisses it.
7. Choose **End session** when finished. Invites expire after 15 minutes. Hosting a new session replaces the previous hosted invite.

## Two different computers

This beta does not have a hosted relay or account system. The host listens only on its own computer. A copied invite alone will not connect across the internet or LAN.

Use an existing SSH connection to the host. For invite port `12345`, the guest runs:

```sh
ssh -N -L 12345:127.0.0.1:12345 user@owner-host
```

Use the invite's actual port and the actual SSH destination. Keep the tunnel open, then paste the invite in the guest window. Both participants need this version. If the local port is busy, use another local port and change only the invite port to match. This workflow requires SSH access configured separately; it is not an automatic remote setup. Cross-machine behavior has not yet been manually verified.

## If something goes wrong

| Symptom | Next step |
| --- | --- |
| No commands or status-bar button | Confirm Collab Review is enabled in this window and reload VS Code. |
| Open one local workspace folder | Open a single folder, not an empty window or multi-root workspace. |
| Cannot start Python / ENOENT | Run Check Python Setup and set the executable path. |
| Cannot connect / watch stopped | Check the host is active, invite is current, and tunnel is open if needed. Rejoin or restart Watch. |
| Original changed / dirty editor | Save or discard edits and start a fresh session against that baseline. Do not discard work you need. |
| No passing benchmark | Review the behavior mismatch or Python error; check both functions use the configured name and dependencies are installed. |
| Tiny or inconclusive timings | Use representative inputs; do not interpret noise as a reliable speedup. |

Invites grant access to the shared file, so keep them private. Code comparisons execute locally with your permissions, not in a sandbox. Live sharing includes unsaved edits only after you opt in. Feedback does not automatically attach code, invites, paths, or logs. Review any screenshot or report before posting it publicly.

## Feedback we need

- Could you install and finish the solo demo? Where did you get stuck?
- Was the difference between watching, copying, and proposing clear?
- Were the behavior and timing results understandable?
- What would make you use this with a classmate again?

Use **Collab: Give Feedback** or [open a feedback issue](https://github.com/FrOxyz06/realtime-collaborative-coding/issues/new?template=beta-feedback.yml). Include your extension version, OS, VS Code version, and steps to reproduce. Never include an invite token.
