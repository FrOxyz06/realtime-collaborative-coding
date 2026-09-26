const { snapshotRequest } = require('./session.cjs');

function watchSnapshots(invite, onSnapshot, onError, intervalMs = 1000) {
    let stopped = false, timer;
    async function tick() {
        try {
            const snapshot = await snapshotRequest(invite);
            if (stopped) return;
            await onSnapshot(snapshot);
            if (!stopped) { timer = setTimeout(tick, intervalMs); timer.unref?.(); }
        } catch (error) {
            if (!stopped) { stopped = true; onError(error); }
        }
    }
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
}
module.exports = { watchSnapshots };
