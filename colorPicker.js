// colorPicker.js — self-contained HSV picker: a triangle gamut for the current hue
// beside a vertical hue bar. The triangle's own tip is the handle: closed, only that
// tip shows past the right edge; clicking it slides the whole picker out.
// Canvas-rendered with chunky black outlines to match the game's pixel/retro UI.
// No dependencies.

// ── Colour maths ─────────────────────────────────────────────────────────────

// Hue 0-360, saturation/brightness 0-100.
export function hsbToRgb(h, s, b) {
    h = ((h % 360) + 360) % 360;
    s /= 100;
    b /= 100;

    const chroma = b * s;
    const second = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
    const match = b - chroma;

    let rgb;
    if (h < 60)       rgb = [chroma, second, 0];
    else if (h < 120) rgb = [second, chroma, 0];
    else if (h < 180) rgb = [0, chroma, second];
    else if (h < 240) rgb = [0, second, chroma];
    else if (h < 300) rgb = [second, 0, chroma];
    else              rgb = [chroma, 0, second];

    return {
        r: Math.round((rgb[0] + match) * 255),
        g: Math.round((rgb[1] + match) * 255),
        b: Math.round((rgb[2] + match) * 255)
    };
}

export function hsbToRgbString(h, s, b) {
    const c = hsbToRgb(h, s, b);
    return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

export function hsbToHex(h, s, b) {
    const c = hsbToRgb(h, s, b);
    return '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Returns null when the string isn't a #rgb / #rrggbb colour, so callers can ignore
// half-typed input rather than snapping to black.
export function hexToHsb(hex) {
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!match) return null;

    let body = match[1];
    if (body.length === 3) body = body.split('').map(c => c + c).join('');

    const r = parseInt(body.slice(0, 2), 16) / 255;
    const g = parseInt(body.slice(2, 4), 16) / 255;
    const b = parseInt(body.slice(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let h = 0;
    if (delta !== 0) {
        if (max === r)      h = 60 * (((g - b) / delta) % 6);
        else if (max === g) h = 60 * ((b - r) / delta + 2);
        else                h = 60 * ((r - g) / delta + 4);
    }
    if (h < 0) h += 360;

    return { h, s: max === 0 ? 0 : (delta / max) * 100, b: max * 100 };
}

// ── Layout ───────────────────────────────────────────────────────────────────

const BORDER = 6;                       // chunky retro outline
const TRI_W = 150, TRI_H = 150;
const HUE_W = 34, HUE_H = 150;
const CURSOR_R = 9;
const CORNER_R = 8;                     // triangle corner rounding
const HUE_OVERLAP = 3;                  // pulls the hue bar's outline against the triangle's
const TIP_PEEK = 30;                    // width of tip left on screen when closed

// Hex sits just outside the lower edge, rotated to run parallel with it.
const HEX_EDGE_START = 0.04;            // how far along that edge the text begins
const HEX_EDGE_GAP = 6;                 // perpendicular clearance from the edge

// Triangle corners. Left apex is the fully saturated hue, top-right is white and
// bottom-right is black — so any interior point is a hue/white/black mix, which is
// exactly the HSV gamut for this hue.
const APEX  = { x: BORDER,         y: TRI_H / 2 };
const WHITE = { x: TRI_W - BORDER, y: BORDER };
const BLACK = { x: TRI_W - BORDER, y: TRI_H - BORDER };

// Barycentric weights are affine in x and y, so the per-pixel work reduces to two
// multiply-adds once these coefficients are folded in.
const DENOM = (WHITE.y - BLACK.y) * (APEX.x - BLACK.x) + (BLACK.x - WHITE.x) * (APEX.y - BLACK.y);
const AX = (WHITE.y - BLACK.y) / DENOM;
const AY = (BLACK.x - WHITE.x) / DENOM;
const WX = (BLACK.y - APEX.y) / DENOM;
const WY = (APEX.x - BLACK.x) / DENOM;

// Rounds every corner by arcing between the midpoints of adjacent edges.
function roundedPolygonPath(ctx, points, radius) {
    const n = points.length;
    const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

    const start = mid(points[n - 1], points[0]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (let i = 0; i < n; i++) {
        const corner = points[i];
        const nextMid = mid(corner, points[(i + 1) % n]);
        ctx.arcTo(corner.x, corner.y, nextMid.x, nextMid.y, radius);
    }
    ctx.closePath();
}

function trianglePath(ctx) {
    roundedPolygonPath(ctx, [APEX, WHITE, BLACK], CORNER_R);
}

function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
}

function sizeCanvas(canvas, cssW, cssH) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
}

// ── Picker ───────────────────────────────────────────────────────────────────

export function createColorPicker({ hue = 0, saturation = 100, brightness = 100, onChange } = {}) {
    const root = document.getElementById('colorPicker');
    const triangleCanvas = document.getElementById('triangleCanvas');
    const hueCanvas = document.getElementById('hueCanvas');
    const hexInput = document.getElementById('hexInput');

    const state = { h: hue, s: saturation, b: brightness };
    let isOpen = false;

    const triCtx = sizeCanvas(triangleCanvas, TRI_W, TRI_H);
    const hueCtx = sizeCanvas(hueCanvas, HUE_W, HUE_H);

    const trackTop = BORDER;
    const trackBottom = HUE_H - BORDER;

    // Geometry lives here, so the layout that depends on it is derived rather than
    // duplicated in the stylesheet.
    hueCanvas.style.marginLeft = -HUE_OVERLAP + 'px';
    root.style.setProperty('--closed-shift', (TRI_W + HUE_W - HUE_OVERLAP - TIP_PEEK) + 'px');

    // Lay the hex along the apex→black edge, offset clear of it on the outside.
    const edgeAngle = Math.atan2(BLACK.y - APEX.y, BLACK.x - APEX.x);
    const normalX = -Math.sin(edgeAngle);
    const normalY = Math.cos(edgeAngle);
    hexInput.style.left = (APEX.x + (BLACK.x - APEX.x) * HEX_EDGE_START + normalX * HEX_EDGE_GAP) + 'px';
    hexInput.style.top = (APEX.y + (BLACK.y - APEX.y) * HEX_EDGE_START + normalY * HEX_EDGE_GAP) + 'px';
    hexInput.style.transformOrigin = '0 0';
    hexInput.style.transform = `rotate(${edgeAngle}rad)`;

    // Cursor position for the current saturation/brightness. Inverting the weights
    // derived below: a = s*v, w = (1-s)*v, k = 1-v.
    function currentCursor() {
        const s = state.s / 100;
        const v = state.b / 100;
        const a = s * v;
        const w = (1 - s) * v;
        const k = 1 - a - w;
        return {
            x: a * APEX.x + w * WHITE.x + k * BLACK.x,
            y: a * APEX.y + w * WHITE.y + k * BLACK.y
        };
    }

    // Inside the triangle, colour = a*hue + w*white, so brightness is a+w and
    // saturation is a/(a+w). Negative weights mean the point is outside, so they're
    // clamped and renormalised — that projects the drag onto the nearest edge.
    function cursorToSb(x, y) {
        const dx = x - BLACK.x;
        const dy = y - BLACK.y;
        let a = Math.max(0, AX * dx + AY * dy);
        let w = Math.max(0, WX * dx + WY * dy);
        let k = Math.max(0, 1 - (AX * dx + AY * dy) - (WX * dx + WY * dy));

        const sum = a + w + k;
        if (sum === 0) return { s: state.s, b: 0 };
        a /= sum;
        w /= sum;

        const v = a + w;
        // At pure black the hue/saturation is unrecoverable, so keep what we had —
        // otherwise dragging into the corner would silently reset the hue.
        return { s: v > 0 ? (a / v) * 100 : state.s, b: v * 100 };
    }

    function renderTriangle() {
        const dpr = window.devicePixelRatio || 1;
        const dw = triangleCanvas.width;
        const dh = triangleCanvas.height;
        const hueRgb = hsbToRgb(state.h, 100, 100);

        const image = triCtx.createImageData(dw, dh);
        const data = image.data;

        for (let y = 0; y < dh; y++) {
            const cy = (y + 0.5) / dpr;
            for (let x = 0; x < dw; x++) {
                const cx = (x + 0.5) / dpr;
                const dx = cx - BLACK.x;
                const dy = cy - BLACK.y;
                const a = AX * dx + AY * dy;
                const w = WX * dx + WY * dy;
                if (a < 0 || w < 0 || a + w > 1) continue; // outside stays transparent

                const i = (y * dw + x) * 4;
                data[i]     = a * hueRgb.r + w * 255;
                data[i + 1] = a * hueRgb.g + w * 255;
                data[i + 2] = a * hueRgb.b + w * 255;
                data[i + 3] = 255;
            }
        }
        triCtx.putImageData(image, 0, 0); // raw write, ignores the dpr transform

        // putImageData can't be clipped, so trim the square-cornered fill down to the
        // rounded outline afterwards.
        triCtx.save();
        triCtx.globalCompositeOperation = 'destination-in';
        trianglePath(triCtx);
        triCtx.fill();
        triCtx.restore();

        // Closed, the tip is the only thing on screen — flood it with the picked
        // colour so it reads as a swatch. The seam sits off-screen at the viewport
        // edge, and open the gamut is left honest.
        if (!isOpen) {
            triCtx.save();
            triCtx.beginPath();
            triCtx.rect(0, 0, TIP_PEEK + 4, TRI_H);
            triCtx.clip();
            trianglePath(triCtx);
            triCtx.fillStyle = hsbToRgbString(state.h, state.s, state.b);
            triCtx.fill();
            triCtx.restore();
        }

        triCtx.lineWidth = BORDER;
        triCtx.lineJoin = 'round';
        triCtx.strokeStyle = '#000';
        trianglePath(triCtx);
        triCtx.stroke();

        // The cursor is an editing affordance, and a fully saturated pick parks it
        // right on the apex — so leave it off while closed or it reads as a stray
        // dot stuck to the tip.
        if (!isOpen) return;

        const p = currentCursor();
        triCtx.beginPath();
        triCtx.arc(p.x, p.y, CURSOR_R, 0, Math.PI * 2);
        triCtx.fillStyle = hsbToRgbString(state.h, state.s, state.b);
        triCtx.fill();
        triCtx.lineWidth = 3;
        triCtx.strokeStyle = '#000';
        triCtx.stroke();
        // inner light ring keeps the cursor readable against dark picks
        triCtx.beginPath();
        triCtx.arc(p.x, p.y, CURSOR_R - 2.5, 0, Math.PI * 2);
        triCtx.lineWidth = 1.5;
        triCtx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        triCtx.stroke();
    }

    function renderHue() {
        hueCtx.clearRect(0, 0, HUE_W, HUE_H);

        const gradient = hueCtx.createLinearGradient(0, trackTop, 0, trackBottom);
        for (let stop = 0; stop <= 6; stop++) {
            gradient.addColorStop(stop / 6, hsbToRgbString(stop * 60, 100, 100));
        }

        roundRectPath(hueCtx, BORDER / 2, BORDER / 2, HUE_W - BORDER, HUE_H - BORDER, 6);
        hueCtx.fillStyle = gradient;
        hueCtx.fill();
        hueCtx.lineWidth = BORDER;
        hueCtx.lineJoin = 'round';
        hueCtx.strokeStyle = '#000';
        hueCtx.stroke();

        const y = trackTop + (state.h / 360) * (trackBottom - trackTop);
        hueCtx.fillStyle = '#000';
        hueCtx.fillRect(0, y - 5, HUE_W, 10);
        hueCtx.fillStyle = hsbToRgbString(state.h, 100, 100);
        hueCtx.fillRect(3, y - 2, HUE_W - 6, 4);
    }

    function syncReadout() {
        // Don't fight the user mid-edit.
        if (document.activeElement !== hexInput) hexInput.value = hsbToHex(state.h, state.s, state.b);
    }

    function emit() {
        if (onChange) onChange(state.h, state.s, state.b);
    }

    // Pointer drag + click-to-jump. Pointer capture keeps the drag alive when the
    // finger leaves the control, and stopPropagation keeps these gestures away from
    // the game's own pointer handling underneath.
    function attachDrag(canvas, cssW, cssH, handle) {
        let dragging = false;

        const toLocal = event => {
            const rect = canvas.getBoundingClientRect();
            return {
                x: (event.clientX - rect.left) * (cssW / rect.width),
                y: (event.clientY - rect.top) * (cssH / rect.height)
            };
        };

        canvas.addEventListener('pointerdown', event => {
            event.preventDefault();
            event.stopPropagation();
            // Closed, the exposed tip is just a handle — open instead of picking.
            if (!isOpen) {
                setOpen(true);
                return;
            }
            dragging = true;
            handle(toLocal(event));
            // Capture is a nicety — never let it swallow the update above.
            try { canvas.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
        });

        canvas.addEventListener('pointermove', event => {
            if (!dragging) return;
            event.preventDefault();
            event.stopPropagation();
            handle(toLocal(event));
        });

        const end = event => {
            if (!dragging) return;
            dragging = false;
            try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
    }

    attachDrag(triangleCanvas, TRI_W, TRI_H, point => {
        const sb = cursorToSb(point.x, point.y);
        state.s = sb.s;
        state.b = sb.b;
        renderTriangle();
        syncReadout();
        emit();
    });

    attachDrag(hueCanvas, HUE_W, HUE_H, point => {
        const t = (point.y - trackTop) / (trackBottom - trackTop);
        state.h = Math.min(1, Math.max(0, t)) * 360;
        // Saturation/brightness are untouched, so the cursor keeps its spot in the
        // gamut while the triangle re-renders under the new hue.
        renderHue();
        renderTriangle();
        syncReadout();
        emit();
    });

    hexInput.addEventListener('input', () => {
        const parsed = hexToHsb(hexInput.value);
        if (!parsed) return; // ignore half-typed values
        state.h = parsed.h;
        state.s = parsed.s;
        state.b = parsed.b;
        renderHue();
        renderTriangle();
        emit();
    });
    hexInput.addEventListener('blur', syncReadout);
    hexInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') hexInput.blur();
    });
    hexInput.addEventListener('pointerdown', event => event.stopPropagation());

    function setOpen(open) {
        isOpen = open;
        root.classList.toggle('is-open', open);
        renderTriangle(); // swaps the tip between swatch and live gamut
    }

    // Anything outside the picker dismisses it. The controls above stop their own
    // events, so this only sees genuine outside presses.
    document.addEventListener('pointerdown', event => {
        if (isOpen && !root.contains(event.target)) setOpen(false);
    });

    renderHue();
    setOpen(false); // also performs the first triangle render
    syncReadout();
    emit();

    return {
        getColor: () => ({ ...state }),
        open: () => setOpen(true),
        close: () => setOpen(false)
    };
}
