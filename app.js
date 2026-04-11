import * as SunCalc from './suncalc.js';

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

const arModeBtn = document.getElementById('ar-mode-btn');
const svModeBtn = document.getElementById('sv-mode-btn');
const searchContainer = document.getElementById('search-container');
const locationInput = document.getElementById('loc-search');
const svContainer = document.getElementById('street-view');
const searchHelpBtn = document.getElementById('search-help-btn');
const searchHelpModal = document.getElementById('search-help-modal');
const closeSearchHelpBtn = document.getElementById('close-search-help-btn');

tzDisplay.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown";

// Modal Management Logic
function closeAllModals() {
    infoModal.style.display = 'none';
    searchHelpModal.style.display = 'none';
}

function handleOutsideClick(e) {
    // Check Settings Modal
    if (infoModal.style.display === 'block' && 
        !infoModal.contains(e.target) && 
        !infoBtn.contains(e.target)) {
        infoModal.style.display = 'none';
    }
    // Check Search Help Modal
    if (searchHelpModal.style.display === 'block' && 
        !searchHelpModal.contains(e.target) && 
        !searchHelpBtn.contains(e.target)) {
        searchHelpModal.style.display = 'none';
    }
}

infoBtn.addEventListener('click', () => infoModal.style.display = 'block');
closeInfoBtn.addEventListener('click', () => infoModal.style.display = 'none');

searchHelpBtn.addEventListener('click', () => searchHelpModal.style.display = 'block');
closeSearchHelpBtn.addEventListener('click', () => searchHelpModal.style.display = 'none');

window.addEventListener('mousedown', handleOutsideClick);
window.addEventListener('touchstart', handleOutsideClick);

// State
let userLat = null;
let userLon = null;
let sunPath = [];
let currentHeading = 0; // 0 = North
let currentPitch = 0;   // 0 = Horizon
let currentRoll = 0;    // 0 = Level
let hasRealOrientation = false;

let currentMode = 'ar'; // 'ar' or 'sv'
let panorama = null;
let autocomplete = null;

// Constants (now dynamic via settings sliders)
let CAMERA_LONG_EDGE_FOV = 65; 
let COMPASS_OFFSET = 0;

// Expose transformation matrix for 3D projection
let currentMatrix = null;
let currentMatrixHeading = 0;
 

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

const resetCalibrationBtn = document.getElementById('reset-calibration-btn');
if (resetCalibrationBtn) {
    resetCalibrationBtn.addEventListener('click', () => {
        CAMERA_LONG_EDGE_FOV = 65;
        fovSlider.value = 65;
        fovDisplay.textContent = '65';
        
        COMPASS_OFFSET = 0;
        compassSlider.value = 0;
        compassDisplay.textContent = '0';
    });
}

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

        initModeToggles();
        initSearch();

        // Get Location
        setStatus("Finding location...");
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                userLat = pos.coords.latitude;
                userLon = pos.coords.longitude;
                setStatus("Location found!");
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
        setStatus(currentMode === 'ar' ? "Tracking Active" : "Street View Mode", "active");
    } catch (e) {
        console.error(e);
        setStatus("Failed to calculate path", "error");
    }
}

function initModeToggles() {
    arModeBtn.addEventListener('click', () => setMode('ar'));
    svModeBtn.addEventListener('click', () => setMode('sv'));
}

async function setMode(mode) {
    if (currentMode === mode) return;

    if (mode === 'sv' && (!userLat || !userLon)) {
        setStatus("Waiting for location...", "loading");
        // Keep trying or just wait for the first geolocation success to trigger it
        return;
    }

    currentMode = mode;

    if (mode === 'ar') {
        arModeBtn.classList.add('active');
        svModeBtn.classList.remove('active');
        searchContainer.style.display = 'none';
        video.style.display = 'block';
        svContainer.style.display = 'none';
        setStatus("Tracking Active", "active");
    } else {
        svModeBtn.classList.add('active');
        arModeBtn.classList.remove('active');
        searchContainer.style.display = 'block';
        video.style.display = 'none';
        svContainer.style.display = 'block';
        
        if (!panorama) {
            initStreetView();
        }
        setStatus("Street View Mode", "active");
    }
}

function initStreetView() {
    panorama = new google.maps.StreetViewPanorama(svContainer, {
        position: { lat: userLat, lng: userLon },
        pov: { heading: currentHeading, pitch: currentPitch },
        zoom: 1,
        addressControl: false,
        showRoadLabels: false,
        zoomControl: false,
        panControl: false,
        fullscreenControl: false
    });

    panorama.addListener('pov_changed', () => {
        if (currentMode === 'sv') {
            const pov = panorama.getPov();
            currentHeading = pov.heading;
            currentPitch = pov.pitch;
            // Limit max FOV to 125 degrees to prevent the sun path from distorting/disappearing at zoom 0
            const rawFOV = 180 / Math.pow(2, panorama.getZoom());
            CAMERA_LONG_EDGE_FOV = Math.min(125, rawFOV);
            
            fovSlider.value = CAMERA_LONG_EDGE_FOV;
            fovDisplay.textContent = Math.round(CAMERA_LONG_EDGE_FOV);
        }
    });

    panorama.addListener('position_changed', () => {
        const pos = panorama.getPosition();
        userLat = pos.lat();
        userLon = pos.lng();
        fetchSunPath(datePicker.value);
    });
}

async function resolveCompoundCode(plusPart, cityPart) {
    try {
        setStatus(`Finding ${cityPart}...`, "loading");
        const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityPart)}&format=json&limit=1`);
        const data = await response.json();
        
        if (data && data.length > 0) {
            const cityLat = parseFloat(data[0].lat);
            const cityLon = parseFloat(data[0].lon);
            
            const fullCode = OpenLocationCode.recoverNearest(plusPart, cityLat, cityLon);
            if (OpenLocationCode.isFull(fullCode)) {
                const decoded = OpenLocationCode.decode(fullCode);
                updateToLocation(decoded.latitudeCenter, decoded.longitudeCenter);
                locationInput.value = `📍 ${fullCode}`;
                locationInput.blur();
                setStatus("Location Synchronized", "active");
            }
        } else {
            setStatus("Could not find city", "error");
        }
    } catch (e) {
        console.error("Compound Resolution Error:", e);
        setStatus("Network Error", "error");
    }
}
async function initSearch() {
    // 2. Listen for pasting Google Maps URLs or direct coordinates
    locationInput.addEventListener('input', () => {
        const val = locationInput.value.trim();
        if (!val) return;

        // 1. Check for Full URLs
        if (val.includes('google.com/maps') || val.includes('maps.app.goo.gl')) {
            const atRegex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
            const dataRegex = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/;
            let match = val.match(dataRegex) || val.match(atRegex);
            if (match) {
                const lat = parseFloat(match[1]);
                const lon = parseFloat(match[2]);
                if (!isNaN(lat) && !isNaN(lon)) {
                    updateToLocation(lat, lon);
                    locationInput.value = `Pos: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
                    locationInput.blur();
                    return;
                }
            }
            
            // If it's a short link, we unfortunately can't parse it in JS without an API/Backend
            if (val.includes('maps.app.goo.gl')) {
                setStatus("Short links require API Key", "loading");
            }
        } 
        // 2. Check for Plus Codes (e.g., 8FVC9G7F+9V, 82HG+M3, or P45J+M4 Glendale)
        else if (val.includes('+')) {
            const plusCodeRegex = /[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,8}/i;
            const match = val.match(plusCodeRegex);
            
            if (match && typeof OpenLocationCode !== 'undefined') {
                const code = match[0].toUpperCase();
                const remainder = val.replace(match[0], '').trim();

                // If there's a city/locality name after the code
                if (remainder && remainder.length > 2) {
                    resolveCompoundCode(code, remainder);
                } else {
                    try {
                        let fullCode = code;
                        // Local recovery using current location
                        if (OpenLocationCode.isShort(code)) {
                            if (userLat !== null && userLon !== null) {
                                fullCode = OpenLocationCode.recoverNearest(code, userLat, userLon);
                            } else {
                                setStatus("Need location to use short code", "loading");
                                return;
                            }
                        }

                        if (OpenLocationCode.isFull(fullCode)) {
                            const decoded = OpenLocationCode.decode(fullCode);
                            updateToLocation(decoded.latitudeCenter, decoded.longitudeCenter);
                            locationInput.value = `📍 ${fullCode}`;
                            locationInput.blur();
                        }
                    } catch (e) {
                        console.error("Plus Code Error:", e);
                    }
                }
            }
        }
        // 3. Check for Direct Coordinates (Lat, Lon)
        else {
            const coordRegex = /(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/;
            const match = val.match(coordRegex);
            if (match) {
                const lat = parseFloat(match[1]);
                const lon = parseFloat(match[2]);
                if (!isNaN(lat) && !isNaN(lon)) {
                    updateToLocation(lat, lon);
                    locationInput.value = `Pos: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
                    locationInput.blur();
                }
            }
        }
    });

    // Support for "Enter" key
    locationInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            locationInput.blur();
        }
    });
}

// Helper to update location and panorama
function updateToLocation(lat, lon) {
    userLat = lat;
    userLon = lon;
    if (panorama && currentMode === 'sv') {
        panorama.setPosition({ lat, lng: lon });
    }
    fetchSunPath(datePicker.value);
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
    
    // The rotation Matrix calculates an unaligned heading since iOS initializes `event.alpha` randomly
    let matrixHeading = Math.atan2(v_cam_x, v_cam_y) * 180 / Math.PI;
    if (matrixHeading < 0) matrixHeading += 360;
    currentMatrixHeading = matrixHeading;

    if (event.webkitCompassHeading) {
        // iOS provides an absolute compass heading
        // We use it directly because iOS alpha is arbitrary (relative)
        heading = event.webkitCompassHeading;
    } else {
        // Android provides absolute alpha, so our Matrix gives true absolute Azimuth
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

// Unified projection helper that handles both Matrix (AR) and Euler (SV)
function getProjectedPoint(point, focalLength, canvasWidth, canvasHeight) {
    const altRad = point.altitude * Math.PI / 180;
    
    if (currentMode === 'ar' && currentMatrix) {
        // Apply iOS arbitrary alpha alignment fix (locks the matrix to True North)
        const iosOffset = currentHeading - currentMatrixHeading;
        const aziRad = (point.azimuth + COMPASS_OFFSET - iosOffset) * Math.PI / 180;
        
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
        
        return {
            x: (lx / -lz) * focalLength,
            y: -(ly / -lz) * focalLength
        };
    } else if (currentMode === 'sv') {
        // For Street View, we use spherical-to-rectilinear projection directly from Euler angles
        let dHeading = angleDifference(point.azimuth + COMPASS_OFFSET, currentHeading);
        let dPitch = point.altitude - currentPitch;

        // Simple rectilinear projection for small/medium FOVs
        // For SV, we assume no roll
        const x = Math.tan(dHeading * Math.PI / 180) * focalLength;
        const y = -Math.tan(dPitch * Math.PI / 180) * focalLength;

        // Check if it's within a reasonable field of view (approx 90 deg) to avoid wrap-around glitched lines
        if (Math.abs(dHeading) > 90) return null;

        return { x, y };
    }
    return null;
}

function renderLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (sunPath.length > 0 && (currentMatrix || currentMode === 'sv')) {
        
        // Use true 3D Rectilinear (Gnomonic) Projection for exact physical lens matching
        const maxDimension = Math.max(canvas.width, canvas.height);
        const fovRad = CAMERA_LONG_EDGE_FOV * Math.PI / 180;
        const focalLength = (maxDimension / 2) / Math.tan(fovRad / 2);

        ctx.save();
        
        // Translate to the center of vision
        ctx.translate(canvas.width / 2, canvas.height / 2);
        // We no longer rotate the screen canvas itself, because the mathematics of 
        // the 3D Rotation Matrix intrinsically handles roll implicitly, preventing double rotations!

        // Project a sun position helper
        const project3D = (point) => {
            return getProjectedPoint(point, focalLength, canvas.width, canvas.height);
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
                const diffTime = d2.getTime() - d1.getTime();
                const ratio = diffTime > 0 ? (dTarget.getTime() - d1.getTime()) / diffTime : 0;
                
                let azi1 = sunPath[i].azimuth;
                let azi2 = sunPath[i+1].azimuth;
                let aDiff = azi2 - azi1;
                if (aDiff > 180) aDiff -= 360;
                else if (aDiff < -180) aDiff += 360;
                
                let targetAzi = azi1 + aDiff * ratio;
                let targetAlt = sunPath[i].altitude + (sunPath[i+1].altitude - sunPath[i].altitude) * ratio;
                
                const pt = project3D({ altitude: targetAlt, azimuth: targetAzi });
                
                if (pt) {
                    // Draw dot and time
                    ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
                    ctx.shadowBlur = 4;
                    ctx.fillStyle = 'rgba(255, 255, 255, 1)';

                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, 5, 0, 2*Math.PI);
                    ctx.fill();
                    
                    const ampm = targetHour >= 12 ? 'PM' : 'AM';
                    const dispHour = targetHour % 12 || 12;
                    ctx.fillText(`${dispHour} ${ampm}`, pt.x, pt.y - 14);
                    
                    ctx.shadowBlur = 0; // Reset
                }
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

        // Draw Curved True 3D Horizon (0° Altitude "Equator")
        // Since we are using a rectilinear camera lens model, the horizon must be drawn as a 3D geometry curve!
        ctx.beginPath();
        let horizonStarted = false;
        for (let a = 0; a <= 360; a += 5) {
            const pt = project3D({ altitude: 0, azimuth: a });
            if (pt) {
                if (!horizonStarted) {
                    ctx.moveTo(pt.x, pt.y);
                    horizonStarted = true;
                } else {
                    ctx.lineTo(pt.x, pt.y);
                }
            } else {
                horizonStarted = false; // Lift pen if segment goes behind camera
            }
        }
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.7)'; // Emerald green 
        ctx.stroke();

        // Label the Horizon exactly in front of the camera
        const frontPt = project3D({ altitude: 0, azimuth: currentHeading });
        if (frontPt) {
            ctx.fillStyle = 'rgba(16, 185, 129, 0.9)';
            ctx.font = '700 13px Outfit, sans-serif';
            ctx.textAlign = 'center';
            ctx.shadowBlur = 4;
            ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
            ctx.fillText('HORIZON', frontPt.x, frontPt.y - 8);
            ctx.shadowBlur = 0; // reset
        }

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
