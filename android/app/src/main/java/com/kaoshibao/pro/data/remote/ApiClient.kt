package com.kaoshibao.pro.data.remote

import com.kaoshibao.pro.data.local.AppPreferences
import com.kaoshibao.pro.data.model.ApiErrorResponse
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.io.IOException
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

    @Volatile
    private var currentBaseUrl: String = AppPreferences.DEFAULT_SERVER_URL

    @Volatile
    private var currentToken: String = ""

    @Volatile
    private var cachedApiUrl: String = ""

    @Volatile
    private var cachedApi: KaoshibaoApi? = null

    private val okHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val builder = chain.request().newBuilder()
                    .header("Accept", "application/json")
                val token = currentToken
                if (token.isNotBlank()) {
                    builder.header("Authorization", "Bearer $token")
                }
                chain.proceed(builder.build())
            }
            .build()
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

    @Synchronized
    fun updateServerUrl(rawUrl: String): String {
        val normalized = AppPreferences.normalizeServerUrl(rawUrl)
        currentBaseUrl = normalized
        if (cachedApiUrl != normalized) {
            cachedApi = null
        }
        return normalized
    }

    fun getBaseUrl(): String = currentBaseUrl

    fun updateToken(token: String) {
        currentToken = token.trim()
    }

    @Synchronized
    fun getApi(): KaoshibaoApi {
        val targetBase = "${currentBaseUrl.trimEnd('/')}/"
        val existing = cachedApi
        if (existing != null && cachedApiUrl == currentBaseUrl) {
            return existing
        }
        val created = Retrofit.Builder()
            .baseUrl(targetBase)
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(KaoshibaoApi::class.java)
        cachedApi = created
        cachedApiUrl = currentBaseUrl
        return created
    }

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
