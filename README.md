# Family Safety Periodic Location Tracker (POC)

A minimal, ultra-lightweight, zero-cost proof of concept (POC) for periodic location updates (every 30 to 60 minutes) between Android phones.

---

## 🏗️ Architecture Overview

```
+-------------------------------------------------------------+
|                  Child Android Phone                        |
|                                                             |
|  - Jetpack WorkManager (PeriodicWorkRequest: 30 / 60 mins)  |
|  - FusedLocationProviderClient (Single 2-sec GPS fix)       |
|  - BatteryManager (Reads level & charging state)            |
|  - OkHttp Client (Sends payload to Relay Backend)           |
|  - BootReceiver (Reschedules worker upon phone reboot)      |
+------------------------------+------------------------------+
                               |
                   HTTP POST /api/location
                 (Authenticated via Token)
                               |
                               v
+-------------------------------------------------------------+
|                     Relay Backend                           |
|                                                             |
|  - Node.js + Express.js (Zero cloud cost, runs locally)     |
|  - Persistent Atomic Storage (data/locations.json)          |
|  - Optional: Telegram Bot API push alert integration        |
+------------------------------+------------------------------+
                               |
                   HTTP GET /api/location/latest
                               |
                               v
+-------------------------------------------------------------+
|                  Parent Android Phone                       |
|                                                             |
|  - Mobile Web Dashboard / PWA (Open in Chrome)              |
|  - Leaflet.js + OpenStreetMap (100% Free, no API keys)      |
|  - Live coordinate marker with meter accuracy circle        |
|  - Battery indicator & relative timestamp ("12 mins ago")   |
|  - Movement breadcrumb trail                                |
+-------------------------------------------------------------+
```

---

## 🚀 Sprint Iterations Completed

* **Sprint 1 — Android Companion Engine:**
  - Modern Kotlin project configured with Gradle KTX.
  - WorkManager `LocationSyncWorker` with battery-efficient single-shot location provider.
  - Runtime permission wizard for Foreground Location, Background Location ("Allow all the time"), and Android Doze Battery Exemption.
  - `BootReceiver` for persistence after phone reboot.

* **Sprint 2 — Zero-Cost Backend Relay:**
  - Express.js API listening on port 5050.
  - `X-Device-Token` authentication.
  - Atomic JSON database store with zero native dependencies.
  - Automated integration test suite (`backend/test_server.js`).

* **Sprint 3 — Parent Mobile Viewer:**
  - Mobile-responsive dashboard with Leaflet & OpenStreetMap.
  - Live GPS pin, accuracy circle, battery gauge, and historical movement breadcrumb trail.
  - Installable as a Progressive Web App (PWA) on the parent phone.

* **Sprint 4 — Simulation & Verification:**
  - Real-world route simulator (`simulator.js`) for testing without walking outside.
  - Comprehensive 2-phone testing guide (`TESTING_GUIDE.md`).

---

## 🏃 Quick Start

### 1. Run the Relay Backend
```bash
cd backend
npm install
node server.js
```
The server will start on `http://0.0.0.0:5050`.

### 2. (Optional) Run the Movement Simulator
In another terminal, simulate a moving child device:
```bash
node simulator.js
```
Open `http://localhost:5050` in your browser to watch the live movement trail in real-time.

### 3. Test on Two Real Android Phones
Follow the detailed steps in [TESTING_GUIDE.md](file:///Users/ujjwaldhariwal/.gemini/antigravity/scratch/child-security-poc/TESTING_GUIDE.md).

---

## 📁 Repository Structure

```
child-security-poc/
├── README.md                      # System documentation & quickstart
├── TESTING_GUIDE.md               # 2-phone physical testing guide
├── simulator.js                   # GPS & battery route movement simulator
├── backend/                       # Lightweight zero-cost relay service
│   ├── server.js                  # Express REST API endpoints
│   ├── db.js                      # Atomic persistence engine
│   ├── telegram.js                # Optional Telegram bot notification relay
│   ├── test_server.js             # Automated API integration tests
│   └── public/                    # Parent mobile map dashboard
│       ├── index.html             # Responsive viewer markup
│       ├── app.js                 # Leaflet map logic & polling
│       └── style.css              # Mobile-first stylesheet
└── android-child-app/             # Child Android companion project
    ├── build.gradle.kts
    ├── settings.gradle.kts
    ├── gradle.properties
    └── app/
        ├── build.gradle.kts
        ├── src/main/
        │   ├── AndroidManifest.xml
        │   ├── java/com/familysafety/tracker/
        │   │   ├── model/LocationData.kt
        │   │   ├── network/ApiClient.kt
        │   │   ├── receiver/BootReceiver.kt
        │   │   ├── ui/MainActivity.kt
        │   │   ├── util/WorkSchedulerHelper.kt
        │   │   └── worker/LocationSyncWorker.kt
        │   └── res/
        │       ├── layout/activity_main.xml
        │       └── values/strings.xml, colors.xml, themes.xml
```
