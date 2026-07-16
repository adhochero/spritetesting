// Drops samples older than the trailing window so the buffer only holds
// recent points for the flick's velocity calculation.
function trimToWindow(buffer, nowMs, windowMs) {
    const cutoff = nowMs - windowMs;
    while (buffer.length > 1 && buffer[0].time < cutoff) buffer.shift();
}

export class Input {
    constructor(canvas) {
        this.canvas = canvas;
        // Positions
        this.startX = null;
        this.startY = null;
        this.endX = null;
        this.endY = null;
        // State
        this.isDown = false;
        this.isMoving = false;
        // Configuration
        this.maxJoystickRange = 100;
        this.pressRadius = 10;
        this.longPressDelay = 500;
        this.quickPressThreshold = 200;
        // Flick: distance is the gate, measured over the trailing sample window,
        // so only a fast late whip of the finger counts (a slow drag never does).
        this.flickSampleWindowMs = 100;
        this.flickMinDistance = 100;
        this.flickMinSpeed = 0; // disabled — the distance gate is sufficient
        // Callbacks
        this.onLongPress = null;
        this.onQuickPress = null;
        this.onFlick = null;
        // Timers
        this.longPressTimer = null;
        this.quickPressTimer = null;
        // Tracking
        this.downTime = 0;
        this.velocityBuffer = [];

        // Bind handlers
        this.handleDown = this.handleDown.bind(this);
        this.handleMove = this.handleMove.bind(this);
        this.handleUp = this.handleUp.bind(this);
    }

    addEventListeners() {
        // Pointer events (mouse + touch)
        this.canvas.addEventListener('pointerdown', this.handleDown, { passive: false });
        window.addEventListener('pointermove', this.handleMove, { passive: false });
        window.addEventListener('pointerup', this.handleUp, { passive: false });
        window.addEventListener('pointercancel', this.handleUp, { passive: false });
    }

    handleDown(e) {
        e.preventDefault();
        const pos = this.getCanvasCoords(e);
        this.startX = this.endX = pos.x;
        this.startY = this.endY = pos.y;
        this.isDown = true;
        this.isMoving = false;
        this.downTime = Date.now();
        this.velocityBuffer = [{ x: pos.x, y: pos.y, time: this.downTime }];

        // Setup long press detection
        this.longPressTimer = setTimeout(() => {
            if (this.isDown && !this.isMoving) {
                this.longPress(this.startX, this.startY);  // Pass coordinates
            }
        }, this.longPressDelay);
    }

    handleMove(e) {
        if (!this.isDown) return;
        e.preventDefault();

        const pos = this.getCanvasCoords(e);
        const now = Date.now();
        this.endX = pos.x;
        this.endY = pos.y;

        this.velocityBuffer.push({ x: pos.x, y: pos.y, time: now });
        trimToWindow(this.velocityBuffer, now, this.flickSampleWindowMs);

        // Check if movement exceeds threshold
        const dx = this.endX - this.startX;
        const dy = this.endY - this.startY;
        const distanceSquared = dx * dx + dy * dy;
        
        if (distanceSquared > this.pressRadius * this.pressRadius) {
            this.isMoving = true;
            clearTimeout(this.longPressTimer);
        }
    }

    handleUp(e) {
        if (!this.isDown) return;
        e.preventDefault();
        
        const pressDuration = Date.now() - this.downTime;
        
        clearTimeout(this.longPressTimer);
        
        // Check for quick press
        if (!this.isMoving && pressDuration < this.quickPressThreshold) {
            this.quickPress(this.startX, this.startY);  // Pass coordinates
        } else if (this.isMoving) {
            this.detectFlick();
        }

        this.isDown = false;
        this.velocityBuffer = [];
        this.resetStartValues();
    }

    // Fires onFlick with the flick's unit direction and distance. Only the trailing
    // window is measured, so where the finger ends up matters, not the whole drag.
    detectFlick() {
        const buffer = this.velocityBuffer;
        if (buffer.length < 2) return;

        const newest = buffer[buffer.length - 1];
        const oldest = buffer[0];
        const elapsed = (newest.time - oldest.time) / 1000;
        const distX = newest.x - oldest.x;
        const distY = newest.y - oldest.y;
        const distance = Math.hypot(distX, distY);

        if (elapsed <= 0 || distance < this.flickMinDistance) return;
        if (distance / elapsed < this.flickMinSpeed) return;

        if (this.onFlick) this.onFlick(distX / distance, distY / distance, distance);
    }

    quickPress(x, y) {
        if (this.onQuickPress) {
            this.onQuickPress(x, y);  // Pass coordinates to callback
        }
    }

    longPress(x, y) {
        if (this.onLongPress) {
            this.onLongPress(x, y);  // Pass coordinates to callback
        }
    }

    resetStartValues() {
        this.startX = null;
        this.startY = null;
        this.endX = null;
        this.endY = null;
        this.isMoving = false;
        this.downTime = 0;
    }

    getJoystickValues() {
        if (!this.isDown) return { x: 0, y: 0 };

        let x = (this.endX - this.startX) / this.maxJoystickRange;
        let y = (this.endY - this.startY) / this.maxJoystickRange;

        const mag = Math.sqrt(x * x + y * y);
        if (mag > 1) {
            x /= mag;
            y /= mag;
        }

        return { x, y };
    }

    getCanvasCoords(event) {
        const rect = this.canvas.getBoundingClientRect();
        let clientX = event.clientX;
        let clientY = event.clientY;
    
        // If it's a touch event with touches, grab the first one
        if (event.touches && event.touches.length > 0) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        }
    
        // Map from client (CSS) space to canvas (pixel) space
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
    
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }
}