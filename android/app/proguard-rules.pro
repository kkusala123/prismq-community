# ==================== R8 混淆加固 ====================
-obfuscationdictionary obfuscation-dict.txt
-classobfuscationdictionary obfuscation-dict.txt
-packageobfuscationdictionary obfuscation-dict.txt
-renamesourcefileattribute "P"

# 保留泛型签名、注解与行号映射（源文件名统一脱敏为 "P"，可结合 mapping.txt 反解崩溃堆栈）
-keepattributes Signature, RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations, AnnotationDefault, InnerClasses, EnclosingMethod, Exceptions, SourceFile, LineNumberTable

# 剥离 Release 调试日志
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int v(...);
    public static int d(...);
    public static int i(...);
    public static int w(...);
}

# ==================== 框架与序列化安全保留规则 ====================
-keep public class com.prismq.app.MainActivity
-keep class * extends androidx.lifecycle.AndroidViewModel {
    public <init>(android.app.Application);
}
-keep class * extends androidx.lifecycle.ViewModel {
    public <init>(...);
}

# Retrofit 接口与 kotlinx.serialization 数据模型
-keep interface com.prismq.app.data.remote.KaoshibaoApi { *; }
-keep class com.prismq.app.data.remote.KaoshibaoApi$* { *; }
-keep class androidx.compose.foundation.pager.** { *; }
-keep class com.prismq.app.data.model.** { *; }
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation

-dontnote kotlinx.serialization.SerializationKt
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.prismq.app.data.model.**$$serializer { *; }
-keepclassmembers class com.prismq.app.data.model.** {
    *** Companion;
}

# OkHttp / Okio / Retrofit 常见告警消除
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn retrofit2.**
-dontwarn javax.annotation.**
-dontwarn org.codehaus.mojo.animal_sniffer.**
