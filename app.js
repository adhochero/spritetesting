import { Input } from './input.js';
import { AnimatedSprite } from './animatedSprite.js';

const supabaseUrl = 'https://gqbeyhseepsnhxjblxzh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxYmV5aHNlZXBzbmh4amJseHpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI3Njk5NDksImV4cCI6MjA1ODM0NTk0OX0.c-3qmp9WTVOEVMlJnSS4b128roCBHd978t3lGebWq4s';
const supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

let channel = null;

const canvas = document.getElementById('gameCanvas');
const context = canvas.getContext('2d');
const canvasViewportPercentage = 0.9;
const canvasResolutionWidth = 666;
const canvasResolutionHeight = 666;

let lastUpdate = Date.now();

const userImage = new Image();
userImage.src = './assets/pixel_sphere_16x16.png'; 
const userImageSize = 25;

let users = {};
let localUserPosition = { x: 333, y: 333 };
const localUserId = crypto.randomUUID();

const drawnPositions = {};
let positionSpeed = 1.5;

let player;
let lastDirectionX = 1;
const playerIdleImage = new Image();
playerIdleImage.src = './assets/idle.png';
const playerRunImage = new Image();
playerRunImage.src = './assets/run.png';

let activeSprites = [];
const explosionImage = new Image();
explosionImage.src = './assets/explosion.png'; 

let input = new Input(canvas);
input.addEventListeners();

// Assign functions with coordinate parameters
input.onLongPress = (x, y) => {
    const worldX = x - camera.x; // Get real-world coordinates
    const worldY = y - camera.y;

    const maxRangeSq = 30 * 30;
    if (getSquaredDistance(localUserPosition.x, localUserPosition.y, worldX, worldY) <= maxRangeSq){
        console.log('This is you.')
    }
    else {
        console.log('You are not within range of LongPress.');

        const dx = worldX - localUserPosition.x;
        const dy = worldY - localUserPosition.y;
        const dNormalized = normalize2D(dx, dy);
        
        velocity.x = (dNormalized.x) * 500;
        velocity.y = (dNormalized.y) * 500;
    }
};

input.onQuickPress = (x, y) => {
    const worldX = x - camera.x; // Get real-world coordinates
    const worldY = y - camera.y;

    const closest = getClosestUser(worldX, worldY, 30);

    if (closest) {
        console.log(`Quick press: Closest player is ${closest.id} at`, closest.position);
        // You can interact with the closest player here
    } else {
        console.log("No player found within range of QuickPress.");
    }

    triggerExplosion(worldX, worldY);
};

let inputSmoothing = { x: 0, y: 0 };
let velocity = { x: 0, y: 0 };
let moveDirection = { x: 0, y: 0 };
let inputResponsiveness = 6;
let localUserSpeed = 150;

let camera = { x: 0, y: 0 };
let cameraFollowSpeed = 3;

let lastTimeStamp = 0;


let fadeElapsed = 0; //for draw text fade


window.addEventListener('resize', adjustCanvasSize);
window.addEventListener('orientationchange', adjustCanvasSize);

window.addEventListener('load', async () => {
    initNetworking();
    adjustCanvasSize();

    player = new AnimatedSprite(playerIdleImage, 2, 5, 1, 2, 5, 333, 333, .42, false, true, true);

    // Start the animation loop
    window.requestAnimationFrame(update);     
});

function initNetworking(){
    // Channel for presence and broadcast
    channel = supabase.channel('user_tracking', {
        config: { presence: { key: 'user_id' } }
    });

    // Setup presence tracking
    channel
    .on('presence', { event: 'sync' }, () => {
        // Efficiently rebuild the users object only when absolutely needed
        const newUsers = {};
        Object.values(channel.presenceState()).forEach(presences => {
            presences.forEach(presence => {
                newUsers[presence.user_id] = {
                    // Preserve existing data if available, only update if missing
                    user_position: users[presence.user_id]?.user_position 
                                || presence.user_position 
                                || { x: 0, y: 0 }
                };
            });
        });
        users = newUsers; // Atomic swap
    })
    .on('presence', { event: 'join' }, ({ newPresences }) => {
        // Only add truly new users (not already tracked)
        newPresences.forEach(presence => {
            if (!users[presence.user_id]) {
                users[presence.user_id] = {
                    user_position: presence.user_position || { x: 0, y: 0 }
                };
            }
        });
    })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        // Immediate cleanup
        leftPresences.forEach(presence => {
            delete users[presence.user_id];
        });
    });

    // Handle broadcast messages
    channel.on('broadcast', { event: 'user_move' }, ({ payload }) => {
        if (payload.user_id !== localUserId) {  // Don't update our own position from broadcasts
            users[payload.user_id] = {
                user_position: payload.user_position
            };
        }
    });

    // Subscribe to the channel
    channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
            channel.track({
                user_id: localUserId,
                user_position: localUserPosition,
            });
        }
    });
}

function update(timeStamp) {
    const maxDeltaTime = 0.1; // Maximum time difference between frames (in seconds)
    const deltaTime = Math.min((timeStamp - lastTimeStamp) / 1000, maxDeltaTime);
    lastTimeStamp = timeStamp;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.beginPath();
    context.imageSmoothingEnabled = false;

    const inputDirection = input.getJoystickValues();

    // Smooth input movement using lerp
    inputSmoothing.x = lerp(inputSmoothing.x, inputDirection.x, inputResponsiveness * deltaTime);
    inputSmoothing.y = lerp(inputSmoothing.y, inputDirection.y, inputResponsiveness * deltaTime);

    // Apply velocity falloff
    velocity.x = lerp(velocity.x, 0, inputResponsiveness * deltaTime);
    velocity.y = lerp(velocity.y, 0, inputResponsiveness * deltaTime);

    // Combine velocity and input movement
    moveDirection.x = velocity.x + (inputSmoothing.x * localUserSpeed);
    moveDirection.y = velocity.y + (inputSmoothing.y * localUserSpeed);

    // Handle local player movement
    let moved = false;
    if (moveDirection.x != 0) {
        localUserPosition.x += moveDirection.x * deltaTime;
        moved = true;
    }
    if (moveDirection.y != 0) {
        localUserPosition.y += moveDirection.y * deltaTime;
        moved = true;
    }

    // thottle my network updates
    const now = Date.now();
    if (moved && now - lastUpdate > 200) {
        lastUpdate = now;

        // Update our presence
        channel.track({
            user_id: localUserId,
            user_position: localUserPosition,
        });

        // Broadcast user position to others
        channel.send({
            type: 'broadcast',
            event: 'user_move',
            payload: {
                user_id: localUserId,
                user_position: localUserPosition,
            },
        });
    }

    // Update camera to follow local player
    camera.x = lerp(camera.x, -localUserPosition.x + canvas.width / 2, cameraFollowSpeed * deltaTime);
    camera.y = lerp(camera.y, -localUserPosition.y + canvas.height / 2, cameraFollowSpeed * deltaTime);

    // Draw grid
    drawGrid(-(camera.x + canvas.width / 2), -(camera.y + canvas.height / 2));


    //fade text
    fadeElapsed += deltaTime;
    const fadeDuration = 3;
    let t = Math.min(fadeElapsed / fadeDuration, 1); // Normalize to [0,1]
    let easedT = Math.pow(t, 3); // ease-in cubic
    let alpha = lerp(1, 0, easedT); // Fade from 1 → 0
    drawText(-250, -125, Math.PI / 2, 'bold 64px Xirod', `RGBA(255, 53, 94, ${alpha})`, 'begin');


    // Apply camera transform
    context.translate(camera.x, camera.y);

    // Draw other users
    Object.entries(users).forEach(([id, data]) => {
        if(id === localUserId) return;

            // Initialize the drawn position if it doesn't exist
            if (!drawnPositions[id]) {
                drawnPositions[id] = {
                    x: data.user_position.x,
                    y: data.user_position.y
                };
            }

        // Apply lerp to smooth the movement
        // drawnPositions[id].x = lerp(drawnPositions[id].x, data.user_position.x, positionSpeed * deltaTime);
        // drawnPositions[id].y = lerp(drawnPositions[id].y, data.user_position.y, positionSpeed * deltaTime);

        // Apply damp to smooth the movement
        function damp(current, target, lambda, dt) {
            return current + (target - current) * (1 - Math.exp(-lambda * dt));
        }
          
        // Then apply
        drawnPositions[id].x = damp(drawnPositions[id].x, data.user_position.x, positionSpeed, deltaTime);
        drawnPositions[id].y = damp(drawnPositions[id].y, data.user_position.y, positionSpeed, deltaTime);
          

        drawUser(drawnPositions[id], id, userImage, userImageSize);
    });

    // drawUser(localUserPosition, localUserId, userImage, userImageSize);

    //change spritesheet row by angle of movement
    context.save(); // Save current state
    player.x = localUserPosition.x;
    player.y = localUserPosition.y;
    if(inputDirection.x !== 0) lastDirectionX = inputDirection.x;

    if (lastDirectionX < 0) {
        context.translate(player.x * 2, 0);
        context.scale(-1, 1);
    }

    let isMoving = inputDirection.x !== 0 || inputDirection.y !== 0;

    if (isMoving && player.spriteSheet !== playerRunImage) {
        player.setSpriteSheet(playerRunImage, 4, 5, player.currentRow, 4, 0.18);
    } else if (!isMoving && player.spriteSheet !== playerIdleImage) {
        player.setSpriteSheet(playerIdleImage, 2, 5, player.currentRow, 2, 0.42);
    }

    if (isMoving) {        
        let angle = Math.atan2(inputDirection.y, inputDirection.x);
        let degrees = angle * (180 / Math.PI);
        if (degrees < 0) degrees += 360;
    
        let dir = 1;
        if (degrees >= 337.5 || degrees < 22.5)        dir = 3; // Right
        else if (degrees >= 22.5 && degrees < 67.5)    dir = 2; // Down-Right
        else if (degrees >= 67.5 && degrees < 112.5)   dir = 1; // Down
        else if (degrees >= 112.5 && degrees < 157.5)  dir = 2; // Down-Left
        else if (degrees >= 157.5 && degrees < 202.5)  dir = 3; // Left
        else if (degrees >= 202.5 && degrees < 247.5)  dir = 4; // Up-Left
        else if (degrees >= 247.5 && degrees < 292.5)  dir = 5; // Up
        else if (degrees >= 292.5 && degrees < 337.5)  dir = 4; // Up-Right
           
        player.currentRow = dir;
    }
    player.update(deltaTime);
    player.drawSprite(context);
    context.restore(); // Restore canvas to unrotated state



    // Update and draw all active animations
    activeSprites.forEach(explosion => {
        explosion.update(deltaTime);
        explosion.drawSprite(context);
    });

    // Remove finished non-looping animations
    activeSprites = activeSprites.filter(explosion => !(explosion.finished && !explosion.loop));


    context.restore();

    window.requestAnimationFrame(update);
}

function drawUser(userPosition, userId, image, size){
    context.beginPath();
    context.drawImage(
        image,
        userPosition.x - size / 2,
        userPosition.y - size / 2,
        size,
        size
    );
    // context.arc(userPosition.x, userPosition.y, 10, 0, Math.PI * 2);
    // context.fillStyle = 'black';
    // context.fill();
    context.fillStyle = 'black';
    context.font = 'bold 12px Arial';
    context.textAlign = 'center';
    context.fillText(userId.substring(0, 6), userPosition.x, userPosition.y - size * 3 / 4);
}

function adjustCanvasSize() {
    let scaleX = window.innerWidth / canvasResolutionWidth;
    let scaleY = window.innerHeight / canvasResolutionHeight;
    let scale = Math.min(scaleX, scaleY) * canvasViewportPercentage;

    // Set the internal resolution (render size)
    canvas.width = canvasResolutionWidth;
    canvas.height = canvasResolutionHeight;

    // Set the display size (CSS pixels)
    canvas.style.width = canvasResolutionWidth * scale + 'px';
    canvas.style.height = canvasResolutionHeight * scale + 'px';
}

function lerp(start, end, t) {
    return start + (end - start) * t;
}

function drawGrid(offsetX, offsetY) {
    const gridSize = 50;
    context.strokeStyle = "#fff";
    context.lineWidth = 0.5;

    const startX = Math.floor(offsetX / gridSize) * gridSize - offsetX;
    const startY = Math.floor(offsetY / gridSize) * gridSize - offsetY;

    for (let x = startX; x < canvas.width; x += gridSize) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, canvas.height);
        context.stroke();
    }

    for (let y = startY; y < canvas.height; y += gridSize) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(canvas.width, y);
        context.stroke();
    }
}

function getClosestUser(x, y, maxRange) {
    let closestId = null;
    let closestDistance = Infinity;
    const maxDistSq = maxRange * maxRange;

    for (const [id, pos] of Object.entries(drawnPositions)) {
        if (id === localUserId) continue; // Skip the local player
        
        const distanceSq = getSquaredDistance(pos.x, pos.y, x, y);

        if (distanceSq < closestDistance && distanceSq <= maxDistSq) {
            closestDistance = distanceSq;
            closestId = id;
        }
    }

    return closestId ? { id: closestId, position: drawnPositions[closestId] } : null;
}

function getSquaredDistance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy;
}

function normalize2D(x, y) {
    const length = Math.hypot(x, y); // √(x² + y²)
    if (length === 0) return { x: 0, y: 0 }; // zero vector stays zero
    return { x: x / length, y: y / length }; // each component now between -1 and 1
}

function triggerExplosion(x, y) {
    let explosion = new AnimatedSprite(explosionImage, 2, 3, 1, 2, 5, x, y, .12, true, false, false);
    explosion.start(); // start just to be safe
    activeSprites.push(explosion);
}

function drawText(offsetX, offsetY, rotation, font, color, text){
    context.save(); // Save current state
    context.translate(canvas.width / 2 + offsetX, canvas.height / 2 + offsetY); // Move origin to where you want the text to start
    context.rotate(rotation); // (Math.PI / 2) = Rotate 90° clockwise
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = font; // 'size and fontName'
    context.fillStyle = color; // 'color'
    context.fillText(text, 0, 0); // 'text'
    context.restore(); // Restore canvas to unrotated state
}