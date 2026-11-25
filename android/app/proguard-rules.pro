# Keep kotlinx.serialization & Retrofit DTOs
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.SerializationKt
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.kaoshibao.pro.data.model.**$$serializer { *; }
-keepclassmembers class com.kaoshibao.pro.data.model.** {
    *** Companion;
}
