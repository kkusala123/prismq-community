package com.prismq.app.util

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import java.io.File
import java.io.FileOutputStream

object QrShareUtil {

    fun generateQrBitmap(content: String, sizePx: Int = 520): Bitmap {
        val hints = mapOf(
            EncodeHintType.CHARACTER_SET to "UTF-8",
            EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
            EncodeHintType.MARGIN to 2
        )
        val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, sizePx, sizePx, hints)
        val pixels = IntArray(sizePx * sizePx)
        val dark = Color.parseColor("#0F172A")
        val light = Color.WHITE
        for (y in 0 until sizePx) {
            val offset = y * sizePx
            for (x in 0 until sizePx) {
                pixels[offset + x] = if (matrix.get(x, y)) dark else light
            }
        }
        return Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888).apply {
            setPixels(pixels, 0, sizePx, 0, 0, sizePx, sizePx)
        }
    }

    /**
     * 生成带 PrismQ 品牌标识、标题与分享码的高清分享海报图片，便于微信扫码识别
     */
    fun generateSharePosterBitmap(
        qrContent: String,
        title: String,
        shareCode: String,
        subtitle: String
    ): Bitmap {
        val width = 760
        val height = 980
        val poster = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(poster)
        canvas.drawColor(Color.parseColor("#F1F5F9"))

        val cardPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
        canvas.drawRoundRect(RectF(40f, 40f, width - 40f, height - 40f), 36f, 36f, cardPaint)

        val brandPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#2554A8")
            textSize = 30f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
        }
        canvas.drawText("棱题 · PrismQ", width / 2f, 118f, brandPaint)

        val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#0F172A")
            textSize = 36f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
        }
        val clippedTitle = if (title.length > 18) title.take(17) + "…" else title
        canvas.drawText(clippedTitle, width / 2f, 178f, titlePaint)

        val subPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#64748B")
            textSize = 24f
            textAlign = Paint.Align.CENTER
        }
        canvas.drawText(subtitle, width / 2f, 222f, subPaint)

        val qrSize = 480
        val qrBitmap = generateQrBitmap(qrContent, qrSize)
        val qrLeft = (width - qrSize) / 2f
        val qrTop = 264f
        val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#E2E8F0")
            style = Paint.Style.STROKE
            strokeWidth = 3f
        }
        canvas.drawRoundRect(
            RectF(qrLeft - 16f, qrTop - 16f, qrLeft + qrSize + 16f, qrTop + qrSize + 16f),
            24f,
            24f,
            borderPaint
        )
        canvas.drawBitmap(qrBitmap, qrLeft, qrTop, null)

        val codeBoxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#EFF6FF")
        }
        canvas.drawRoundRect(RectF(140f, 788f, width - 140f, 858f), 18f, 18f, codeBoxPaint)

        val codePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#1D4ED8")
            textSize = 32f
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
        }
        canvas.drawText("分享码：$shareCode", width / 2f, 834f, codePaint)

        val footPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#94A3B8")
            textSize = 22f
            textAlign = Paint.Align.CENTER
        }
        canvas.drawText("微信扫一扫或打开 PrismQ 输入分享码加入", width / 2f, 905f, footPaint)

        return poster
    }

    fun sharePosterToWeChatOrChooser(
        context: Context,
        poster: Bitmap,
        shareText: String,
        preferWeChat: Boolean
    ): Result<Unit> {
        return runCatching {
            val dir = File(context.cacheDir, "shares").apply { mkdirs() }
            val outFile = File(dir, "prismq_share_${System.currentTimeMillis()}.png")
            FileOutputStream(outFile).use { fos ->
                poster.compress(Bitmap.CompressFormat.PNG, 100, fos)
            }
            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                outFile
            )

            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_TEXT, shareText)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            if (preferWeChat) {
                val wxIntent = Intent(intent).apply {
                    setPackage("com.tencent.mm")
                }
                if (wxIntent.resolveActivity(context.packageManager) != null) {
                    wxIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(wxIntent)
                    return@runCatching
                }
            }

            val chooser = Intent.createChooser(intent, "分享二维码海报").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooser)
        }
    }

    fun sharePlainTextToWeChatOrChooser(
        context: Context,
        text: String,
        preferWeChat: Boolean
    ): Result<Unit> {
        return runCatching {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
            }
            if (preferWeChat) {
                val wxIntent = Intent(intent).apply { setPackage("com.tencent.mm") }
                if (wxIntent.resolveActivity(context.packageManager) != null) {
                    wxIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(wxIntent)
                    return@runCatching
                }
            }
            val chooser = Intent.createChooser(intent, "分享至微信或其他应用").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooser)
        }
    }

    fun saveBitmapToGallery(context: Context, bitmap: Bitmap, filename: String): Result<Unit> {
        return runCatching {
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, filename)
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/PrismQ")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: error("无法创建相册图片文件")
            resolver.openOutputStream(uri)?.use { os ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, os)
            } ?: error("无法写入相册输出流")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            }
        }
    }
}
