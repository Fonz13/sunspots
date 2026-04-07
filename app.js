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
let hasRealOrientation = false;

// Constants
const FOV = 60; // Approximate horizontal Field of View in degrees

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

    // Prevent floating point errors from exceeding [-1, 1] for asin
    const clean_vz = Math.max(-1, Math.min(1, v_cam_z));
    
    // Pitch (Altitude) 
    let pitch = Math.asin(clean_vz) * 180 / Math.PI;

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

    if (sunPath.length > 0) {
        const pixelsPerDegreeX = canvas.width / FOV;
        // Assume portrait orientation, FOV scaling for height based on aspect ratio
        const pixelsPerDegreeY = pixelsPerDegreeX;

        // Draw Sun Path line
        ctx.beginPath();
        for (let i = 0; i < sunPath.length; i++) {
            const point = sunPath[i];
            
            // Difference from center of screen
            let aziDiff = angleDifference(point.azimuth, currentHeading);
            let altDiff = point.altitude - currentPitch;
            
            const x = canvas.width / 2 + (aziDiff * pixelsPerDegreeX);
            const y = canvas.height / 2 - (altDiff * pixelsPerDegreeY);

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                let prevAziDiff = angleDifference(sunPath[i-1].azimuth, currentHeading);
                if (Math.abs(aziDiff - prevAziDiff) > 180) {
                    ctx.moveTo(x, y); // Prevent drawing a line all the way across the screen when it wraps
                } else {
                    ctx.lineTo(x, y);
                }
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

        // --- DRAW HOUR MARKS ---
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = '12px Outfit, sans-serif';
        ctx.textAlign = 'center';
        
        for (let i = 0; i < sunPath.length - 1; i++) {
            const d1 = new Date(sunPath[i].time);
            const d2 = new Date(sunPath[i+1].time);
            
            // Check if we crossed into a new local hour
            if (d1.getHours() !== d2.getHours()) {
                const targetHour = d2.getHours();
                
                // Construct Date exactly at the hour
                const dTarget = new Date(d2);
                dTarget.setMinutes(0, 0, 0);
                
                // Linear interpolation ratio between the two 20-minute points
                // Safely clamped just in case
                const diffTime = d2.getTime() - d1.getTime();
                const ratio = diffTime > 0 ? (dTarget.getTime() - d1.getTime()) / diffTime : 0;
                
                let azi1 = sunPath[i].azimuth;
                let azi2 = sunPath[i+1].azimuth;
                let aDiff = azi2 - azi1;
                if (aDiff > 180) aDiff -= 360;
                else if (aDiff < -180) aDiff += 360;
                
                let targetAzi = azi1 + aDiff * ratio;
                let targetAlt = sunPath[i].altitude + (sunPath[i+1].altitude - sunPath[i].altitude) * ratio;
                
                let renderAziDiff = angleDifference(targetAzi, currentHeading);
                let renderAltDiff = targetAlt - currentPitch;
                
                const hx = canvas.width / 2 + (renderAziDiff * pixelsPerDegreeX);
                const hy = canvas.height / 2 - (renderAltDiff * pixelsPerDegreeY);
                
                // Draw dot and time
                ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
                ctx.shadowBlur = 4;
                ctx.fillStyle = 'rgba(255, 255, 255, 1)';

                ctx.beginPath();
                ctx.arc(hx, hy, 5, 0, 2*Math.PI);
                ctx.fill();
                
                const ampm = targetHour >= 12 ? 'PM' : 'AM';
                const dispHour = targetHour % 12 || 12;
                ctx.fillText(`${dispHour} ${ampm}`, hx, hy - 14);
                
                ctx.shadowBlur = 0; // Reset
            }
        }

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

        // Draw the Sun ☀️
        let aziDiff = angleDifference(closestPoint.azimuth, currentHeading);
        let altDiff = closestPoint.altitude - currentPitch;
        
        const sunX = canvas.width / 2 + (aziDiff * pixelsPerDegreeX);
        const sunY = canvas.height / 2 - (altDiff * pixelsPerDegreeY);

        const radGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 40);
        radGrad.addColorStop(0, 'rgba(255, 255, 255, 1)'); // White hot central core
        radGrad.addColorStop(0.3, 'rgba(253, 224, 71, 1)');  // Bright yellow
        radGrad.addColorStop(0.7, 'rgba(245, 158, 11, 0.8)'); // Soft orange glow
        radGrad.addColorStop(1, 'rgba(217, 119, 6, 0)');     // Transparent edge

        ctx.beginPath();
        ctx.arc(sunX, sunY, 40, 0, 2 * Math.PI);
        ctx.fillStyle = radGrad;
        ctx.shadowBlur = 60;
        ctx.shadowColor = '#FBBF24'; // Ambient yellow halo
        ctx.fill();
        ctx.shadowBlur = 0; // reset

        // Draw Horizon (0° Altitude "Equator")
        let horizonY = canvas.height / 2 - (0 - currentPitch) * pixelsPerDegreeY;
        
        ctx.beginPath();
        ctx.moveTo(0, horizonY);
        ctx.lineTo(canvas.width, horizonY);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.7)'; // Emerald green 
        ctx.stroke();

        // Label the Horizon
        ctx.fillStyle = 'rgba(16, 185, 129, 0.9)';
        ctx.font = '700 13px Outfit, sans-serif';
        ctx.textAlign = 'left';
        ctx.shadowBlur = 4;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.fillText('HORIZON (0°)', 15, horizonY - 8);
        ctx.shadowBlur = 0; // reset

        // Update Text
        elevDisplay.textContent = Math.round(currentPitch) + '°';
        azimDisplay.textContent = Math.round(currentHeading) + '°';
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
