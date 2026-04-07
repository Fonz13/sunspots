const setupScreen = document.getElementById('setup-screen');
const arContainer = document.getElementById('ar-container');
const startBtn = document.getElementById('start-btn');
const errorMsg = document.getElementById('setup-error');
const video = document.getElementById('camera-bg');
const canvas = document.getElementById('ar-canvas');
const ctx = canvas.getContext('2d');
const datePicker = document.getElementById('date-picker');

const statusMsg = document.getElementById('status-msg');
const statusIndicator = document.getElementById('status-indicator');
const elevDisplay = document.getElementById('current-elevation');
const azimDisplay = document.getElementById('current-azimuth');

const infoBtn = document.getElementById('info-btn');
const infoModal = document.getElementById('info-modal');
const closeInfoBtn = document.getElementById('close-info-btn');
const tzDisplay = document.getElementById('current-timezone');

tzDisplay.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown";

infoBtn.addEventListener('click', () => infoModal.style.display = 'block');
closeInfoBtn.addEventListener('click', () => infoModal.style.display = 'none');

function closeInfoOutside(e) {
    if (infoModal.style.display === 'block' && 
        !infoModal.contains(e.target) && 
        !infoBtn.contains(e.target)) {
        infoModal.style.display = 'none';
    }
}
window.addEventListener('mousedown', closeInfoOutside);
window.addEventListener('touchstart', closeInfoOutside);

// State
let userLat = null;
let userLon = null;
let sunPath = [];
let currentHeading = 0; // 0 = North
let currentPitch = 0;   // 0 = Horizon
let currentRoll = 0;    // 0 = Level
let hasRealOrientation = false;

// Constants (now dynamic via settings sliders)
let CAMERA_LONG_EDGE_FOV = 65; 
let COMPASS_OFFSET = 0;

// Expose transformation matrix for 3D projection
let currentMatrix = null;
 

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Default to today
const today = new Date().toISOString().split('T')[0];
datePicker.value = today;
datePicker.addEventListener('change', () => {
    if (userLat && userLon) {
        fetchSunPath(datePicker.value);
    }
});

// Calibration Bindings
const fovSlider = document.getElementById('fov-slider');
const fovDisplay = document.getElementById('fov-display');
fovSlider.addEventListener('input', (e) => {
    CAMERA_LONG_EDGE_FOV = parseFloat(e.target.value);
    fovDisplay.textContent = e.target.value;
});

const compassSlider = document.getElementById('compass-slider');
const compassDisplay = document.getElementById('compass-display');
compassSlider.addEventListener('input', (e) => {
    COMPASS_OFFSET = parseFloat(e.target.value);
    compassDisplay.textContent = e.target.value;
});

function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.style.display = 'block';
    console.error(msg);
}

function setStatus(msg, type = 'active') {
    statusMsg.textContent = msg;
    statusIndicator.className = 'dot ' + type;
}

startBtn.addEventListener('click', async () => {
    try {
        // Request Device Orientation (iOS 13+ requirement)
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission !== 'granted') {
                throw new Error("Device orientation permission denied.");
            }
        }

        setStatus("Accessing camera...");
        
        // Start Camera
        const constraints = {
            video: { facingMode: "environment" }
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;

        // Transition UI
        setupScreen.style.display = 'none';
        arContainer.style.display = 'block';

        // Get Location
        setStatus("Finding location...");
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                userLat = pos.coords.latitude;
                userLon = pos.coords.longitude;
                setStatus("Fetching solar data...");
                fetchSunPath(datePicker.value);

                // Start Orientation tracking
                if ('ondeviceorientationabsolute' in window) {
                    window.addEventListener('deviceorientationabsolute', handleOrientation);
                } else {
                    window.addEventListener('deviceorientation', handleOrientation);
                }
                
                // Start Render Loop
                requestAnimationFrame(renderLoop);
            },
            (err) => {
                setStatus("Location error.", "error");
                showError("Location access required: " + err.message);
            }
        );

    } catch (err) {
        showError(err.message);
    }
});

function fetchSunPath(dateStr) {
    try {
        let path = [];
        let targetDate;
        
        if (dateStr) {
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                targetDate = new Date(parts[0], parseInt(parts[1]) - 1, parts[2], 0, 0, 0);
            } else {
                targetDate = new Date();
                targetDate.setHours(0, 0, 0, 0);
            }
        } else {
            targetDate = new Date();
            targetDate.setHours(0, 0, 0, 0);
        }

        // Loop for 24 hours, every 20 minutes
        for (let i = 0; i <= 24 * 60; i += 20) {
            let currentDt = new Date(targetDate.getTime() + i * 60000);
            
            let sunPos = SunCalc.getPosition(currentDt, userLat, userLon);
            
            // Convert SunCalc azimuth (0 is South, Math.PI/2 is West) to compass heading (0 is North)
            let azimuthDegrees = (sunPos.azimuth * 180 / Math.PI) + 180;
            if (azimuthDegrees >= 360) azimuthDegrees -= 360;
            
            let altitudeDegrees = sunPos.altitude * 180 / Math.PI;
            
            path.push({
                time: currentDt.toISOString(),
                azimuth: azimuthDegrees,
                altitude: altitudeDegrees
            });
        }
        
        sunPath = path;
        setStatus("Tracking Active", "active");
    } catch (e) {
        console.error(e);
        setStatus("Failed to calculate path", "error");
    }
}

function handleOrientation(event) {
    if (event.alpha === null && event.beta === null && !event.webkitCompassHeading) {
        return; // Empty event on desktop
    }
    hasRealOrientation = true;

    // Use W3C Rotation Matrix to avoid all Gimbal Locks and Euler singularity flips
    // Convert to radians
    const alpha = event.alpha ? event.alpha * Math.PI / 180 : 0;
    const beta = event.beta ? event.beta * Math.PI / 180 : 0;
    const gamma = event.gamma ? event.gamma * Math.PI / 180 : 0;

    const cX = Math.cos(beta);
    const cY = Math.cos(gamma);
    const cZ = Math.cos(alpha);
    const sX = Math.sin(beta);
    const sY = Math.sin(gamma);
    const sZ = Math.sin(alpha);

    // We calculate where the BACK of the phone (-Z axis) is pointing in 3D space.
    // This is mathematically immune to the beta=90° gimbal lock glitch!
    const v_cam_x = - (cZ * sY + cY * sZ * sX);
    const v_cam_y = - (sZ * sY - cZ * cY * sX);
    const v_cam_z = - (cX * cY);
    
    // Save rotation matrix for rendering perfectly mapped 3D points
    currentMatrix = [
        cZ * cY - sZ * sX * sY,  -cX * sZ,  cY * sZ * sX + cZ * sY,
        cY * sZ + cZ * sX * sY,  cZ * cX,   sZ * sY - cZ * cY * sX,
        -cX * sY,                 sX,       cX * cY
    ];

    // Prevent floating point errors from exceeding [-1, 1] for asin
    const clean_vz = Math.max(-1, Math.min(1, v_cam_z));
    
    // Pitch (Altitude)
    let pitch = (Math.asin(clean_vz) * 180 / Math.PI);

    // Roll (Leveling with Horizon)
    // Local Y axis is the top of the phone. We find its X/Y world orientation to compute roll.
    const gx = cX * sY; 
    const gy = sX;
    // Calculate how much the horizon is tilted on the screen
    let roll = Math.atan2(gy, gx) - Math.PI/2;

    // Heading (Azimuth)
    let heading = 0;
    if (event.webkitCompassHeading) {
        // iOS provides an absolute compass heading
        // We use it directly because iOS alpha is arbitrary (relative)
        heading = event.webkitCompassHeading;
    } else {
        // Android provides absolute alpha, so our Matrix gives true absolute Azimuth
        // Math.atan2(East, North)
        let matrixHeading = Math.atan2(v_cam_x, v_cam_y) * 180 / Math.PI;
        if (matrixHeading < 0) matrixHeading += 360;
        heading = matrixHeading;
    }

    currentHeading = heading;
    currentPitch = pitch;
    currentRoll = roll;
}

// Shortest distance between two angles (0-360)
function angleDifference(a, b) {
    let diff = a - b;
    while (diff < -180) diff += 360;
    while (diff > 180) diff -= 360;
    return diff;
}

function renderLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (sunPath.length > 0 && currentMatrix) {
        
        // Use true 3D Rectilinear (Gnomonic) Projection for exact physical lens matching
        const maxDimension = Math.max(canvas.width, canvas.height);
        const fovRad = CAMERA_LONG_EDGE_FOV * Math.PI / 180;
        const focalLength = (maxDimension / 2) / Math.tan(fovRad / 2);

        ctx.save();
        
        // Translate to the center of vision, apply screen roll
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(currentRoll);

        // Project a sun position helper
        const project3D = (point) => {
            const altRad = point.altitude * Math.PI / 180;
            // Apply arbitrary compass offset from user Settings to correct uncalibrated magnetic sensors
            const aziRad = (point.azimuth + COMPASS_OFFSET) * Math.PI / 180;
            
            // World unit vector 
            const wx = Math.cos(altRad) * Math.sin(aziRad);  // East
            const wy = Math.cos(altRad) * Math.cos(aziRad);  // North
            const wz = Math.sin(altRad);                     // Up
            
            // Multiply World Vector by INVERSE Rotation Matrix (M^T) to get Camera Local Vector
            const m = currentMatrix;
            const lx = m[0] * wx + m[3] * wy + m[6] * wz;
            const ly = m[1] * wx + m[4] * wy + m[7] * wz;
            const lz = m[2] * wx + m[5] * wy + m[8] * wz;
            
            if (lz >= 0) return null; // Behind camera
            
            // Map to Screen projection coordinates
            return {
                x: (lx / -lz) * focalLength,
                y: -(ly / -lz) * focalLength  // Screen Y is inverse of mathematical Y
            };
        };

        // Draw Sun Path line using pure 3D projection
        ctx.beginPath();
        let pathStarted = false;
        
        for (let i = 0; i < sunPath.length; i++) {
            const pt = project3D(sunPath[i]);
            
            if (pt) {
                if (!pathStarted) {
                    ctx.moveTo(pt.x, pt.y);
                    pathStarted = true;
                } else {
                    ctx.lineTo(pt.x, pt.y);
                }
            } else {
                pathStarted = false; // Lift pen if segment goes behind camera
            }
        }
        // --- BRIGHTER BOLD SUN PATH ---
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        // Glow effect
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#FDE047'; 
        
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)'; // Inner path
        ctx.stroke();

        ctx.shadowBlur = 5;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255, 255, 255, 1)'; // Bright core
        ctx.stroke();
        
        ctx.shadowBlur = 0; // Reset

        // Find Current Sun Position (closest time to now)
        const now = new Date();
        let closestPoint = sunPath[0];
        let minDiff = Infinity;
        for (let point of sunPath) {
            const diff = Math.abs(new Date(point.time) - now);
            if (diff < minDiff) {
                minDiff = diff;
                closestPoint = point;
            }
        }

        // Draw the Sun ☀️ if visible
        const sunPos = project3D(closestPoint);
        if (sunPos) {
            const radGrad = ctx.createRadialGradient(sunPos.x, sunPos.y, 0, sunPos.x, sunPos.y, 40);
            radGrad.addColorStop(0, 'rgba(255, 255, 255, 1)'); // White hot central core
            radGrad.addColorStop(0.3, 'rgba(253, 224, 71, 1)');  // Bright yellow
            radGrad.addColorStop(0.7, 'rgba(245, 158, 11, 0.8)'); // Soft orange glow
            radGrad.addColorStop(1, 'rgba(217, 119, 6, 0)');     // Transparent edge

            ctx.beginPath();
            ctx.arc(sunPos.x, sunPos.y, 40, 0, 2 * Math.PI);
            ctx.fillStyle = radGrad;
            ctx.shadowBlur = 60;
            ctx.shadowColor = '#FBBF24'; // Ambient yellow halo
            ctx.fill();
            ctx.shadowBlur = 0; // reset
        }

        // Draw Horizon (0° Altitude "Equator")
        // To draw the horizon properly, we project a line using the pitch directly instead of 3D lines
        // because the horizon is technically a curve on a rectlinear projection.
        // For visual leveling, horizontal offset is roughly -pitch * focalLength
        let horizonY = -Math.tan(currentPitch * Math.PI / 180) * focalLength;
        
        ctx.beginPath();
        const maxSize = Math.max(canvas.width, canvas.height);
        // Extend line far beyond screen bounds to ensure it spans the whole screen when rotated
        ctx.moveTo(-maxSize, horizonY);
        ctx.lineTo(canvas.width + maxSize, horizonY);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.7)'; // Emerald green 
        ctx.stroke();

        // Label the Horizon
        ctx.fillStyle = 'rgba(16, 185, 129, 0.9)';
        ctx.font = '700 13px Outfit, sans-serif';
        ctx.textAlign = 'left';
        ctx.shadowBlur = 4;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        // Draw label closer to center horizontally so it stays visible when rotated
        ctx.fillText('HORIZON', -40, horizonY - 8);
        ctx.shadowBlur = 0; // reset

        // Draw Compass Marks on Equator
        const compassMarks = [
            { azi: 0, label: 'N' },
            { azi: 45, label: 'NE' },
            { azi: 90, label: 'E' },
            { azi: 135, label: 'SE' },
            { azi: 180, label: 'S' },
            { azi: 225, label: 'SW' },
            { azi: 270, label: 'W' },
            { azi: 315, label: 'NW' }
        ];

        ctx.fillStyle = 'rgba(16, 185, 129, 0.9)';
        ctx.font = '600 14px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.8)';
        ctx.lineWidth = 2;
        ctx.shadowBlur = 4;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';

        for (let mark of compassMarks) {
            const pt = project3D({ altitude: 0, azimuth: mark.azi });
            if (pt) {
                // Draw a tick mark slightly crossing the horizon
                ctx.beginPath();
                ctx.moveTo(pt.x, pt.y - 6);
                ctx.lineTo(pt.x, pt.y + 6);
                ctx.stroke();
                
                // Draw the label
                ctx.fillText(mark.label, pt.x, pt.y - 12);
            }
        }
        ctx.shadowBlur = 0;

        // Update Text
        elevDisplay.textContent = Math.round(currentPitch) + '°';
        azimDisplay.textContent = Math.round(currentHeading) + '°';
        
        ctx.restore();
    }

    requestAnimationFrame(renderLoop);
}

// ----------------------------------------------------
// Mouse/Touch Panning (for testing on desktop)
// ----------------------------------------------------
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

arContainer.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
});
window.addEventListener('mouseup', () => isDragging = false);
window.addEventListener('mousemove', (e) => {
    if (isDragging && !hasRealOrientation) {
        const deltaX = e.clientX - lastMouseX;
        const deltaY = e.clientY - lastMouseY;
        
        // Pan heading (horizontal drag)
        currentHeading -= deltaX * 0.2; // roughly scale delta to degrees
        if (currentHeading < 0) currentHeading += 360;
        if (currentHeading >= 360) currentHeading -= 360;
        
        // Pan pitch (vertical drag)
        currentPitch += deltaY * 0.2;
        
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }
});

// Touch support for desktop testing simulators
arContainer.addEventListener('touchstart', (e) => {
    isDragging = true;
    lastMouseX = e.touches[0].clientX;
    lastMouseY = e.touches[0].clientY;
});
window.addEventListener('touchend', () => isDragging = false);
window.addEventListener('touchmove', (e) => {
    if (isDragging && !hasRealOrientation) {
        const deltaX = e.touches[0].clientX - lastMouseX;
        const deltaY = e.touches[0].clientY - lastMouseY;
        
        currentHeading -= deltaX * 0.2;
        if (currentHeading < 0) currentHeading += 360;
        if (currentHeading >= 360) currentHeading -= 360;
        
        currentPitch += deltaY * 0.2;
        
        lastMouseX = e.touches[0].clientX;
        lastMouseY = e.touches[0].clientY;
    }
});
