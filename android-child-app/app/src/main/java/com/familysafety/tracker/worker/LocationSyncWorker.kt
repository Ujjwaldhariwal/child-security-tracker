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
        private const val STALE_THRESHOLD_MS = 15 * 60 * 1000L // 15 minutes
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

        var isCached = false
        var isStale = false
        var fixTimestamp: Long

        val freshLocation: Location? = try {
            withTimeoutOrNull(10_000) {
                // Priority.PRIORITY_BALANCED_POWER_ACCURACY locks in 1-3 seconds using Wi-Fi & cell towers
                fusedClient.getCurrentLocation(
                    Priority.PRIORITY_BALANCED_POWER_ACCURACY,
                    cts.token
                ).await()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Exception during fresh location acquisition", e)
            null
        }

        val location: Location?
        if (freshLocation != null) {
            location = freshLocation
            isCached = false
            isStale = false
            fixTimestamp = if (freshLocation.time > 0) freshLocation.time else System.currentTimeMillis()
            Log.i(TAG, "Acquired fresh location fix (accuracy: ${freshLocation.accuracy}m)")
        } else {
            // Cancel hardware scan immediately upon timeout to power down sensors
            cts.cancel()
            Log.w(TAG, "Fresh location timed out after 10s. Falling back to lastLocation.")

            val cachedLocation: Location? = try {
                fusedClient.lastLocation.await()
            } catch (fallbackEx: Exception) {
                Log.w(TAG, "Failed to retrieve last known location", fallbackEx)
                null
            }

            if (cachedLocation != null) {
                location = cachedLocation
                isCached = true
                val now = System.currentTimeMillis()
                val cachedTime = cachedLocation.time
                val ageMs = now - cachedTime

                // Strict validation: Do NOT spoof stale timestamps as current time!
                fixTimestamp = if (cachedTime > 0) cachedTime else now

                if (ageMs > STALE_THRESHOLD_MS) {
                    isStale = true
                    Log.w(TAG, "Last known location is stale (Age: ${ageMs / 60000} mins). Flagging isStale = true.")
                } else {
                    isStale = false
                    Log.i(TAG, "Last known location is fresh enough (Age: ${ageMs / 1000}s).")
                }
            } else {
                location = null
                fixTimestamp = System.currentTimeMillis()
            }
        }

        if (location == null) {
            Log.w(TAG, "No valid location acquired from GPS or Network provider.")
            return Result.retry()
        }

        // 3. Read battery status
        val (batteryPct, isCharging) = getBatteryStatus(appContext)

        // 4. Assemble payload with truthful fixTimestamp and isStale flag
        val prefs = appContext.getSharedPreferences(ApiClient.PREFS_NAME, Context.MODE_PRIVATE)
        val deviceId = prefs.getString(ApiClient.KEY_DEVICE_ID, ApiClient.DEFAULT_DEVICE_ID)
            ?: ApiClient.DEFAULT_DEVICE_ID

        val payload = LocationPayload(
            deviceId = deviceId,
            timestamp = fixTimestamp, // Truthful fix timestamp, NOT spoofed current time!
            fixTimestamp = fixTimestamp,
            latitude = location.latitude,
            longitude = location.longitude,
            accuracy = location.accuracy,
            batteryPct = batteryPct,
            isCharging = isCharging,
            networkType = if (isCached) "CACHED_FALLBACK" else "BALANCED_NLP",
            isOfflineBuffered = false,
            isCached = isCached,
            isStale = isStale
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
            Log.i(TAG, "Periodic location update delivered successfully (isCached=$isCached, isStale=$isStale).")
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
