# Keep models for Gson serialization
-keepclassmembers class com.familysafety.tracker.model.** { *; }
-keep class com.familysafety.tracker.model.** { *; }

# WorkManager
-keep class * extends androidx.work.Worker { *; }
-keep class * extends androidx.work.CoroutineWorker { *; }
-keep class * extends androidx.work.ListenableWorker { *; }
