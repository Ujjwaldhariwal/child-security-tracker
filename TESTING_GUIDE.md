# 2-Phone Testing Guide (Family Safety Architecture v2)

This guide walks you through testing the ultra-low-power, zero-cost periodic location tracker between your **two Android phones** and verifies the production enhancements (offline batching, rate limiting, strict validation, OEM survivability, and historical scrubber).

---

## 🛠️ Prerequisites & Setup Overview

* **Child Phone:** Android 8.0+ (API 26+)
* **Parent Phone:** Any smartphone with a web browser (Chrome/Firefox/Safari)
* **Relay Server:** Your computer running `node backend/server.js` (or any free hosting)

---

## Step 1: Start the Relay Server

On your laptop or computer:

```bash
cd backend
npm install
npm test      # Verify all 14 integration tests pass
npm start     # Starts relay server on port 5050
```

The server will print:
```
====================================================
 Family Safety Relay Backend is RUNNING
 Listening on: http://0.0.0.0:5050
 Parent Dashboard: http://localhost:5050
 Rate Limiting: 60 req/min per IP active
 Validation: Strict numeric finite & bounds active
====================================================
```

### Find Your Computer's Local IP Address
On macOS / Linux:
```bash
ipconfig getifaddr en0   # Wi-Fi IP (e.g., 192.168.1.105)
```
*Note this IP (e.g. `http://192.168.1.105:5050`). Both phones should be connected to the same Wi-Fi router (or phone hotspot).*

---

## Step 2: Configure the Child Phone

### A. Build or Install the APK
Open the `android-child-app` directory in Android Studio, or build using Gradle:
```bash
cd android-child-app
./gradlew assembleDebug
```
The APK is generated at:
`android-child-app/app/build/outputs/apk/debug/app-debug.apk`

Transfer and install the APK onto the child phone via USB or `adb`:
```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### B. Launch & Grant Critical Permissions
Open the **Family Companion** app on the child phone:

1. **Foreground Location:** Tap **"Grant Permissions"** and select **"While using the app"**.
2. **Background Location ("Allow all the time"):** 
   - A dialog will appear explaining that periodic updates need background location.
   - Tap **"Open Settings"** > **Permissions** > **Location** > Select **"Allow all the time"**.
3. **Battery Optimization (AOSP Doze Mode Exemption):**
   - Tap **"Exempt Now"** when prompted, and allow the app to run without battery restrictions.
4. **OEM Background Killer Protection (Samsung / Xiaomi / Oppo):**
   - Tap **"OEM Background Protection Wizard"** (or view automatic prompt).
   - If using Samsung, Xiaomi, Oppo, Realme, or Vivo, follow the brand-specific guidance to enable Autostart and set Battery Saver to "No restrictions" / "Never sleeping apps".
5. **Direct Boot Awareness:**
   - The app's `BootReceiver` is configured with `android:directBootAware="true"`. If the child's phone reboots overnight before the lock screen PIN is entered, WorkManager automatically reschedules tracking.

### C. Connect to Relay Server
In the app configuration fields:
* **Relay Server URL:** `http://192.168.1.105:5050` *(Replace with your computer's IP)*
* **Device ID:** `child_phone_01`
* **Secret Token:** `family_secret_token_123`
* **Sync Frequency:** Select **Every 30 Minutes** or **Every 60 Minutes**
* Tap **"Save & Schedule Worker"**.

### D. Verify Instant Connectivity
Tap **"Test Sync Now"**. Check your terminal running the relay server — you will immediately see:
```
[HTTP] POST /api/location -> 201 (Xms)
```

---

## Step 3: Configure the Parent Phone (Viewer)

On the **Parent Phone**:

1. Open Google Chrome.
2. Navigate to: `http://192.168.1.105:5050` *(Your computer's IP)*
3. You will see the **Family Safety Live Map Dashboard**:
   * **Live Location Pin:** Showing the child's exact location on OpenStreetMap.
   * **Fresh vs Buffered Pill:** Displays `📡 Live GPS Fix`, `📦 Offline Buffered`, or `🕒 Cached Fix (Stale)`.
   * **Coarse Location Warning Banner:** Appears automatically if GPS accuracy exceeds 100 meters (warning parents of approximate cell tower triangulation).
   * **Interactive Waypoint Markers:** Click any dot on the trail to inspect recorded timestamp, battery %, accuracy radius, and fix source.
   * **History Scrubber / Time-Range Filter:** Filter route breadcrumbs by **"Past 2 Hours"**, **"Past 24 Hours"**, or **"All Time"**.
   * **Battery Percentage & Charging Status:** Monitored with live charging indicator.
4. **Make it an App (PWA):**
   * In Chrome on the parent phone, tap the 3 dots (⋮) > **"Add to Home screen"**.
   * An app icon is created on your home screen. It launches in standalone full-screen mode like a native app.

---

## Step 4: Verification & Stress Testing

### 1. Test Offline Reconnect Batch Upload
Simulate a child entering the subway without signal, accumulating coordinates, and re-connecting:
```bash
node simulator.js --batch
```
- The batch payload is ingested atomically via `POST /api/location/batch`.
- In the Parent Dashboard, switch the History Scrubber to **"Past 2 Hours"** and click on the new waypoints to observe the `📦 Offline Buffered` badge!

### 2. Test Coarse Accuracy Banner
Run the continuous simulator:
```bash
node simulator.js
```
Every 7th step simulates a cellular-only fix (±150m-200m). Notice the amber **Coarse Location Warning Banner** appears on the dashboard with the exact error margin.

### 3. Test Security Middleware
Attempt sending invalid requests to the relay backend:
```bash
# Query param token rejection (Returns 401)
curl -X POST "http://localhost:5050/api/location?token=family_secret_token_123" \
  -H "Content-Type: application/json" \
  -d '{"latitude": 28.61, "longitude": 77.20}'

# Out-of-bounds latitude rejection (Returns 400)
curl -X POST "http://localhost:5050/api/location" \
  -H "Content-Type: application/json" \
  -H "X-Device-Token: family_secret_token_123" \
  -d '{"latitude": 105.0, "longitude": 77.20}'
```
All malicious or out-of-bounds inputs are blocked.

### 4. Run Automated QA Test Suites
The project includes 52 automated tests covering geographic boundaries, adversarial input fuzzing, high concurrency (50 simultaneous requests), and time-range monotonicity:

```bash
cd backend

# Run baseline functional API suite (14 tests)
npm test

# Run stress, boundary, malicious input, and concurrency suite (38 tests)
npm run test:stress

# Run all 52 tests back-to-back
npm run test:all
```

For full test results and certification analysis, inspect [docs/TEST_REPORT_V2.md](docs/TEST_REPORT_V2.md).
