package com.familysafety.tracker.util

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.familysafety.tracker.network.ApiClient
import com.familysafety.tracker.worker.LocationSyncWorker
import java.util.concurrent.TimeUnit

object WorkSchedulerHelper {

    private const val TAG = "WorkSchedulerHelper"
    private const val ONE_TIME_WORK_NAME = "immediate_location_sync_work"

    /**
     * Enqueues or updates the periodic background location sync task.
     * @param intervalMinutes Interval in minutes (minimum 15, typical 30 or 60).
     */
    fun schedulePeriodicSync(context: Context, intervalMinutes: Long = 30) {
        val safeInterval = intervalMinutes.coerceAtLeast(15)
        Log.i(TAG, "Configuring periodic location sync every $safeInterval minutes.")

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val periodicWorkRequest = PeriodicWorkRequestBuilder<LocationSyncWorker>(
            safeInterval, TimeUnit.MINUTES,
            // 5 minute flex interval ensures Android executes within a predictable window
            5, TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            LocationSyncWorker.WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            periodicWorkRequest
        )
    }

    /**
     * Immediately triggers an out-of-band location sync (useful for testing on phone).
     */
    fun triggerImmediateSync(context: Context) {
        Log.i(TAG, "Triggering immediate one-time location sync.")
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val oneTimeRequest = OneTimeWorkRequestBuilder<LocationSyncWorker>()
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            ONE_TIME_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            oneTimeRequest
        )
    }

    /**
     * Cancels any pending periodic sync tasks.
     */
    fun cancelSync(context: Context) {
        Log.i(TAG, "Cancelling periodic location sync.")
        WorkManager.getInstance(context).cancelUniqueWork(LocationSyncWorker.WORK_NAME)
    }
}
