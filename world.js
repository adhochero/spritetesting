// world.js — Procedural terrain and the dual-grid lookup used to render it.
//
// TERRAIN is a logical grid of terrain ids (1 = grass, 0 = dirt) and never renders
// directly. The DISPLAY grid is offset by half a tile: each display cell samples the
// four TERRAIN cells meeting at its centre and picks one of 16 atlas tiles, so
// grass/dirt boundaries blend instead of stair-stepping.
//
// Terrain is purely visual — everything is walkable. Out of bounds reads as dirt, so
// the island sits in an endless dirt plane rather than ending at a hard cut.

export const TILE_PX = 16;   // source tile size in the atlas
export const TILE_SIZE = 48; // rendered size in world units (TILE_PX at the sprite scale)

export const WORLD_COLS = 32;
export const WORLD_ROWS = 24;

// Change this to roll a different island — generation is fully deterministic.
export const SEED = 20260719;

const SPAWN_COL = Math.floor(WORLD_COLS / 2);
const SPAWN_ROW = Math.floor(WORLD_ROWS / 2);

export const SPAWN = {
    x: SPAWN_COL * TILE_SIZE + TILE_SIZE / 2,
    y: SPAWN_ROW * TILE_SIZE + TILE_SIZE / 2
};

// ── Generation ───────────────────────────────────────────────────────────────

const GRASS = 1;
const DIRT = 0;

const CA_PASSES = 4;
const FILL_CENTRE = 0.86;     // grass chance at the middle of the map
const EDGE_FALLOFF = 0.55;    // how hard that chance falls off toward the edges
const CLEARING_RADIUS = 3.4;  // grass disc guaranteed around spawn
const TRAIL_COUNT = 2;
const TRAIL_RADIUS = 0.9;     // one cell wide — any wider and trails eat the coast
const TRAIL_STEPS = 16;       // long enough to reach the shore from the clearing
const TRAIL_WANDER = 0.6;     // amplitude of the meander, in radians

// mulberry32 — a small deterministic PRNG, so one seed always yields one island.
function makeRandom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function generate() {
    const random = makeRandom(SEED);

    // Seed fill, biased toward grass in the middle, so smoothing resolves into one
    // cohesive island instead of noise running off every edge.
    let grid = [];
    for (let row = 0; row < WORLD_ROWS; row++) {
        const line = [];
        for (let col = 0; col < WORLD_COLS; col++) {
            const nx = (col - (WORLD_COLS - 1) / 2) / ((WORLD_COLS - 1) / 2);
            const ny = (row - (WORLD_ROWS - 1) / 2) / ((WORLD_ROWS - 1) / 2);
            const distance = Math.hypot(nx, ny);
            const chance = FILL_CENTRE - EDGE_FALLOFF * distance * distance;
            line.push(random() < chance ? GRASS : DIRT);
        }
        grid.push(line);
    }

    // Majority smoothing: each cell becomes whatever most of its 3x3 neighbourhood
    // is. Out of bounds counts as dirt, so the coastline erodes inward on its own.
    // Reading the previous grid while building a new one keeps the pass simultaneous.
    for (let pass = 0; pass < CA_PASSES; pass++) {
        const previous = grid;
        grid = previous.map((line, row) => line.map((_, col) => {
            let grass = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const r = row + dy;
                    const c = col + dx;
                    if (r < 0 || r >= WORLD_ROWS || c < 0 || c >= WORLD_COLS) continue;
                    grass += previous[r][c];
                }
            }
            return grass >= 5 ? GRASS : DIRT;
        }));
    }

    const stamp = (centreCol, centreRow, radius, value) => {
        const span = Math.ceil(radius);
        for (let dy = -span; dy <= span; dy++) {
            for (let dx = -span; dx <= span; dx++) {
                if (dx * dx + dy * dy > radius * radius) continue;
                const r = Math.round(centreRow) + dy;
                const c = Math.round(centreCol) + dx;
                if (r < 0 || r >= WORLD_ROWS || c < 0 || c >= WORLD_COLS) continue;
                grid[r][c] = value;
            }
        }
    };

    // Winding dirt trails radiating from the clearing out to the shore. Headings are
    // spread evenly then jittered so the trails leave in different directions, the
    // sine term does the meandering, and the phase stops them tracing the same curve.
    // Running them outward from spawn (rather than straight across the map) keeps
    // them from merging with the coastline and carving the island apart.
    const firstHeading = random() * Math.PI * 2;
    for (let trail = 0; trail < TRAIL_COUNT; trail++) {
        const heading = firstHeading
            + (trail * Math.PI * 2) / TRAIL_COUNT
            + (random() - 0.5);
        const phase = random() * Math.PI * 2;

        let col = SPAWN_COL;
        let row = SPAWN_ROW;
        for (let i = 0; i < TRAIL_STEPS; i++) {
            const angle = heading
                + Math.sin(i * 0.18 + phase) * TRAIL_WANDER
                + (random() - 0.5) * 0.2;
            col += Math.cos(angle);
            row += Math.sin(angle);
            stamp(col, row, TRAIL_RADIUS, DIRT);
        }
    }

    // Clearing goes on last, so spawn is grass even if a trail ran straight over it.
    stamp(SPAWN_COL, SPAWN_ROW, CLEARING_RADIUS, GRASS);

    // Hold a dirt margin so the island can never run off the edge of the grid.
    for (let row = 0; row < WORLD_ROWS; row++) {
        for (let col = 0; col < WORLD_COLS; col++) {
            const onEdge = row === 0 || col === 0 || row === WORLD_ROWS - 1 || col === WORLD_COLS - 1;
            if (onEdge) grid[row][col] = DIRT;
        }
    }

    return grid;
}

export const TERRAIN = generate();

// ── Dual-grid lookup ─────────────────────────────────────────────────────────

// The 4 corner terrains of a display cell (TL,TR,BL,BR — grass=1) form a 4-bit mask
// (bit0=TL, bit1=TR, bit2=BL, bit3=BR). This maps each of the 16 masks to a [col,row]
// in DualGrid_TileSet_Grass.png (a 4x4 sheet).
export const DUAL_GRID_ATLAS = [
    /* 0000 */ [0, 3], // all dirt
    /* 0001 TL */ [3, 3],
    /* 0010 TR */ [0, 2],
    /* 0011 TL+TR (top) */ [1, 2],
    /* 0100 BL */ [0, 0],
    /* 0101 TL+BL (left) */ [3, 2],
    /* 0110 TR+BL */ [2, 3],
    /* 0111 TL+TR+BL (inner top-left) */ [3, 1],
    /* 1000 BR */ [1, 3],
    /* 1001 TL+BR */ [0, 1],
    /* 1010 TR+BR (right) */ [1, 0],
    /* 1011 TL+TR+BR (inner top-right) */ [2, 2],
    /* 1100 BL+BR (bottom) */ [3, 0],
    /* 1101 TL+BL+BR (inner bottom-left) */ [2, 0],
    /* 1110 TR+BL+BR (inner bottom-right) */ [1, 1],
    /* 1111 all grass */ [2, 1]
];

// Terrain id at a world cell; out of bounds reads as dirt so the world edge fades to
// dirt rather than a hard cut.
export function getTerrain(col, row) {
    if (row < 0 || row >= WORLD_ROWS || col < 0 || col >= WORLD_COLS) return 0;
    return TERRAIN[row][col];
}

// The atlas [col,row] for the display cell centred on the terrain corner at
// (col, row) — it samples world (col-1,row-1)=TL through (col,row)=BR.
export function dualGridAtlasAt(col, row) {
    const tl = getTerrain(col - 1, row - 1) === 1 ? 1 : 0;
    const tr = getTerrain(col,     row - 1) === 1 ? 1 : 0;
    const bl = getTerrain(col - 1, row)     === 1 ? 1 : 0;
    const br = getTerrain(col,     row)     === 1 ? 1 : 0;
    return DUAL_GRID_ATLAS[tl | (tr << 1) | (bl << 2) | (br << 3)];
}
