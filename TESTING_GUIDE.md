# 2-Phone Testing Guide (Family Safety POC)

This guide walks you through testing the lightweight, zero-cost periodic location tracker between your **two Android phones**.

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
node server.js
```

The server will print:
```
====================================================
 Family Safety Relay Backend is RUNNING
 Listening on: http://0.0.0.0:5050
 Default Auth Token: family_secret_token_123
 Parent Dashboard: http://localhost:5050
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

1. **Foreground Location:** Tap **"Configure Permissions"** and select **"While using the app"**.
2. **Background Location ("Allow all the time"):** 
   - A dialog will appear explaining that periodic updates need background location.
   - Tap **"Open Settings"** > **Permissions** > **Location** > Select **"Allow all the time"**.
3. **Battery Optimization (Prevent Doze Mode Sleep):**
   - Tap **"Exempt Now"** when prompted, and allow the app to run without battery restrictions.
   - *(Alternatively in phone settings: Settings > Apps > Family Companion > Battery > Select "Unrestricted")*.

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
   * **GPS Accuracy Circle:** Displays meter precision.
   * **Battery Percentage & Charging Status:** Monitored in real-time.
   * **Last Updated Indicator:** e.g., "Updated 2 minutes ago".
   * **Historical Movement Trail:** Check "Show Movement Trail" to see breadcrumbs.
4. **Make it an App (PWA):**
   * In Chrome on the parent phone, tap the 3 dots (⋮) > **"Add to Home screen"**.
   * It will appear as an app icon on the parent phone's home screen.

---

## Step 4: Standby & Doze Mode Verification

To verify that the background tracker survives Android battery saver and sleep modes:

1. Lock the child phone and leave it unplugged on a table.
2. Wait 30–60 minutes.
3. Check the parent dashboard or server log:
   * The Android `WorkManager` will wake up, lock GPS for 2–3 seconds, post the coordinate payload, and immediately power down the GPS, consuming virtually **0% extra battery**.

---

## 💡 Remote Testing (Without Shared Wi-Fi)

If the child phone is outside on 4G/5G mobile data and not connected to home Wi-Fi:
Use a free Cloudflare Tunnel or Tailscale to expose port 5050:
```bash
# Using Cloudflare Tunnel (completely free, no account needed):
npx untun@latest tunnel --port 5050
```
This generates a secure public HTTPS URL (e.g. `https://random-subdomain.trycloudflare.com`). Put that URL into the child app's "Relay Server URL" field!
