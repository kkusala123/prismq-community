package com.kaoshibao.pro.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kaoshibao.pro.data.model.QuestionBankSummary
import com.kaoshibao.pro.data.model.QuestionItem
import com.kaoshibao.pro.data.model.ToggleQuestionRequest
import com.kaoshibao.pro.data.model.difficultyLabel
import com.kaoshibao.pro.data.model.questionTypeLabel
import com.kaoshibao.pro.data.remote.ApiClient
import com.kaoshibao.pro.ui.MainViewModel
import com.kaoshibao.pro.ui.components.KsbBadge
import com.kaoshibao.pro.ui.components.KsbBanner
import com.kaoshibao.pro.ui.components.KsbCard
import com.kaoshibao.pro.ui.components.KsbEmptyView
import com.kaoshibao.pro.ui.components.KsbLoadingView
import com.kaoshibao.pro.ui.components.KsbPrimaryButton
import com.kaoshibao.pro.ui.theme.KsbTheme
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SearchScreen(
    viewModel: MainViewModel,
    onBack: () -> Unit
) {
    val palette = KsbTheme.colors
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var selectedBankId by remember { mutableStateOf<String?>(null) }
    var banks by remember { mutableStateOf<List<QuestionBankSummary>>(emptyList()) }
    var results by remember { mutableStateOf<List<QuestionItem>>(emptyList()) }
    var hasSearched by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            banks = viewModel.api().listBanks(scope = "mine").banks
        } catch (_: Exception) {
        }
    }

    fun doSearch() {
        val kw = query.trim()
        if (kw.isBlank()) {
            errorMsg = "请输入题干、选项或解析关键词"
            return
        }
        scope.launch {
            loading = true
            errorMsg = null
            hasSearched = true
            try {
                results = viewModel.api().searchQuestions(
                    q = kw,
                    bankId = selectedBankId
                ).items
            } catch (e: Exception) {
                errorMsg = ApiClient.parseError(e)
            } finally {
                loading = false
            }
        }
    }

    Scaffold(
        containerColor = palette.canvas,
        topBar = {
            TopAppBar(
                title = { Text("全局搜题", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = palette.textPrimary) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = palette.textPrimary)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = palette.card)
            )
        }
    ) { innerPad ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPad)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(palette.card)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        placeholder = { Text("输入题干/解析/标签关键词...", fontSize = 13.sp, color = palette.textMuted) },
                        singleLine = true,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.weight(1f),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = palette.brand,
                            unfocusedBorderColor = palette.borderInput,
                            focusedTextColor = palette.textPrimary,
                            unfocusedTextColor = palette.textPrimary
                        )
                    )
                    KsbPrimaryButton(text = "搜索", onClick = { doSearch() })
                }

                if (banks.isNotEmpty()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        FilterChip(
                            selected = selectedBankId == null,
                            onClick = {
                                selectedBankId = null
                                if (query.isNotBlank()) doSearch()
                            },
                            label = { Text("全部题库", fontSize = 11.sp) },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = palette.brandSoft,
                                selectedLabelColor = palette.brandDark
                            )
                        )
                        banks.forEach { b ->
                            FilterChip(
                                selected = selectedBankId == b.id,
                                onClick = {
                                    selectedBankId = b.id
                                    if (query.isNotBlank()) doSearch()
                                },
                                label = { Text(b.title.take(12), fontSize = 11.sp) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = palette.brandSoft,
                                    selectedLabelColor = palette.brandDark
                                )
                            )
                        }
                    }
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                if (errorMsg != null) {
                    KsbBanner(text = errorMsg ?: "", isError = true)
                }

                if (loading) {
                    KsbLoadingView("正在全库检索...")
                } else if (!hasSearched) {
                    KsbEmptyView(
                        icon = Icons.Default.Search,
                        title = "极速搜题",
                        subtitle = "输入任意题目片段即可即时检索题库答案与解析"
                    )
                } else if (results.isEmpty()) {
                    KsbEmptyView(
                        icon = Icons.Default.Search,
                        title = "未找到匹配试题",
                        subtitle = "试试更换更短的关键词或切换题库范围"
                    )
                } else {
                    Text(
                        text = "共检索到 ${results.size} 道相关试题",
                        fontSize = 12.sp,
                        color = palette.textSecondary
                    )
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                        contentPadding = PaddingValues(bottom = 16.dp)
                    ) {
                        items(results, key = { it.id }) { q ->
                            val isFav = q.record?.isFavorited == true
                            KsbCard(contentPadding = PaddingValues(14.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    FlowRow(
                                        modifier = Modifier.weight(1f),
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                        verticalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        KsbBadge(text = questionTypeLabel(q.type))
                                        KsbBadge(
                                            text = difficultyLabel(q.difficulty),
                                            containerColor = palette.cardElevated,
                                            contentColor = palette.textSecondary
                                        )
                                        if (q.starRating > 0) {
                                            KsbBadge(
                                                text = "${q.starRating}★",
                                                containerColor = palette.warningBg,
                                                contentColor = palette.warning
                                            )
                                        }
                                        if (!q.bankTitle.isNullOrBlank()) {
                                            KsbBadge(
                                                text = q.bankTitle,
                                                containerColor = palette.cardElevated,
                                                contentColor = palette.textSecondary
                                            )
                                        }
                                    }
                                    IconButton(
                                        onClick = {
                                            scope.launch {
                                                try {
                                                    val res = viewModel.api().toggleQuestionState(
                                                        ToggleQuestionRequest(q.id, "favorite")
                                                    )
                                                    results = results.map { item ->
                                                        if (item.id == q.id) {
                                                            val prevRec = item.record
                                                            item.copy(
                                                                record = prevRec?.copy(isFavorited = res.isFavorited)
                                                            )
                                                        } else item
                                                    }
                                                } catch (_: Exception) {
                                                }
                                            }
                                        }
                                    ) {
                                        Icon(
                                            imageVector = if (isFav) Icons.Default.Bookmark else Icons.Default.BookmarkBorder,
                                            contentDescription = "收藏",
                                            tint = if (isFav) palette.warning else palette.textMuted
                                        )
                                    }
                                }

                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = q.stem,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = palette.textPrimary,
                                    lineHeight = 20.sp
                                )

                                if (q.options.isNotEmpty()) {
                                    Spacer(modifier = Modifier.height(8.dp))
                                    q.options.forEach { opt ->
                                        val isAns = q.answer.uppercase().contains(opt.key.uppercase())
                                        Surface(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(vertical = 2.dp),
                                            shape = RoundedCornerShape(8.dp),
                                            color = if (isAns) palette.successBg else palette.cardElevated,
                                            border = BorderStroke(
                                                1.dp,
                                                if (isAns) palette.success.copy(alpha = 0.45f) else palette.border
                                            )
                                        ) {
                                            Text(
                                                text = "${opt.key}. ${opt.content}",
                                                fontSize = 12.sp,
                                                color = if (isAns) palette.success else palette.textSecondary,
                                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                                            )
                                        }
                                    }
                                }

                                Spacer(modifier = Modifier.height(8.dp))
                                Text(
                                    text = "标准答案：${q.answer.ifBlank { "无" }}",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = palette.success
                                )
                                if (q.explanation.isNotBlank()) {
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Text(
                                        text = "解析：${q.explanation}",
                                        fontSize = 12.sp,
                                        color = palette.textSecondary,
                                        lineHeight = 18.sp
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
