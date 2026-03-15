// Canvas 2D engine for Gas Town visualization
'use strict';

const TownEngine = (() => {
    // Grid dimensions
    const COLS = 20;
    const ROWS = 15;
    let cellW = 0;
    let cellH = 0;
    let canvas, ctx;

    // Zone definitions (grid coordinates)
    const ZONES = {
        mayorOffice: { x: 0, y: 0, w: 7, h: 6, label: "Mayor's Office", color: '#2a1f3d' },
        workFloor:   { x: 7, y: 0, w: 13, h: 6, label: 'Work Floor', color: '#1a2630' },
        mailroom:    { x: 0, y: 6, w: 7, h: 5, label: 'Mailroom', color: '#1f2a1f' },
        mergeStation:{ x: 7, y: 6, w: 7, h: 5, label: 'Merge Station', color: '#2a2a1f' },
        watchtower:  { x: 14, y: 6, w: 6, h: 5, label: 'Watchtower', color: '#1f1f2a' },
        entrance:    { x: 0, y: 11, w: 20, h: 4, label: 'Entrance', color: '#1a1a1f' },
    };

    // Furniture positions (grid coords)
    const FURNITURE = [
        // Mayor's office
        { x: 3, y: 2, w: 2, h: 1, type: 'desk', label: 'Mayor' },
        // Work floor desks (2 rows of 3)
        { x: 9,  y: 2, w: 1.5, h: 1, type: 'desk', label: '' },
        { x: 11, y: 2, w: 1.5, h: 1, type: 'desk', label: '' },
        { x: 13, y: 2, w: 1.5, h: 1, type: 'desk', label: '' },
        { x: 9,  y: 4, w: 1.5, h: 1, type: 'desk', label: '' },
        { x: 11, y: 4, w: 1.5, h: 1, type: 'desk', label: '' },
        { x: 13, y: 4, w: 1.5, h: 1, type: 'desk', label: '' },
        // Mailroom
        { x: 2, y: 8, w: 2, h: 1, type: 'mailbox', label: 'Mail' },
        // Merge station
        { x: 10, y: 8, w: 2, h: 1, type: 'machine', label: 'Merge' },
        // Watchtower
        { x: 16, y: 8, w: 2, h: 1, type: 'lookout', label: 'Watch' },
    ];

    // Desk positions for worker assignment (grid coords, where they sit)
    const DESK_POSITIONS = [
        { x: 9.75,  y: 3, deskIdx: 1 },
        { x: 11.75, y: 3, deskIdx: 2 },
        { x: 13.75, y: 3, deskIdx: 3 },
        { x: 9.75,  y: 5, deskIdx: 4 },
        { x: 11.75, y: 5, deskIdx: 5 },
        { x: 13.75, y: 5, deskIdx: 6 },
    ];

    const MAYOR_POS = { x: 3.5, y: 3 };
    const ENTRANCE_POS = { x: 10, y: 13 };
    const MERGE_POS = { x: 11, y: 8 };
    const MAIL_POS = { x: 3, y: 8 };
    const DOOR_POS = { x: 6, y: 6 };

    // Simple A* pathfinding on small grid
    const WALKABLE_GRID = [];
    function initGrid() {
        for (let y = 0; y < ROWS; y++) {
            WALKABLE_GRID[y] = [];
            for (let x = 0; x < COLS; x++) {
                WALKABLE_GRID[y][x] = true;
            }
        }
        // Mark furniture as unwalkable
        for (const f of FURNITURE) {
            for (let fy = Math.floor(f.y); fy < Math.ceil(f.y + f.h); fy++) {
                for (let fx = Math.floor(f.x); fx < Math.ceil(f.x + f.w); fx++) {
                    if (fy >= 0 && fy < ROWS && fx >= 0 && fx < COLS) {
                        WALKABLE_GRID[fy][fx] = false;
                    }
                }
            }
        }
    }

    function findPath(sx, sy, ex, ey) {
        const startX = Math.round(sx), startY = Math.round(sy);
        const endX = Math.round(ex), endY = Math.round(ey);

        if (startX === endX && startY === endY) return [];

        const clamp = (v, max) => Math.max(0, Math.min(max - 1, v));
        const gx = (x) => clamp(x, COLS);
        const gy = (y) => clamp(y, ROWS);

        const key = (x, y) => `${x},${y}`;
        const open = [{ x: gx(startX), y: gy(startY), g: 0, h: 0, parent: null }];
        const closed = new Set();

        open[0].h = Math.abs(open[0].x - gx(endX)) + Math.abs(open[0].y - gy(endY));

        const targetX = gx(endX), targetY = gy(endY);
        let iterations = 0;

        while (open.length > 0 && iterations < 500) {
            iterations++;
            open.sort((a, b) => (a.g + a.h) - (b.g + b.h));
            const current = open.shift();

            if (current.x === targetX && current.y === targetY) {
                const path = [];
                let node = current;
                while (node) {
                    path.unshift({ x: node.x, y: node.y });
                    node = node.parent;
                }
                return path;
            }

            closed.add(key(current.x, current.y));

            const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
            for (const [dx, dy] of dirs) {
                const nx = current.x + dx;
                const ny = current.y + dy;
                if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
                if (closed.has(key(nx, ny))) continue;
                if (!WALKABLE_GRID[ny][nx]) continue;

                const g = current.g + 1;
                const h = Math.abs(nx - targetX) + Math.abs(ny - targetY);
                const existing = open.find(n => n.x === nx && n.y === ny);
                if (existing) {
                    if (g < existing.g) {
                        existing.g = g;
                        existing.parent = current;
                    }
                } else {
                    open.push({ x: nx, y: ny, g, h, parent: current });
                }
            }
        }

        // No path found — return direct path
        return [{ x: startX, y: startY }, { x: endX, y: endY }];
    }

    // Colors for character rendering
    const ROLE_COLORS = {
        mayor:    '#ffb454',
        polecat:  '#59c2ff',
        refinery: '#c2d94c',
        witness:  '#d2a6ff',
        crew:     '#95e6cb',
        deacon:   '#ff8f40',
        default:  '#8a919a',
    };

    const ROLE_EMOJI = {
        mayor:    '\u{1f451}',
        polecat:  '\u{1f528}',
        refinery: '\u{2699}',
        witness:  '\u{1f441}',
        crew:     '\u{1f3d7}',
        deacon:   '\u{1f415}',
        default:  '\u{1f464}',
    };

    function init(canvasEl) {
        canvas = canvasEl;
        ctx = canvas.getContext('2d');
        initGrid();
        resize();
        window.addEventListener('resize', resize);
    }

    function resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cellW = rect.width / COLS;
        cellH = rect.height / ROWS;
    }

    function drawFrame(characters, bubbles) {
        const w = canvas.width / (window.devicePixelRatio || 1);
        const h = canvas.height / (window.devicePixelRatio || 1);

        ctx.fillStyle = '#0f1419';
        ctx.fillRect(0, 0, w, h);

        // Draw zones
        for (const zone of Object.values(ZONES)) {
            ctx.fillStyle = zone.color;
            ctx.fillRect(zone.x * cellW, zone.y * cellH, zone.w * cellW, zone.h * cellH);
            ctx.strokeStyle = '#2a3040';
            ctx.lineWidth = 1;
            ctx.strokeRect(zone.x * cellW, zone.y * cellH, zone.w * cellW, zone.h * cellH);
            ctx.fillStyle = 'rgba(138, 145, 154, 0.4)';
            ctx.font = '10px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(zone.label, zone.x * cellW + 6, zone.y * cellH + 14);
        }

        // Draw door
        ctx.fillStyle = '#3a3020';
        ctx.fillRect(DOOR_POS.x * cellW - 4, DOOR_POS.y * cellH - cellH * 0.3, 8, cellH * 0.6);

        // Draw furniture
        for (const f of FURNITURE) {
            const fx = f.x * cellW;
            const fy = f.y * cellH;
            const fw = f.w * cellW;
            const fh = f.h * cellH;

            if (f.type === 'desk') {
                ctx.fillStyle = '#3a2820';
            } else if (f.type === 'mailbox') {
                ctx.fillStyle = '#2a3a2a';
            } else if (f.type === 'machine') {
                ctx.fillStyle = '#3a3a20';
            } else if (f.type === 'lookout') {
                ctx.fillStyle = '#20203a';
            }
            ctx.fillRect(fx, fy, fw, fh);

            const borderColors = { desk: '#5a4030', mailbox: '#4a5a4a', machine: '#5a5a30', lookout: '#30305a' };
            ctx.strokeStyle = borderColors[f.type] || '#2a3040';
            ctx.lineWidth = 1;
            ctx.strokeRect(fx, fy, fw, fh);

            if (f.label) {
                ctx.fillStyle = 'rgba(138, 145, 154, 0.6)';
                ctx.font = '9px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(f.label, fx + fw / 2, fy + fh / 2 + 3);
            }
        }

        // Draw characters
        for (const char of characters) {
            drawCharacter(char);
        }

        // Draw speech bubbles
        for (const bubble of bubbles) {
            drawBubble(bubble);
        }
    }

    function drawCharacter(char) {
        const cx = char.x * cellW;
        const cy = char.y * cellH;
        const size = cellW * 0.7;
        const color = ROLE_COLORS[char.role] || ROLE_COLORS.default;

        // Body (rounded rectangle)
        ctx.fillStyle = color;
        ctx.beginPath();
        const bx = cx - size / 2;
        const by = cy - size / 2;
        const r = 4;
        ctx.moveTo(bx + r, by);
        ctx.lineTo(bx + size - r, by);
        ctx.quadraticCurveTo(bx + size, by, bx + size, by + r);
        ctx.lineTo(bx + size, by + size - r);
        ctx.quadraticCurveTo(bx + size, by + size, bx + size - r, by + size);
        ctx.lineTo(bx + r, by + size);
        ctx.quadraticCurveTo(bx, by + size, bx, by + size - r);
        ctx.lineTo(bx, by + r);
        ctx.quadraticCurveTo(bx, by, bx + r, by);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Emoji face
        const emoji = ROLE_EMOJI[char.role] || ROLE_EMOJI.default;
        ctx.font = `${Math.floor(size * 0.55)}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, cx, cy - 1);

        // Name label
        ctx.fillStyle = color;
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(char.name, cx, cy + size / 2 + 2);

        // State indicator dot
        if (char.state === 'working') {
            ctx.fillStyle = '#c2d94c';
        } else {
            ctx.fillStyle = '#8a919a';
        }
        ctx.beginPath();
        ctx.arc(cx + size / 2, cy - size / 2, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawBubble(bubble) {
        const cx = bubble.x * cellW;
        const cy = bubble.y * cellH - cellH * 0.8;

        ctx.font = '10px monospace';
        const metrics = ctx.measureText(bubble.text);
        const pw = Math.min(metrics.width + 12, 150);
        const ph = 18;

        const bx = cx - pw / 2;
        const by = cy - ph;

        ctx.fillStyle = '#1a1f26';
        ctx.strokeStyle = '#2a3040';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bx, by, pw, ph, 4);
        ctx.fill();
        ctx.stroke();

        // Tail
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy);
        ctx.lineTo(cx, cy + 5);
        ctx.lineTo(cx + 4, cy);
        ctx.closePath();
        ctx.fillStyle = '#1a1f26';
        ctx.fill();
        ctx.stroke();

        // Text
        ctx.fillStyle = '#e6e6e6';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(bubble.text.substring(0, 20), cx, cy - ph / 2);
    }

    function hitTest(px, py, characters) {
        const gx = px / cellW;
        const gy = py / cellH;
        const hitRadius = 0.8;

        for (const char of characters) {
            const dx = gx - char.x;
            const dy = gy - char.y;
            if (dx * dx + dy * dy < hitRadius * hitRadius) {
                return char;
            }
        }
        return null;
    }

    function zoneAt(px, py) {
        const gx = px / cellW;
        const gy = py / cellH;
        for (const [name, zone] of Object.entries(ZONES)) {
            if (gx >= zone.x && gx < zone.x + zone.w &&
                gy >= zone.y && gy < zone.y + zone.h) {
                return { name, ...zone };
            }
        }
        return null;
    }

    return {
        init, resize, drawFrame, hitTest, zoneAt, findPath,
        DESK_POSITIONS, MAYOR_POS, ENTRANCE_POS, MERGE_POS,
        MAIL_POS, DOOR_POS, ROLE_COLORS, COLS, ROWS,
    };
})();
