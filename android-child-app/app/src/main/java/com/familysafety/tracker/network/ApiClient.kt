package com.familysafety.tracker.network

import android.content.Context
import android.util.Log
import com.familysafety.tracker.model.LocationPayload
import com.familysafety.tracker.model.SyncResponse
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiClient(private val context: Context) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val gson = Gson()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    companion object {
        private const val TAG = "ApiClient"
        const val PREFS_NAME = "child_tracker_prefs"
        const val KEY_SERVER_URL = "server_url"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_AUTH_TOKEN = "auth_token"
        const val KEY_INTERVAL_MINS = "interval_mins"

        const val DEFAULT_SERVER_URL = "http://10.0.2.2:5050"
        const val DEFAULT_DEVICE_ID = "child_phone_01"
        const val DEFAULT_AUTH_TOKEN = "family_secret_token_123"
        const val DEFAULT_INTERVAL_MINS = 30
    }

    suspend fun sendLocation(payload: LocationPayload): Result<SyncResponse> = withContext(Dispatchers.IO) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val serverUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL)?.trimEnd('/')
            ?: DEFAULT_SERVER_URL
        val authToken = prefs.getString(KEY_AUTH_TOKEN, DEFAULT_AUTH_TOKEN) ?: DEFAULT_AUTH_TOKEN

        val endpoint = "$serverUrl/api/location"
        val jsonBody = gson.toJson(payload)

        val request = Request.Builder()
            .url(endpoint)
            .addHeader("Content-Type", "application/json")
            .addHeader("X-Device-Token", authToken)
            .post(jsonBody.toRequestBody(jsonMediaType))
            .build()

        try {
            val response = client.newCall(request).execute()
            val responseBody = response.body?.string()

            if (response.isSuccessful && !responseBody.isNullOrBlank()) {
                val syncResponse = gson.fromJson(responseBody, SyncResponse::class.java)
                Log.d(TAG, "Sync success: ${payload.latitude}, ${payload.longitude}")
                Result.success(syncResponse)
            } else {
                val errorMsg = "HTTP error ${response.code}: $responseBody"
                Log.e(TAG, errorMsg)
                Result.failure(IOException(errorMsg))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Network sync failed", e)
            Result.failure(e)
        }
    }

    suspend fun sendLocationBatch(payload: com.familysafety.tracker.model.BatchLocationPayload): Result<com.familysafety.tracker.model.BatchSyncResponse> = withContext(Dispatchers.IO) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val serverUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL)?.trimEnd('/')
            ?: DEFAULT_SERVER_URL
        val authToken = prefs.getString(KEY_AUTH_TOKEN, DEFAULT_AUTH_TOKEN) ?: DEFAULT_AUTH_TOKEN

        val endpoint = "$serverUrl/api/location/batch"
        val jsonBody = gson.toJson(payload)

        val request = Request.Builder()
            .url(endpoint)
            .addHeader("Content-Type", "application/json")
            .addHeader("X-Device-Token", authToken)
            .post(jsonBody.toRequestBody(jsonMediaType))
            .build()

        try {
            val response = client.newCall(request).execute()
            val responseBody = response.body?.string()

            if (response.isSuccessful && !responseBody.isNullOrBlank()) {
                val syncResponse = gson.fromJson(responseBody, com.familysafety.tracker.model.BatchSyncResponse::class.java)
                Log.d(TAG, "Batch sync success: ${payload.batchSize} items uploaded.")
                Result.success(syncResponse)
            } else {
                val errorMsg = "HTTP batch error ${response.code}: $responseBody"
                Log.e(TAG, errorMsg)
                Result.failure(IOException(errorMsg))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Network batch sync failed", e)
            Result.failure(e)
        }
    }
}
