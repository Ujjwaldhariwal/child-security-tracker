package com.familysafety.tracker.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
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
                .setNegativeButton("Later", null)
                .show()
        } else {
            Toast.makeText(this, "All permissions and battery settings are optimally configured!", Toast.LENGTH_SHORT).show()
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
            binding.btnFixPermissions.text = "Configured"
        } else {
            binding.tvPermissionStatus.text = "⚠️ Requires Action: Background location or battery exemption missing."
            binding.tvPermissionStatus.setTextColor(ContextCompat.getColor(this, com.familysafety.tracker.R.color.status_amber))
            binding.btnFixPermissions.isEnabled = true
            binding.btnFixPermissions.text = "Configure Permissions"
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
