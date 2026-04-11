# AR Sun Tracker ☀️

An advanced, high-performance web application designed to track the sun's trajectory across the sky using Augmented Reality (AR) and Google Street View. This project leverages mathematically precise 3D Gnomonic projection to map solar paths directly onto a camera feed or street-view panorama.

## 🚀 Key Features

- **Augmented Reality Tracking**: Real-time overlay of the sun's path on the device's camera feed using device orientation sensors.
- **Street View Integration**: Switch to Google Street View to visualize sun paths at any location globally.
- **Precision Projection**: Uses 3D Gnomonic projection for lens-accurate mapping, including horizon curvature and compass markers.
- **Location Intelligence**: 
  - Search by address or coordinates.
  - Support for **Plus Codes** (e.g., `83G4+QF Stockholm`).
  - Direct parsing of Google Maps URLs.
- **Advanced Calibration**: Interactive sliders for Field of View (FOV) and Compass Offset to compensate for hardware sensor variations.
- **Telemetry Display**: Real-time readout of sun elevation, azimuth, and local timezone.

## 🛠 Tech Stack

- **Frontend**: Vanilla HTML5, CSS3, and Modern JavaScript (ES6+).
- **Core Logic**: `SunCalc` for solar calculations, `OpenLocationCode` for Plus Code support.
- **APIs**: Google Maps JavaScript API (Places & Street View).
- **Styling**: Premium "Glassmorphism" UI with responsive design for mobile and desktop.
- **Sensors**: DeviceOrientation API (with iOS permission handling) and Geolocation API.

## 📂 Project Structure

- `index.html`: The main entry point and UI structure.
- `app.js`: Core application logic, orientation handling, and AR rendering loop.
- `style.css`: Modern, glassmorphic styling and layout.
- `suncalc.js`: Localized library for solar position calculations.
- `openlocationcode.js`: Library for Plus Code encoding/decoding.
- `LICENSE.txt`: MIT License.

## 🚦 Getting Started

1. **Local Development**:
   ```bash
   # Run a simple HTTP server
   python3 -m http.server 8000
   ```
2. **Accessing the App**:
   - Open `http://localhost:8000` in a mobile browser for the full AR experience.
   - For Street View, ensure a valid Google Maps API key is loaded (currently using a weekly script tag).

## 📐 Design Philosophy

The application prioritizes **Visual Excellence** and **Technical Accuracy**:
- **Rich Aesthetics**: Vibrant gradients, subtle micro-animations, and a sleek dark-mode glassmorphism interface.
- **Mathematical Integrity**: Decoupled AR and Street View logic to ensure stability across different projection models.
- **User-Centric**: Intuitive calibration controls to fix sensor "drift" without reloading.

---

> [!TIP]
> To get the best AR experience, hold the device vertically and wait for the "Initializing Sensors..." status to turn green (Tracking Active).

> [!IMPORTANT]
> iOS users must interact with the "Start AR Experience" button to grant permission for motion sensor access.
