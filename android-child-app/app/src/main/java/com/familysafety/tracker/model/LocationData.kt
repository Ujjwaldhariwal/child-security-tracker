package com.familysafety.tracker.model

import com.google.gson.annotations.SerializedName

data class LocationPayload(
    @SerializedName("uuid") val uuid: String? = null,
    @SerializedName("deviceId") val deviceId: String,
    @SerializedName("timestamp") val timestamp: Long,
    @SerializedName("fixTimestamp") val fixTimestamp: Long = timestamp,
    @SerializedName("latitude") val latitude: Double,
    @SerializedName("longitude") val longitude: Double,
    @SerializedName("accuracy") val accuracy: Float,
    @SerializedName("batteryPct") val batteryPct: Int,
    @SerializedName("isCharging") val isCharging: Boolean,
    @SerializedName("networkType") val networkType: String = "MOBILE_OR_WIFI",
    @SerializedName("isOfflineBuffered") val isOfflineBuffered: Boolean = false,
    @SerializedName("isCached") val isCached: Boolean = false,
    @SerializedName("isStale") val isStale: Boolean = false
)

data class BatchLocationPayload(
    @SerializedName("deviceId") val deviceId: String,
    @SerializedName("batchSize") val batchSize: Int,
    @SerializedName("sentAt") val sentAt: Long = System.currentTimeMillis(),
    @SerializedName("locations") val locations: List<LocationPayload>
)

data class SyncResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("message") val message: String?,
    @SerializedName("serverTime") val serverTime: Long?,
    @SerializedName("recordId") val recordId: String? = null
)

data class BatchSyncResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("message") val message: String?,
    @SerializedName("processedCount") val processedCount: Int?,
    @SerializedName("acknowledgedUuids") val acknowledgedUuids: List<String>?,
    @SerializedName("serverTime") val serverTime: Long?
)
