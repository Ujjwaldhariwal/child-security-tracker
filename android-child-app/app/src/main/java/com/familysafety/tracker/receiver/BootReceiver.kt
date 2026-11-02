package com.familysafety.tracker.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.familysafety.tracker.network.ApiClient
import com.familysafety.tracker.util.WorkSchedulerHelper

class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Log.i(TAG, "Device rebooted or package replaced: $action")

        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED ||
            action == "android.intent.action.QUICKBOOT_POWERON"
        ) {
            val prefs = context.getSharedPreferences(ApiClient.PREFS_NAME, Context.MODE_PRIVATE)
            val interval = prefs.getInt(ApiClient.KEY_INTERVAL_MINS, ApiClient.DEFAULT_INTERVAL_MINS)
            Log.i(TAG, "Rescheduling background periodic location sync with interval: $interval mins")
            WorkSchedulerHelper.schedulePeriodicSync(context, interval.toLong())
        }
    }
}
