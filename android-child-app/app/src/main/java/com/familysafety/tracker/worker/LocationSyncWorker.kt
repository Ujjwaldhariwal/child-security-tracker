package com.familysafety.tracker.worker

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.Location
import android.os.BatteryManager
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.familysafety.tracker.model.LocationPayload
import com.familysafety.tracker.network.ApiClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

class LocationSyncWorker(
    private val appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        private const val TAG = "LocationSyncWorker"
        const val WORK_NAME = "periodic_location_sync_work"
        const val KEY_LAST_SYNC_TIME = "last_sync_timestamp"
        const val KEY_LAST_LATITUDE = "last_latitude"
        const val KEY_LAST_LONGITUDE = "last_longitude"
    }

    override suspend fun doWork(): Result {
        Log.i(TAG, "Executing periodic location sync worker (Run ID: $id)")

        // 1. Verify runtime location permissions
        val hasFine = ContextCompat.checkSelfPermission(
            appContext, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(
            appContext, Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasFine && !hasCoarse) {
            Log.e(TAG, "Location permissions missing. Aborting periodic sync.")
            return Result.failure()
        }

        // 2. Fetch single GPS/Network fix with low battery impact
        val fusedClient = LocationServices.getFusedLocationProviderClient(appContext)
        val cts = CancellationTokenSource()

        val location: Location? = try {
            withTimeoutOrNull(12_000) {
                // Priority.PRIORITY_BALANCED_POWER_ACCURACY locks in 1-3 seconds using Wi-Fi & cell towers
                fusedClient.getCurrentLocation(
                    Priority.PRIORITY_BALANCED_POWER_ACCURACY,
                    cts.token
                ).await()
            } ?: fusedClient.lastLocation.await()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to capture current location, attempting last known location", e)
            try {
                fusedClient.lastLocation.await()
            } catch (fallbackEx: Exception) {
                null
            }
        }

        if (location == null) {
            Log.w(TAG, "No valid location acquired from GPS or Network provider.")
            return Result.retry()
        }

        // 3. Read battery status
        val (batteryPct, isCharging) = getBatteryStatus(appContext)

        // 4. Assemble payload
        val prefs = appContext.getSharedPreferences(ApiClient.PREFS_NAME, Context.MODE_PRIVATE)
        val deviceId = prefs.getString(ApiClient.KEY_DEVICE_ID, ApiClient.DEFAULT_DEVICE_ID)
            ?: ApiClient.DEFAULT_DEVICE_ID

        val payload = LocationPayload(
            deviceId = deviceId,
            timestamp = System.currentTimeMillis(),
            latitude = location.latitude,
            longitude = location.longitude,
            accuracy = location.accuracy,
            batteryPct = batteryPct,
            isCharging = isCharging,
            networkType = "AUTOMATIC"
        )

        // 5. Send to relay backend
        val apiClient = ApiClient(appContext)
        val sendResult = apiClient.sendLocation(payload)

        return if (sendResult.isSuccess) {
            prefs.edit()
                .putLong(KEY_LAST_SYNC_TIME, payload.timestamp)
                .putString(KEY_LAST_LATITUDE, payload.latitude.toString())
                .putString(KEY_LAST_LONGITUDE, payload.longitude.toString())
                .apply()
            Log.i(TAG, "Periodic location update delivered successfully.")
            Result.success()
        } else {
            Log.w(TAG, "Periodic location update failed, scheduling retry via WorkManager.")
            Result.retry()
        }
    }

    private fun getBatteryStatus(context: Context): Pair<Int, Boolean> {
        val batteryIntent = context.registerReceiver(
            null,
            IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        )
        val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val status = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1

        val batteryPct = if (level >= 0 && scale > 0) {
            ((level.toFloat() / scale.toFloat()) * 100).toInt()
        } else {
            -1
        }

        val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL

        return Pair(batteryPct, isCharging)
    }
}
