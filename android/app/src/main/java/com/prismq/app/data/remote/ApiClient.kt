package com.prismq.app.data.remote

import com.prismq.app.BuildConfig
import com.prismq.app.data.local.AppPreferences
import com.prismq.app.data.model.ApiErrorResponse
import com.prismq.app.util.AppIntegrityShield
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.io.IOException
import java.net.Proxy
import java.util.concurrent.TimeUnit

object ApiClient {

    @OptIn(ExperimentalSerializationApi::class)
    val json: Json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
        explicitNulls = false
        coerceInputValues = true
    }

    private val fixedBaseUrl: String
        get() = "${AppPreferences.FIXED_SERVER_URL}/"

    @Volatile
    private var currentToken: String = ""

    private val okHttpClient: OkHttpClient by lazy {
        val builder = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                if (BuildConfig.ENABLE_INTEGRITY_ENFORCEMENT && AppIntegrityShield.isCompromised()) {
                    throw IOException("检测到应用完整性校验异常或运行在被注入/重打包环境中，已中止网络请求")
                }
                val reqBuilder = chain.request().newBuilder()
                    .header("Accept", "application/json")
                    .header("X-PrismQ-Client", "android-${BuildConfig.VERSION_NAME}")
                val token = currentToken
                if (token.isNotBlank()) {
                    reqBuilder.header("Authorization", "Bearer $token")
                }
                chain.proceed(reqBuilder.build())
            }
        if (!BuildConfig.DEBUG) {
            builder.proxy(Proxy.NO_PROXY)
        }
        builder.build()
    }

    private val fixedApi: KaoshibaoApi by lazy {
        Retrofit.Builder()
            .baseUrl(fixedBaseUrl)
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(KaoshibaoApi::class.java)
    }

    val streamClient: OkHttpClient by lazy {
        okHttpClient.newBuilder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .build()
    }

    val downloadClient: OkHttpClient by lazy {
        okHttpClient.newBuilder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(300, TimeUnit.SECONDS)
            .build()
    }

    fun updateToken(token: String) {
        currentToken = token.trim()
    }

    fun getApi(): KaoshibaoApi = fixedApi

    fun parseError(throwable: Throwable): String {
        return when (throwable) {
            is HttpException -> {
                val raw = try {
                    throwable.response()?.errorBody()?.string()
                } catch (_: Exception) {
                    null
                }
                if (!raw.isNullOrBlank()) {
                    try {
                        val parsed = json.decodeFromString<ApiErrorResponse>(raw)
                        if (parsed.error.isNotBlank()) return parsed.error
                    } catch (_: Exception) {
                    }
                }
                "服务器返回错误 (${throwable.code()})"
            }
            is IOException -> "网络连接失败：${throwable.localizedMessage ?: "无法连接到服务器"}"
            else -> throwable.localizedMessage ?: "操作失败"
        }
    }
}
