// Click handlers and interaction for Gas Town
'use strict';

const TownInteraction = (() => {
    let canvas;
    const statusPopup = () => document.getElementById('status-popup');
    const commandPanel = () => document.getElementById('command-panel');
    const cmdInput = () => document.getElementById('cmd-input');
    const cmdOutput = () => document.getElementById('cmd-output');
    let csrfToken = '';

    function init(canvasEl, token) {
        canvas = canvasEl;
        csrfToken = token;

        canvas.addEventListener('click', onClick);

        const input = cmdInput();
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const cmd = input.value.trim();
                    if (cmd) {
                        runCommand(cmd);
                        input.value = '';
                    }
                } else if (e.key === 'Escape') {
                    hideCommandPanel();
                }
            });
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#status-popup') && !e.target.closest('#town-canvas')) {
                hideStatusPopup();
            }
            if (!e.target.closest('#command-panel') && !e.target.closest('#town-canvas')) {
                hideCommandPanel();
            }
        });
    }

    function getCanvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function onClick(e) {
        const { x, y } = getCanvasCoords(e);
        const chars = CharacterManager.all();
        const hit = TownEngine.hitTest(x, y, chars);

        if (hit) {
            if (hit.role === 'mayor') {
                showCommandPanel();
            } else {
                showStatusPopup(hit, e.clientX, e.clientY);
            }
            return;
        }

        const zone = TownEngine.zoneAt(x, y);
        if (zone) {
            showZoneInfo(zone, e.clientX, e.clientY);
        }
    }

    function showStatusPopup(char, px, py) {
        const popup = statusPopup();
        if (!popup) return;

        popup.innerHTML = `
            <div class="pop-name">${escapeHtml(char.name)}</div>
            <div class="pop-role">${escapeHtml(char.role)} ${char.rig ? '(' + escapeHtml(char.rig) + ')' : ''}</div>
            <div class="pop-field"><span class="pop-label">State</span><span class="pop-value">${escapeHtml(char.state)}</span></div>
            <div class="pop-field"><span class="pop-label">Status</span><span class="pop-value">${escapeHtml(char.workStatus || 'unknown')}</span></div>
            ${char.issueId ? `<div class="pop-field"><span class="pop-label">Issue</span><span class="pop-value">${escapeHtml(char.issueId)}</span></div>` : ''}
            ${char.issueTitle ? `<div class="pop-field"><span class="pop-label">Work</span><span class="pop-value">${escapeHtml(char.issueTitle)}</span></div>` : ''}
        `;

        positionPopup(popup, px, py);
        popup.classList.remove('hidden');
    }

    function showZoneInfo(zone, px, py) {
        const popup = statusPopup();
        if (!popup) return;
        popup.innerHTML = `
            <div class="pop-name">${escapeHtml(zone.label)}</div>
            <div class="pop-role">Zone</div>
        `;
        positionPopup(popup, px, py);
        popup.classList.remove('hidden');
    }

    function hideStatusPopup() {
        const popup = statusPopup();
        if (popup) popup.classList.add('hidden');
    }

    function showCommandPanel() {
        const panel = commandPanel();
        if (!panel) return;
        panel.classList.remove('hidden');
        const input = cmdInput();
        if (input) input.focus();
    }

    function hideCommandPanel() {
        const panel = commandPanel();
        if (panel) panel.classList.add('hidden');
    }

    function positionPopup(el, px, py) {
        const pad = 10;
        let left = px + pad;
        let top = py - 20;
        if (left + 300 > window.innerWidth) left = px - 300 - pad;
        if (top + 200 > window.innerHeight) top = window.innerHeight - 220;
        if (top < pad) top = pad;
        el.style.left = left + 'px';
        el.style.top = top + 'px';
    }

    function runCommand(cmd) {
        const out = cmdOutput();
        if (out) out.textContent += '> ' + cmd + '\n';

        fetch('/api/run', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Dashboard-Token': csrfToken,
            },
            body: JSON.stringify({ command: cmd }),
        })
        .then(r => r.json())
        .then(data => {
            if (out) {
                out.textContent += (data.output || data.error || 'OK') + '\n';
                out.scrollTop = out.scrollHeight;
            }
        })
        .catch(err => {
            if (out) out.textContent += 'Error: ' + err.message + '\n';
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return { init };
})();
