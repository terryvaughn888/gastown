// Main entry point for Gas Town visualization
'use strict';

(function() {
    const canvas = document.getElementById('town-canvas');
    const logEl = document.getElementById('log-entries');
    const state = window.__TOWN_STATE__ || {};
    const csrfToken = document.querySelector('meta[name="dashboard-token"]')?.content || '';

    TownEngine.init(canvas);
    TownLog.init(logEl);
    TownInteraction.init(canvas, csrfToken);

    initFromState(state);
    connectSSE();
    requestAnimationFrame(renderLoop);

    function initFromState(state) {
        // Add mayor
        if (state.mayor && state.mayor.IsAttached) {
            const mayor = CharacterManager.getOrCreate('mayor', 'mayor');
            mayor.x = TownEngine.MAYOR_POS.x;
            mayor.y = TownEngine.MAYOR_POS.y;
            mayor.state = state.mayor.IsActive ? 'working' : 'idle';
            mayor.visible = true;
        }

        // Add workers
        if (state.workers) {
            for (const w of state.workers) {
                const name = w.Name || '';
                if (!name) continue;

                const role = w.AgentType === 'refinery' ? 'refinery' : 'polecat';
                const char = CharacterManager.getOrCreate(name, role);
                char.rig = w.Rig || '';
                char.workStatus = w.WorkStatus || '';
                char.issueId = w.IssueID || '';
                char.issueTitle = w.IssueTitle || '';
                char.visible = true;

                if (role === 'refinery') {
                    char.x = TownEngine.MERGE_POS.x;
                    char.y = TownEngine.MERGE_POS.y;
                    char.state = 'working';
                } else {
                    const deskIdx = CharacterManager.assignDesk(name);
                    if (deskIdx >= 0) {
                        const desk = TownEngine.DESK_POSITIONS[deskIdx];
                        char.x = desk.x;
                        char.y = desk.y;
                        char.state = w.WorkStatus === 'stuck' ? 'idle' : 'working';
                        char.direction = 'up';
                    }
                }
            }
        }

        // Add sessions not in workers (witness, etc.)
        if (state.sessions) {
            for (const s of state.sessions) {
                const name = s.Worker || s.Role || '';
                if (!name || CharacterManager.get(name)) continue;

                const role = s.Role || 'default';
                if (role === 'witness') {
                    const char = CharacterManager.getOrCreate(name, 'witness');
                    char.x = 17;
                    char.y = 8;
                    char.state = s.IsAlive ? 'working' : 'idle';
                    char.visible = true;
                }
            }
        }
    }

    function connectSSE() {
        const es = new EventSource('/api/events');
        es.addEventListener('town-event', (e) => {
            try {
                const evt = JSON.parse(e.data);
                TownEvents.handleEvent(evt);
            } catch (_) {
                // Ignore malformed events
            }
        });
    }

    function renderLoop() {
        CharacterManager.updateAll();
        TownEngine.drawFrame(CharacterManager.all(), CharacterManager.getBubbles());
        requestAnimationFrame(renderLoop);
    }
})();
