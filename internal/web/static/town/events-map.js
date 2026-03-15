// Event-to-animation mapping for Gas Town
'use strict';

const TownEvents = (() => {
    const queue = [];
    let processing = false;

    function enqueue(fn, delayMs) {
        queue.push({ fn, delay: delayMs || 500 });
        if (!processing) processNext();
    }

    function processNext() {
        if (queue.length === 0) {
            processing = false;
            return;
        }
        processing = true;
        const item = queue.shift();
        item.fn();
        setTimeout(processNext, item.delay);
    }

    function actorName(actor) {
        if (!actor) return '';
        const parts = actor.split('/');
        return parts[parts.length - 1];
    }

    function actorRole(actor) {
        if (!actor) return 'default';
        if (actor.includes('mayor')) return 'mayor';
        if (actor.includes('polecats')) return 'polecat';
        if (actor.includes('refinery')) return 'refinery';
        if (actor.includes('witness')) return 'witness';
        if (actor.includes('crew')) return 'crew';
        if (actor.includes('deacon')) return 'deacon';
        return 'default';
    }

    function handleEvent(evt) {
        const type = evt.type || evt.event_type || '';
        const actor = evt.actor || evt.source || '';
        const name = actorName(actor);
        const role = actorRole(actor);
        const target = evt.target || '';
        const targetName = actorName(target);

        if (type === 'boot' || type === 'heartbeat' || type === 'ping') return;

        TownLog.add(type, name, evt.summary || evt.message || type);

        switch (type) {
        case 'session_start':
        case 'spawn':
            enqueue(() => animSpawn(name, role), 800);
            break;
        case 'session_end':
        case 'session_death':
        case 'kill':
            enqueue(() => animDespawn(name), 1000);
            break;
        case 'sling':
            enqueue(() => animSling(name, targetName, role), 1500);
            break;
        case 'done':
            enqueue(() => animDone(name), 1200);
            break;
        case 'nudge':
            enqueue(() => animNudge(name, targetName, role, evt.message || ''), 1000);
            break;
        case 'patrol_started':
        case 'patrol_complete':
            enqueue(() => animPatrol(name, role, type), 600);
            break;
        case 'mail':
        case 'mail_sent':
            enqueue(() => animMail(name, role), 800);
            break;
        case 'merged':
        case 'merge_success':
            enqueue(() => animMerged(name), 800);
            break;
        case 'merge_failed':
        case 'merge_failure':
            enqueue(() => animMergeFailed(name), 800);
            break;
        case 'escalation':
            enqueue(() => animEscalation(name, role, evt.message || ''), 800);
            break;
        case 'handoff':
            enqueue(() => animHandoff(name, role), 800);
            break;
        default:
            if (name) {
                enqueue(() => {
                    const char = CharacterManager.get(name);
                    if (char) char.showBubble(type, 2000);
                }, 400);
            }
            break;
        }
    }

    function animSpawn(name, role) {
        const char = CharacterManager.getOrCreate(name, role);
        char.x = TownEngine.ENTRANCE_POS.x;
        char.y = TownEngine.ENTRANCE_POS.y;
        char.visible = true;
        char.showBubble('Reporting in!', 2000);

        if (role === 'mayor') {
            char.walkTo(TownEngine.MAYOR_POS.x, TownEngine.MAYOR_POS.y, () => {
                char.state = 'working';
            });
        } else if (role === 'polecat' || role === 'crew') {
            const deskIdx = CharacterManager.assignDesk(name);
            if (deskIdx >= 0) {
                const desk = TownEngine.DESK_POSITIONS[deskIdx];
                char.walkTo(desk.x, desk.y, () => {
                    char.state = 'working';
                    char.direction = 'up';
                });
            }
        } else if (role === 'witness') {
            char.walkTo(17, 8, () => { char.state = 'working'; });
        } else if (role === 'refinery') {
            char.walkTo(TownEngine.MERGE_POS.x, TownEngine.MERGE_POS.y, () => {
                char.state = 'working';
            });
        }
    }

    function animDespawn(name) {
        const char = CharacterManager.get(name);
        if (!char) return;
        CharacterManager.freeDesk(name);
        char.showBubble('Signing off', 1500);
        char.walkTo(TownEngine.ENTRANCE_POS.x, TownEngine.ENTRANCE_POS.y, () => {
            char.visible = false;
            CharacterManager.remove(name);
        });
    }

    function animSling(mayorName, targetName) {
        const mayor = CharacterManager.get('mayor') ||
                      CharacterManager.getOrCreate('mayor', 'mayor');
        const target = CharacterManager.get(targetName);
        if (!target) return;

        mayor.showBubble('\u{1f4dc} Sling!', 1500);
        const savedX = mayor.x, savedY = mayor.y;
        mayor.walkTo(target.x, target.y + 1, () => {
            target.showBubble('Got it!', 2000);
            mayor.walkTo(savedX, savedY, () => {
                mayor.state = 'working';
            });
        });
    }

    function animDone(name) {
        const char = CharacterManager.get(name);
        if (!char) return;
        char.celebrate();

        setTimeout(() => {
            const savedX = char.x, savedY = char.y;
            char.walkTo(TownEngine.MERGE_POS.x, TownEngine.MERGE_POS.y + 1, () => {
                char.showBubble('\u{1f4e6} Submitted', 2000);
                char.walkTo(savedX, savedY, () => {
                    char.state = 'working';
                    char.direction = 'up';
                });
            });
        }, 1500);
    }

    function animNudge(fromName, toName, role, message) {
        const from = CharacterManager.get(fromName);
        const to = CharacterManager.get(toName);
        if (!from || !to) {
            if (from) from.showBubble('\u{1f4ac} ' + (message || 'nudge'), 2000);
            return;
        }

        const savedX = from.x, savedY = from.y;
        from.walkTo(to.x, to.y + 1, () => {
            to.showBubble(message || '\u{1f44b}', 2000);
            from.walkTo(savedX, savedY, () => {
                from.state = 'working';
            });
        });
    }

    function animPatrol(name, role, type) {
        const char = CharacterManager.get(name) ||
                     CharacterManager.getOrCreate(name, role);
        if (type === 'patrol_started') {
            char.showBubble('\u{1f50d} Patrol', 2000);
            char.state = 'interacting';
        } else {
            char.showBubble('\u{2705} Clear', 2000);
            char.state = 'working';
        }
    }

    function animMail(name) {
        const char = CharacterManager.get(name);
        if (!char) return;

        const savedX = char.x, savedY = char.y;
        char.walkTo(TownEngine.MAIL_POS.x, TownEngine.MAIL_POS.y + 1, () => {
            char.showBubble('\u{1f4ec} Mail', 1500);
            char.walkTo(savedX, savedY, () => {
                char.state = 'working';
            });
        });
    }

    function animMerged(name) {
        const char = CharacterManager.get(name) ||
                     CharacterManager.get('refinery');
        if (char) {
            char.showBubble('\u{2705} Merged!', 2500);
        }
    }

    function animMergeFailed(name) {
        const char = CharacterManager.get(name) ||
                     CharacterManager.get('refinery');
        if (char) {
            char.showBubble('\u{274c} Merge failed', 2500);
        }
    }

    function animEscalation(name, role, message) {
        const char = CharacterManager.get(name) ||
                     CharacterManager.getOrCreate(name, role);
        char.showBubble('\u{1f6a8} ' + (message || 'Escalation!'), 3000);
    }

    function animHandoff(name) {
        const char = CharacterManager.get(name);
        if (!char) return;
        char.showBubble('\u{1f91d} Handoff', 2000);
    }

    return { handleEvent };
})();

// Event log sidebar
const TownLog = (() => {
    const MAX_ENTRIES = 100;
    let logEl = null;

    function init(el) {
        logEl = el;
    }

    function add(type, actor, message) {
        const now = new Date();
        const time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        renderEntry({ type, actor, message, time });
    }

    function renderEntry(entry) {
        if (!logEl) return;
        const div = document.createElement('div');
        div.className = `log-entry evt-${entry.type}`;
        div.innerHTML = `<span class="log-time">${entry.time}</span>` +
            `<span class="log-actor">${entry.actor}</span> ` +
            `<span class="log-action">${escapeHtml(entry.message)}</span>`;
        logEl.insertBefore(div, logEl.firstChild);

        while (logEl.children.length > MAX_ENTRIES) {
            logEl.removeChild(logEl.lastChild);
        }
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return { init, add };
})();
