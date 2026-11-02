package com.familysafety.tracker.model

import com.google.gson.annotations.SerializedName

data class LocationPayload(
    @SerializedName("deviceId") val deviceId: String,
    @SerializedName("timestamp") val timestamp: Long,
    @SerializedName("latitude") val latitude: Double,
    @SerializedName("longitude") val longitude: Double,
    @SerializedName("accuracy") val accuracy: Float,
    @SerializedName("batteryPct") val batteryPct: Int,
    @SerializedName("isCharging") val isCharging: Boolean,
    @SerializedName("networkType") val networkType: String = "MOBILE_OR_WIFI"
)

data class SyncResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("message") val message: String?,
    @SerializedName("serverTime") val serverTime: Long?
)
