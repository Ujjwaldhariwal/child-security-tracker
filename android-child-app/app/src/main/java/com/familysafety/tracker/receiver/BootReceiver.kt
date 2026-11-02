package com.familysafety.tracker.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.UserManager
import android.util.Log
import com.familysafety.tracker.network.ApiClient
import com.familysafety.tracker.util.WorkSchedulerHelper

class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Log.i(TAG, "Device rebooted or package replaced: $action (DirectBootAware: true)")

        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_LOCKED_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED ||
            action == "android.intent.action.QUICKBOOT_POWERON"
        ) {
            // Direct Boot Handling:
            // When device boots before user enters PIN/pattern, Credential Encrypted (CE) storage is locked.
            // We use Device Protected Storage if running under Direct Boot on API 24+.
            val safeContext = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                val userManager = context.getSystemService(Context.USER_SERVICE) as? UserManager
                if (userManager != null && !userManager.isUserUnlocked) {
                    Log.i(TAG, "Device is locked in Direct Boot mode. Using device-protected storage context.")
                    context.createDeviceProtectedStorageContext()
                } else {
                    context
                }
            } else {
                context
            }

            val prefs = safeContext.getSharedPreferences(ApiClient.PREFS_NAME, Context.MODE_PRIVATE)
            val interval = prefs.getInt(ApiClient.KEY_INTERVAL_MINS, ApiClient.DEFAULT_INTERVAL_MINS)
            Log.i(TAG, "Rescheduling background periodic location sync with interval: $interval mins")
            WorkSchedulerHelper.schedulePeriodicSync(context, interval.toLong())
        }
    }
}
