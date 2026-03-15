// Character class for Gas Town visualization
'use strict';

class TownCharacter {
    constructor(name, role, x, y) {
        this.name = name;
        this.role = role;
        this.x = x;
        this.y = y;
        this.state = 'idle';
        this.direction = 'down';
        this.path = [];
        this.pathIndex = 0;
        this.moveSpeed = 0.06;
        this.deskIndex = -1;
        this.issueId = '';
        this.issueTitle = '';
        this.workStatus = '';
        this.rig = '';
        this.visible = true;
        this.bubble = null;
        this._onArrive = null;
    }

    walkTo(gx, gy, onArrive) {
        const path = TownEngine.findPath(
            Math.round(this.x), Math.round(this.y),
            Math.round(gx), Math.round(gy)
        );
        if (path.length < 2) {
            this.x = gx;
            this.y = gy;
            this.state = 'idle';
            if (onArrive) onArrive();
            return;
        }
        this.path = path;
        this.pathIndex = 1;
        this.state = 'walking';
        this._onArrive = onArrive || null;
    }

    showBubble(text, durationMs) {
        this.bubble = {
            text: text,
            expiresAt: Date.now() + (durationMs || 3000),
        };
    }

    update() {
        if (this.bubble && Date.now() > this.bubble.expiresAt) {
            this.bubble = null;
        }

        if (this.state !== 'walking' || this.path.length === 0) return;

        const target = this.path[this.pathIndex];
        if (!target) {
            this.state = 'idle';
            if (this._onArrive) {
                const cb = this._onArrive;
                this._onArrive = null;
                cb();
            }
            return;
        }

        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < this.moveSpeed) {
            this.x = target.x;
            this.y = target.y;
            this.pathIndex++;

            if (Math.abs(dx) > Math.abs(dy)) {
                this.direction = dx > 0 ? 'right' : 'left';
            } else {
                this.direction = dy > 0 ? 'down' : 'up';
            }

            if (this.pathIndex >= this.path.length) {
                this.path = [];
                this.state = 'idle';
                if (this._onArrive) {
                    const cb = this._onArrive;
                    this._onArrive = null;
                    cb();
                }
            }
        } else {
            this.x += (dx / dist) * this.moveSpeed;
            this.y += (dy / dist) * this.moveSpeed;
            if (Math.abs(dx) > Math.abs(dy)) {
                this.direction = dx > 0 ? 'right' : 'left';
            } else {
                this.direction = dy > 0 ? 'down' : 'up';
            }
        }
    }

    sitAtDesk(deskIdx) {
        this.deskIndex = deskIdx;
        const desk = TownEngine.DESK_POSITIONS[deskIdx];
        if (desk) {
            this.x = desk.x;
            this.y = desk.y;
            this.state = 'working';
            this.direction = 'up';
        }
    }

    celebrate() {
        this.state = 'interacting';
        this.showBubble('\u{1f389} Done!', 2000);
        setTimeout(() => {
            if (this.state === 'interacting') this.state = 'working';
        }, 1500);
    }
}

// Character manager
const CharacterManager = (() => {
    const characters = new Map();
    const deskAssignments = new Map();

    function getOrCreate(name, role) {
        if (characters.has(name)) return characters.get(name);
        const char = new TownCharacter(
            name, role,
            TownEngine.ENTRANCE_POS.x, TownEngine.ENTRANCE_POS.y
        );
        characters.set(name, char);
        return char;
    }

    function get(name) {
        return characters.get(name);
    }

    function remove(name) {
        const char = characters.get(name);
        if (char && char.deskIndex >= 0) {
            deskAssignments.delete(char.deskIndex);
        }
        characters.delete(name);
    }

    function assignDesk(name) {
        const char = characters.get(name);
        if (!char) return -1;
        if (char.deskIndex >= 0) return char.deskIndex;

        for (let i = 0; i < TownEngine.DESK_POSITIONS.length; i++) {
            if (!deskAssignments.has(i)) {
                deskAssignments.set(i, name);
                char.deskIndex = i;
                return i;
            }
        }
        return -1;
    }

    function freeDesk(name) {
        const char = characters.get(name);
        if (char && char.deskIndex >= 0) {
            deskAssignments.delete(char.deskIndex);
            char.deskIndex = -1;
        }
    }

    function all() {
        return Array.from(characters.values()).filter(c => c.visible);
    }

    function updateAll() {
        for (const char of characters.values()) {
            char.update();
        }
    }

    function getBubbles() {
        const bubbles = [];
        for (const char of characters.values()) {
            if (char.visible && char.bubble) {
                bubbles.push({ x: char.x, y: char.y, text: char.bubble.text });
            }
        }
        return bubbles;
    }

    return { getOrCreate, get, remove, assignDesk, freeDesk, all, updateAll, getBubbles };
})();
