package com.prismq.app.ui.screens

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.prismq.app.data.model.AiJobSummary
import com.prismq.app.data.model.BatchImportRequest
import com.prismq.app.data.model.CreateAiJobTextRequest
import com.prismq.app.data.model.CreateBankRequest
import com.prismq.app.data.model.ImportValidationSummary
import com.prismq.app.data.model.ParseTextRequest
import com.prismq.app.data.model.ParsedQuestionDraft
import com.prismq.app.data.model.QuestionBankSummary
import com.prismq.app.data.model.questionTypeLabel
import com.prismq.app.data.remote.ApiClient
import com.prismq.app.ui.MainViewModel
import com.prismq.app.ui.components.KsbBadge
import com.prismq.app.ui.components.KsbBanner
import com.prismq.app.ui.components.KsbCard
import com.prismq.app.ui.components.KsbEmptyView
import com.prismq.app.ui.components.KsbOutlineButton
import com.prismq.app.ui.components.KsbPrimaryButton
import com.prismq.app.ui.components.KsbSegmentedControl
import com.prismq.app.ui.theme.KsbTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportScreen(
    initialBankId: String?,
    viewModel: MainViewModel,
    onBack: () -> Unit = {},
    onBankImported: (String) -> Unit
) {
    val palette = KsbTheme.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var modeTab by remember { mutableStateOf(0) } // 0=文件直导, 1=AI后台洗题, 2=任务队列
    var banks by remember { mutableStateOf<List<QuestionBankSummary>>(emptyList()) }
    var targetBankId by remember { mutableStateOf(initialBankId ?: "__new__") }
    var newBankTitle by remember { mutableStateOf("") }
    var defaultChapter by remember { mutableStateOf("") }
    var bankDropdownOpen by remember { mutableStateOf(false) }

    var pasteText by remember { mutableStateOf("") }
    var aiRawText by remember { mutableStateOf("") }
    var aiAutoImport by remember { mutableStateOf(true) }

    var pickedFilename by remember { mutableStateOf("") }
    var detectedFormat by remember { mutableStateOf("") }
    var drafts by remember { mutableStateOf<List<ParsedQuestionDraft>>(emptyList()) }
    var summary by remember { mutableStateOf(ImportValidationSummary()) }

    var jobs by remember { mutableStateOf<List<AiJobSummary>>(emptyList()) }
    var activeJobCount by remember { mutableStateOf(0) }
    var jobsLoading by remember { mutableStateOf(false) }

    var busy by remember { mutableStateOf(false) }
    var committing by remember { mutableStateOf(false) }
    var statusMsg by remember { mutableStateOf<String?>(null) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    fun loadBanksAndJobs() {
        scope.launch {
            try {
                val res = viewModel.api().listBanks(scope = "mine")
                banks = res.banks
                if (initialBankId.isNullOrBlank() && res.banks.isNotEmpty() && targetBankId == "__new__") {
                    targetBankId = res.banks.first().id
                }
            } catch (_: Exception) {
            }
            try {
                val jobRes = viewModel.api().listAiJobs(25)
                jobs = jobRes.jobs
                activeJobCount = jobRes.activeCount
            } catch (_: Exception) {
            }
        }
    }

    LaunchedEffect(Unit) { loadBanksAndJobs() }

    // 存在活跃任务或正在查看任务队列时自动 3 秒轮询
    LaunchedEffect(modeTab, activeJobCount) {
        if (modeTab != 2 && activeJobCount <= 0) return@LaunchedEffect
        while (true) {
            delay(3000L)
            try {
                val jobRes = viewModel.api().listAiJobs(25)
                jobs = jobRes.jobs
                activeJobCount = jobRes.activeCount
                if (activeJobCount == 0 && modeTab != 2) break
            } catch (_: Exception) {
                break
            }
        }
    }

    fun resolveDisplayName(uri: Uri): String {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0) return cursor.getString(idx) ?: "document"
            }
        }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "questions.docx"
    }

    val directFilePicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        busy = true
        errorMsg = null
        statusMsg = null
        scope.launch {
            try {
                val filename = withContext(Dispatchers.IO) { resolveDisplayName(uri) }
                val bytes = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: throw IllegalStateException("无法读取所选文件内容")
                }
                val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
                val part = MultipartBody.Part.createFormData("file", filename, bytes.toRequestBody(mime.toMediaTypeOrNull()))
                val chBody = defaultChapter.trim().toRequestBody("text/plain".toMediaTypeOrNull())
                val bankBody = (if (targetBankId == "__new__") "" else targetBankId).toRequestBody("text/plain".toMediaTypeOrNull())

                val res = viewModel.api().extractRawFile(part, chBody, bankBody)
                pickedFilename = res.filename.ifBlank { filename }
                detectedFormat = res.sourceFormat
                if (newBankTitle.isBlank()) {
                    newBankTitle = pickedFilename.substringBeforeLast('.')
                }
                if (res.mode == "structured") {
                    drafts = res.drafts
                    summary = res.summary
                    statusMsg = "已按规范解析「$pickedFilename」共 ${res.count} 题（合格 ${res.summary.validCount} 题）。"
                } else {
                    pasteText = res.rawText
                    aiRawText = res.rawText
                    val parsed = viewModel.api().parseText(
                        ParseTextRequest(
                            text = res.rawText,
                            defaultChapter = defaultChapter.trim(),
                            bankId = if (targetBankId == "__new__") null else targetBankId
                        )
                    )
                    drafts = parsed.drafts
                    summary = parsed.summary
                    statusMsg = if (parsed.summary.validCount > 0) {
                        "已提取「$pickedFilename」并按规则解析 ${parsed.count} 题。"
                    } else {
                        "文档内容结构较松散，已为你填入「AI 后台洗题」，可直接发起后台 AI 转换。"
                    }
                }
            } catch (e: Exception) {
                errorMsg = ApiClient.parseError(e)
            } finally {
                busy = false
            }
        }
    }

    val aiJobFilePicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        busy = true
        errorMsg = null
        statusMsg = null
        scope.launch {
            try {
                val filename = withContext(Dispatchers.IO) { resolveDisplayName(uri) }
                val bytes = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: throw IllegalStateException("无法读取文件")
                }
                val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
                val part = MultipartBody.Part.createFormData("file", filename, bytes.toRequestBody(mime.toMediaTypeOrNull()))
                val chBody = defaultChapter.trim().toRequestBody("text/plain".toMediaTypeOrNull())
                val bankBody = (if (targetBankId == "__new__") "" else targetBankId).toRequestBody("text/plain".toMediaTypeOrNull())
                val titleBody = newBankTitle.trim().ifBlank { filename.substringBeforeLast('.') }
                    .toRequestBody("text/plain".toMediaTypeOrNull())
                val autoBody = aiAutoImport.toString().toRequestBody("text/plain".toMediaTypeOrNull())

                val created = viewModel.api().createAiFileJob(part, chBody, bankBody, titleBody, autoBody)
                statusMsg = "已创建后台 AI 洗题任务：${created.job.sourceFilename}"
                modeTab = 2
                loadBanksAndJobs()
            } catch (e: Exception) {
                errorMsg = ApiClient.parseError(e)
            } finally {
                busy = false
            }
        }
    }

    Scaffold(
        containerColor = palette.canvas,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = palette.canvas),
                title = {
                    Text(
                        text = "导题中心",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = palette.textPrimary
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "返回",
                            tint = palette.textPrimary
                        )
                    }
                }
            )
        }
    ) { innerPad ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPad)
        ) {
            Box(modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) {
                KsbSegmentedControl(
                    items = listOf(
                        "0" to "文档直导",
                        "1" to "AI 洗题",
                        "2" to if (activeJobCount > 0) "任务 ($activeJobCount)" else "AI 任务"
                    ),
                    selectedKey = modeTab.toString(),
                    onSelect = { k ->
                        val idx = k.toIntOrNull() ?: 0
                        modeTab = idx
                        if (idx == 2) loadBanksAndJobs()
                    }
                )
            }

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
            if (errorMsg != null) {
                item { KsbBanner(text = errorMsg!!, isError = true) }
            }
            if (statusMsg != null) {
                item { KsbBanner(text = statusMsg!!, isError = false) }
            }

            if (modeTab == 0 || modeTab == 1) {
                item {
                    KsbCard {
                        val selectedBankTitle = if (targetBankId == "__new__") {
                            "+ 新建一个私有题库"
                        } else {
                            banks.firstOrNull { it.id == targetBankId }?.title ?: "选择目标题库"
                        }

                        ExposedDropdownMenuBox(
                            expanded = bankDropdownOpen,
                            onExpandedChange = { bankDropdownOpen = !bankDropdownOpen }
                        ) {
                            OutlinedTextField(
                                value = selectedBankTitle,
                                onValueChange = {},
                                readOnly = true,
                                label = { Text("导入目标题库") },
                                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = bankDropdownOpen) },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                            )
                            ExposedDropdownMenu(
                                expanded = bankDropdownOpen,
                                onDismissRequest = { bankDropdownOpen = false }
                            ) {
                                banks.forEach { b ->
                                    DropdownMenuItem(
                                        text = { Text(b.title) },
                                        onClick = {
                                            targetBankId = b.id
                                            bankDropdownOpen = false
                                        }
                                    )
                                }
                                DropdownMenuItem(
                                    text = { Text("+ 新建一个私有题库", fontWeight = FontWeight.Bold, color = palette.brand) },
                                    onClick = {
                                        targetBankId = "__new__"
                                        bankDropdownOpen = false
                                    }
                                )
                            }
                        }

                        if (targetBankId == "__new__" || banks.isEmpty()) {
                            Spacer(modifier = Modifier.height(8.dp))
                            OutlinedTextField(
                                value = newBankTitle,
                                onValueChange = { newBankTitle = it },
                                label = { Text("新题库名称") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth()
                            )
                        }

                        Spacer(modifier = Modifier.height(8.dp))
                        OutlinedTextField(
                            value = defaultChapter,
                            onValueChange = { defaultChapter = it },
                            label = { Text("默认归属章节（可选）") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }

            if (modeTab == 0) {
                item {
                    KsbCard {
                        Text("规则直导（免 AI · 秒级解析）", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                        Spacer(modifier = Modifier.height(6.dp))
                        Text("支持 .xlsx / .xls / .csv / .docx / .json 或规则文本。", fontSize = 12.sp, color = palette.textSecondary)
                        Spacer(modifier = Modifier.height(10.dp))
                        KsbPrimaryButton(
                            text = if (pickedFilename.isNotBlank()) "换选文件 ($pickedFilename)" else "选择手机文件 (.xlsx / .docx / .csv)",
                            loading = busy,
                            modifier = Modifier.fillMaxWidth(),
                            onClick = { directFilePicker.launch(arrayOf("*/*")) }
                        )
                        if (detectedFormat.isNotBlank()) {
                            Spacer(modifier = Modifier.height(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                KsbBadge(text = "格式：$detectedFormat")
                                KsbBadge(text = "共 ${summary.total} 题")
                            }
                        }
                        Spacer(modifier = Modifier.height(10.dp))
                        OutlinedTextField(
                            value = pasteText,
                            onValueChange = { pasteText = it },
                            label = { Text("或直接粘贴试题文本") },
                            minLines = 4,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        KsbOutlineButton(
                            text = "按标准规则解析",
                            enabled = pasteText.isNotBlank() && !busy,
                            modifier = Modifier.fillMaxWidth(),
                            onClick = {
                                busy = true
                                errorMsg = null
                                scope.launch {
                                    try {
                                        val res = viewModel.api().parseText(
                                            ParseTextRequest(
                                                text = pasteText,
                                                defaultChapter = defaultChapter.trim(),
                                                bankId = if (targetBankId == "__new__") null else targetBankId
                                            )
                                        )
                                        drafts = res.drafts
                                        summary = res.summary
                                        statusMsg = "解析完成：共 ${res.count} 题，合格 ${res.summary.validCount} 题。"
                                    } catch (e: Exception) {
                                        errorMsg = ApiClient.parseError(e)
                                    } finally {
                                        busy = false
                                    }
                                }
                            }
                        )
                    }
                }

                if (drafts.isNotEmpty()) {
                    item {
                        KsbCard {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    KsbBadge(text = "总计 ${summary.total}")
                                    KsbBadge(text = "合格 ${summary.validCount}", containerColor = palette.successBg, contentColor = palette.success)
                                    if (summary.errorCount > 0) {
                                        KsbBadge(text = "错误 ${summary.errorCount}", containerColor = palette.errorBg, contentColor = palette.error)
                                    }
                                }
                                KsbPrimaryButton(
                                    text = "入库 (${summary.validCount})",
                                    containerColor = palette.success,
                                    loading = committing,
                                    enabled = summary.validCount > 0,
                                    onClick = {
                                        committing = true
                                        errorMsg = null
                                        scope.launch {
                                            try {
                                                val finalBankId = if (targetBankId == "__new__" || banks.isEmpty()) {
                                                    viewModel.api().createBank(
                                                        CreateBankRequest(
                                                            title = newBankTitle.trim().ifEmpty { "移动端导入题库" },
                                                            category = "手机导题"
                                                        )
                                                    ).id
                                                } else targetBankId

                                                viewModel.api().batchImportQuestions(
                                                    finalBankId,
                                                    BatchImportRequest(questions = drafts, skipInvalid = true)
                                                )
                                                onBankImported(finalBankId)
                                            } catch (e: Exception) {
                                                errorMsg = ApiClient.parseError(e)
                                            } finally {
                                                committing = false
                                            }
                                        }
                                    }
                                )
                            }
                        }
                    }

                    itemsIndexed(drafts) { idx, d ->
                        KsbCard(
                            borderColor = if (d.errors.isNotEmpty()) palette.error else palette.border
                        ) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text("#${idx + 1}", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = palette.textSecondary)
                                KsbBadge(text = questionTypeLabel(d.type))
                                if (d.chapterTitle.isNotBlank()) KsbBadge(text = d.chapterTitle)
                            }
                            if (d.errors.isNotEmpty()) {
                                Spacer(modifier = Modifier.height(6.dp))
                                KsbBanner(text = d.errors.joinToString("；"), isError = true)
                            }
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(d.stem, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = palette.textPrimary)
                            if (d.options.isNotEmpty()) {
                                Spacer(modifier = Modifier.height(4.dp))
                                d.options.forEach { opt ->
                                    Text("${opt.key}. ${opt.content}", fontSize = 12.sp, color = palette.textSecondary)
                                }
                            }
                            Spacer(modifier = Modifier.height(6.dp))
                            Text("答案：${d.answer.ifBlank { "未设置" }}", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = palette.success)
                        }
                    }
                }
            } else if (modeTab == 1) {
                item {
                    KsbCard {
                        Text("AI 后台异步洗题（上传即走）", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            "上传文件或杂乱教材讲义后立即加入后台转换队列，断网/退出 App 也不中断；完成后可自动建库并入库。",
                            fontSize = 12.sp,
                            color = palette.textSecondary
                        )
                        Spacer(modifier = Modifier.height(10.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("识别完成后自动导入目标题库", fontSize = 13.sp, color = palette.textPrimary)
                            Switch(checked = aiAutoImport, onCheckedChange = { aiAutoImport = it })
                        }
                        Spacer(modifier = Modifier.height(10.dp))
                        KsbPrimaryButton(
                            text = "上传 Word / PDF / TXT 创建后台 AI 任务",
                            containerColor = palette.ai,
                            loading = busy,
                            modifier = Modifier.fillMaxWidth(),
                            onClick = { aiJobFilePicker.launch(arrayOf("*/*")) }
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        OutlinedTextField(
                            value = aiRawText,
                            onValueChange = { aiRawText = it },
                            label = { Text("或直接粘贴杂乱试题 / 教材原文") },
                            minLines = 5,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(modifier = Modifier.height(10.dp))
                        KsbOutlineButton(
                            text = "提交文本后台 AI 转换",
                            enabled = aiRawText.isNotBlank() && !busy,
                            borderColor = palette.ai,
                            contentColor = palette.ai,
                            modifier = Modifier.fillMaxWidth(),
                            onClick = {
                                busy = true
                                errorMsg = null
                                statusMsg = null
                                scope.launch {
                                    try {
                                        val created = viewModel.api().createAiTextJob(
                                            CreateAiJobTextRequest(
                                                rawText = aiRawText,
                                                sourceFilename = "手机粘贴文本",
                                                defaultChapter = defaultChapter.trim(),
                                                targetBankId = if (targetBankId == "__new__") "" else targetBankId,
                                                newBankTitle = newBankTitle.trim(),
                                                autoImport = aiAutoImport
                                            )
                                        )
                                        statusMsg = "已提交后台任务（${created.job.id.take(8)}），正在排队洗题..."
                                        aiRawText = ""
                                        modeTab = 2
                                        loadBanksAndJobs()
                                    } catch (e: Exception) {
                                        errorMsg = ApiClient.parseError(e)
                                    } finally {
                                        busy = false
                                    }
                                }
                            }
                        )
                    }
                }
            } else {
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("最近后台 AI 转换任务", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                        TextButton(
                            onClick = {
                                jobsLoading = true
                                loadBanksAndJobs()
                                jobsLoading = false
                            }
                        ) {
                            Text(if (jobsLoading) "刷新中..." else "手动刷新", fontSize = 12.sp)
                        }
                    }
                }

                if (jobs.isEmpty()) {
                    item {
                        KsbEmptyView(
                            icon = Icons.Default.AutoAwesome,
                            title = "暂无后台 AI 转换任务",
                            subtitle = "切换至「AI 后台洗题」即可提交文档或长文本在服务端自动清洗入库",
                            actionText = "去创建 AI 任务",
                            onAction = { modeTab = 1 }
                        )
                    }
                } else {
                    items(jobs, key = { it.id }) { job ->
                        KsbCard {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = job.sourceFilename.ifBlank { "文本清洗任务" },
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = palette.textPrimary,
                                    modifier = Modifier.weight(1f)
                                )
                                KsbBadge(
                                    text = "${job.status} (${job.progressPct}%)",
                                    containerColor = when (job.status) {
                                        "completed" -> palette.successBg
                                        "failed" -> palette.errorBg
                                        "running", "queued" -> palette.aiBg
                                        else -> palette.cardElevated
                                    },
                                    contentColor = when (job.status) {
                                        "completed" -> palette.success
                                        "failed" -> palette.error
                                        "running", "queued" -> palette.ai
                                        else -> palette.textSecondary
                                    }
                                )
                            }
                            Spacer(modifier = Modifier.height(6.dp))
                            LinearProgressIndicator(
                                progress = { (job.progressPct / 100f).coerceIn(0f, 1f) },
                                modifier = Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(4.dp)),
                                color = palette.ai,
                                trackColor = palette.cardElevated
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(job.progressMessage, fontSize = 12.sp, color = palette.textSecondary)
                            if (job.importedCount > 0) {
                                Text(
                                    text = "已导入 ${job.importedCount} 题",
                                    fontSize = 12.sp,
                                    color = palette.success,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                            if (job.errorMessage.isNotBlank()) {
                                Spacer(modifier = Modifier.height(4.dp))
                                KsbBanner(text = job.errorMessage, isError = true)
                            }
                            Spacer(modifier = Modifier.height(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (!job.importedBankId.isNullOrBlank()) {
                                    KsbPrimaryButton(
                                        text = "打开题库",
                                        onClick = { onBankImported(job.importedBankId) }
                                    )
                                }
                                if (job.status == "running" || job.status == "queued") {
                                    KsbOutlineButton(
                                        text = "取消",
                                        onClick = {
                                            scope.launch {
                                                try {
                                                    viewModel.api().cancelAiJob(job.id)
                                                    loadBanksAndJobs()
                                                } catch (e: Exception) {
                                                    errorMsg = ApiClient.parseError(e)
                                                }
                                            }
                                        }
                                    )
                                }
                                if (job.status == "failed" || job.status == "cancelled") {
                                    KsbOutlineButton(
                                        text = "重试",
                                        onClick = {
                                            scope.launch {
                                                try {
                                                    viewModel.api().retryAiJob(job.id)
                                                    loadBanksAndJobs()
                                                } catch (e: Exception) {
                                                    errorMsg = ApiClient.parseError(e)
                                                }
                                            }
                                        }
                                    )
                                }
                                    if (job.status != "running" && job.status != "queued") {
                                        TextButton(
                                            onClick = {
                                                scope.launch {
                                                    try {
                                                        viewModel.api().deleteAiJob(job.id)
                                                        loadBanksAndJobs()
                                                    } catch (e: Exception) {
                                                        errorMsg = ApiClient.parseError(e)
                                                    }
                                                }
                                            }
                                        ) {
                                            Text("删除", color = palette.textMuted, fontSize = 12.sp)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
