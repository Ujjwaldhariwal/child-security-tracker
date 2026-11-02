package com.familysafety.tracker.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.familysafety.tracker.databinding.ActivityMainBinding
import com.familysafety.tracker.network.ApiClient
import com.familysafety.tracker.util.WorkSchedulerHelper
import com.familysafety.tracker.worker.LocationSyncWorker
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val KEY_OEM_PROMPTED = "has_prompted_oem_killer_warning"
    }

    private lateinit var binding: ActivityMainBinding

    private val requestLocationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val fineGranted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] ?: false
        val coarseGranted = permissions[Manifest.permission.ACCESS_COARSE_LOCATION] ?: false

        if (fineGranted || coarseGranted) {
            checkAndRequestBackgroundLocation()
        } else {
            Toast.makeText(this, "Location permission is required for family security.", Toast.LENGTH_LONG).show()
        }
        updatePermissionStatusUI()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        loadSavedSettings()
        setupListeners()
        updatePermissionStatusUI()
        updateSyncStatusUI()

        // Check for OEM background task killers (Samsung, Xiaomi, Oppo, etc.)
        checkManufacturerRestrictions(forceDialog = false)
    }

    override fun onResume() {
        super.onResume()
        updatePermissionStatusUI()
        updateSyncStatusUI()
    }

    private fun loadSavedSettings() {
        val prefs = getSharedPreferences(ApiClient.PREFS_NAME, Context.MODE_PRIVATE)
        binding.etServerUrl.setText(prefs.getString(ApiClient.KEY_SERVER_URL, ApiClient.DEFAULT_SERVER_URL))
        binding.etDeviceId.setText(prefs.getString(ApiClient.KEY_DEVICE_ID, ApiClient.DEFAULT_DEVICE_ID))
        binding.etAuthToken.setText(prefs.getString(ApiClient.KEY_AUTH_TOKEN, ApiClient.DEFAULT_AUTH_TOKEN))

        val interval = prefs.getInt(ApiClient.KEY_INTERVAL_MINS, ApiClient.DEFAULT_INTERVAL_MINS)
        if (interval == 60) {
            binding.rbInterval60.isChecked = true
        } else {
            binding.rbInterval30.isChecked = true
        }
    }

    private fun setupListeners() {
        binding.btnSave.setOnClickListener {
            val serverUrl = binding.etServerUrl.text.toString().trim()
            val deviceId = binding.etDeviceId.text.toString().trim()
            val authToken = binding.etAuthToken.text.toString().trim()
            val interval = if (binding.rbInterval60.isChecked) 60 else 30

            if (serverUrl.isBlank() || deviceId.isBlank() || authToken.isBlank()) {
                Toast.makeText(this, "All fields are required", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val prefs = getSharedPreferences(ApiClient.PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putString(ApiClient.KEY_SERVER_URL, serverUrl)
                .putString(ApiClient.KEY_DEVICE_ID, deviceId)
                .putString(ApiClient.KEY_AUTH_TOKEN, authToken)
                .putInt(ApiClient.KEY_INTERVAL_MINS, interval)
                .apply()

            WorkSchedulerHelper.schedulePeriodicSync(this, interval.toLong())
            Toast.makeText(this, "Settings saved. Sync scheduled every $interval mins.", Toast.LENGTH_LONG).show()
            updateSyncStatusUI()
        }

        binding.btnSyncNow.setOnClickListener {
            WorkSchedulerHelper.triggerImmediateSync(this)
            Toast.makeText(this, "Sync triggered! Check server or dashboard in a few seconds.", Toast.LENGTH_SHORT).show()
        }

        binding.btnFixPermissions.setOnClickListener {
            requestPermissionsWorkflow()
        }

        binding.btnOemSettings.setOnClickListener {
            checkManufacturerRestrictions(forceDialog = true)
        }
    }

    private fun requestPermissionsWorkflow() {
        val hasFine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!hasFine) {
            requestLocationPermissionLauncher.launch(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            )
            return
        }

        checkAndRequestBackgroundLocation()
    }

    private fun checkAndRequestBackgroundLocation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val hasBg = ContextCompat.checkSelfPermission(
                this, Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ) == PackageManager.PERMISSION_GRANTED

            if (!hasBg) {
                AlertDialog.Builder(this)
                    .setTitle("Background Location Access Required")
                    .setMessage("To receive periodic updates every 30-60 minutes when the phone is locked, select 'Allow all the time' in system settings.")
                    .setPositiveButton("Open Settings") { _, _ ->
                        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                            data = Uri.fromParts("package", packageName, null)
                        }
                        startActivity(intent)
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
                return
            }
        }

        checkBatteryOptimization()
    }

    @SuppressLint("BatteryLife")
    private fun checkBatteryOptimization() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
            AlertDialog.Builder(this)
                .setTitle("Battery Optimization Exemption")
                .setMessage("To prevent Android Doze mode from delaying periodic background updates, please exempt this companion app from battery restrictions.")
                .setPositiveButton("Exempt Now") { _, _ ->
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                    startActivity(intent)
                }
                .setNegativeButton("Later") { _, _ ->
                    checkManufacturerRestrictions(forceDialog = false)
                }
                .show()
        } else {
            Toast.makeText(this, "Standard AOSP battery optimization exempted.", Toast.LENGTH_SHORT).show()
            checkManufacturerRestrictions(forceDialog = false)
        }
    }

    /**
     * Inspects Build.MANUFACTURER and displays vendor-specific guidance dialog
     * for Samsung, Xiaomi, Oppo, Realme, Vivo, and Huawei aggressive task killing daemons.
     */
    private fun checkManufacturerRestrictions(forceDialog: Boolean = false) {
        val manufacturer = Build.MANUFACTURER.lowercase(Locale.ROOT)
        val isAggressiveOem = manufacturer.contains("samsung") ||
                manufacturer.contains("xiaomi") ||
                manufacturer.contains("redmi") ||
                manufacturer.contains("poco") ||
                manufacturer.contains("oppo") ||
                manufacturer.contains("realme") ||
                manufacturer.contains("vivo") ||
                manufacturer.contains("huawei") ||
                manufacturer.contains("honor")

        val prefs = getSharedPreferences(ApiClient.PREFS_NAME, Context.MODE_PRIVATE)
        val hasPrompted = prefs.getBoolean(KEY_OEM_PROMPTED, false)

        if (!forceDialog && (!isAggressiveOem || hasPrompted)) {
            return
        }

        val (brandTitle, guidanceMessage, dkmUrl) = when {
            manufacturer.contains("samsung") -> Triple(
                "Samsung One UI Battery Restrictions",
                "Samsung automatically places apps not opened in 3 days into 'Deep Sleep' and stops periodic WorkManager tracking.\n\n" +
                        "Recommended Actions:\n" +
                        "1. Open Settings > Battery > Background usage limits.\n" +
                        "2. Add 'Family Companion' to 'Never sleeping apps'.\n" +
                        "3. Disable 'Put unused apps to sleep'.",
                "https://dontkillmyapp.com/samsung"
            )
            manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco") -> Triple(
                "Xiaomi / HyperOS / MIUI Restrictions",
                "Xiaomi aggressively blocks background network tasks and disables boot autostart by default.\n\n" +
                        "Recommended Actions:\n" +
                        "1. Open Security app > Manage apps > Family Companion.\n" +
                        "2. Enable 'Autostart'.\n" +
                        "3. In Battery Saver, select 'No restrictions'.",
                "https://dontkillmyapp.com/xiaomi"
            )
            manufacturer.contains("oppo") || manufacturer.contains("realme") -> Triple(
                "Oppo / Realme (ColorOS) Restrictions",
                "ColorOS terminates background workers after 10-15 seconds of screen-off time.\n\n" +
                        "Recommended Actions:\n" +
                        "1. Open Settings > Battery > App Battery Management.\n" +
                        "2. Select Family Companion and enable 'Allow background activity' and 'Allow auto-startup'.",
                "https://dontkillmyapp.com/oppo"
            )
            manufacturer.contains("vivo") -> Triple(
                "Vivo (Funtouch OS) Restrictions",
                "Vivo iManager terminates background services unless whitelisted.\n\n" +
                        "Recommended Actions:\n" +
                        "1. Open Settings > Battery > High background power consumption.\n" +
                        "2. Turn ON the toggle for Family Companion.",
                "https://dontkillmyapp.com/vivo"
            )
            manufacturer.contains("huawei") || manufacturer.contains("honor") -> Triple(
                "Huawei / Honor PowerGenie Alert",
                "Huawei PowerGenie kills all background workers on screen lock.\n\n" +
                        "Recommended Actions:\n" +
                        "1. Open Settings > Battery > App Launch.\n" +
                        "2. Switch Family Companion from 'Manage automatically' to 'Manage manually'.\n" +
                        "3. Ensure Auto-launch, Secondary launch, and Run in background are all enabled.",
                "https://dontkillmyapp.com/huawei"
            )
            else -> Triple(
                "${Build.MANUFACTURER} Device Optimization",
                "Some device manufacturers restrict background periodic location tracking to save battery. Ensure this companion app has unrestricted background execution.",
                "https://dontkillmyapp.com"
            )
        }

        AlertDialog.Builder(this)
            .setTitle("⚠️ $brandTitle")
            .setMessage(guidanceMessage)
            .setPositiveButton("Configure OEM Settings") { _, _ ->
                prefs.edit().putBoolean(KEY_OEM_PROMPTED, true).apply()
                launchOemBatterySettings(manufacturer)
            }
            .setNeutralButton("DontKillMyApp Guide") { _, _ ->
                try {
                    val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(dkmUrl))
                    startActivity(browserIntent)
                } catch (e: Exception) {
                    Toast.makeText(this, "Could not open browser", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("I Have Configured This") { _, _ ->
                prefs.edit().putBoolean(KEY_OEM_PROMPTED, true).apply()
            }
            .show()
    }

    /**
     * Attempts to launch vendor-specific OEM battery management / autostart settings.
     * Gracefully falls back to standard Application Details settings if vendor intent is not present.
     */
    private fun launchOemBatterySettings(manufacturer: String) {
        val intent = Intent()
        try {
            when {
                manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco") -> {
                    intent.component = ComponentName(
                        "com.miui.securitycenter",
                        "com.miui.permcenter.autostart.AutoStartManagementActivity"
                    )
                }
                manufacturer.contains("samsung") -> {
                    intent.component = ComponentName(
                        "com.samsung.android.lool",
                        "com.samsung.android.sm.ui.battery.BatteryActivity"
                    )
                }
                manufacturer.contains("oppo") || manufacturer.contains("realme") -> {
                    intent.component = ComponentName(
                        "com.coloros.safecenter",
                        "com.coloros.safecenter.permission.startup.StartupAppListActivity"
                    )
                }
                manufacturer.contains("vivo") -> {
                    intent.component = ComponentName(
                        "com.iqoo.secure",
                        "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"
                    )
                }
                manufacturer.contains("huawei") || manufacturer.contains("honor") -> {
                    intent.component = ComponentName(
                        "com.huawei.systemmanager",
                        "com.huawei.systemmanager.optimize.process.ProtectActivity"
                    )
                }
                else -> {
                    intent.action = Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS
                }
            }
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            startActivity(intent)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to launch specific OEM activity for $manufacturer, falling back to app settings", e)
            val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:$packageName")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            startActivity(fallback)
        }
    }

    private fun updatePermissionStatusUI() {
        val hasFine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val hasBg = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
        } else true

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        val isBatteryExempt = powerManager.isIgnoringBatteryOptimizations(packageName)

        if (hasFine && hasBg && isBatteryExempt) {
            binding.tvPermissionStatus.text = "✓ Permissions & Battery: All 100% Configured"
            binding.tvPermissionStatus.setTextColor(ContextCompat.getColor(this, com.familysafety.tracker.R.color.status_green))
            binding.btnFixPermissions.isEnabled = false
            binding.btnFixPermissions.text = "Permissions Configured"
        } else {
            binding.tvPermissionStatus.text = "⚠️ Requires Action: Background location or battery exemption missing."
            binding.tvPermissionStatus.setTextColor(ContextCompat.getColor(this, com.familysafety.tracker.R.color.status_amber))
            binding.btnFixPermissions.isEnabled = true
            binding.btnFixPermissions.text = "Grant Permissions"
        }
    }

    private fun updateSyncStatusUI() {
        val prefs = getSharedPreferences(ApiClient.PREFS_NAME, Context.MODE_PRIVATE)
        val lastTimestamp = prefs.getLong(LocationSyncWorker.KEY_LAST_SYNC_TIME, 0L)
        val lastLat = prefs.getString(LocationSyncWorker.KEY_LAST_LATITUDE, null)
        val lastLng = prefs.getString(LocationSyncWorker.KEY_LAST_LONGITUDE, null)

        if (lastTimestamp > 0 && lastLat != null && lastLng != null) {
            val sdf = SimpleDateFormat("MMM dd, yyyy HH:mm:ss", Locale.getDefault())
            val formattedTime = sdf.format(Date(lastTimestamp))
            binding.tvLastSync.text = "Last Location: $lastLat, $lastLng\nSynced at: $formattedTime"
        } else {
            binding.tvLastSync.text = "Last Location Update: Never"
        }
    }
}
