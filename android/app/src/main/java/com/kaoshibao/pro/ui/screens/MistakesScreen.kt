package com.kaoshibao.pro.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kaoshibao.pro.data.model.QuestionItem
import com.kaoshibao.pro.data.model.SaveNoteRequest
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
import com.kaoshibao.pro.ui.components.KsbSegmentedControl
import com.kaoshibao.pro.ui.theme.KsbTheme
import kotlinx.coroutines.launch

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MistakesScreen(
    viewModel: MainViewModel,
    onStartMistakesPractice: (mode: String) -> Unit
) {
    val palette = KsbTheme.colors
    val scope = rememberCoroutineScope()
    var activeTab by remember { mutableStateOf("mistakes") }
    var searchQuery by remember { mutableStateOf("") }
    var items by remember { mutableStateOf<List<QuestionItem>>(emptyList()) }
    var removeThreshold by remember { mutableStateOf(3) }
    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var editingNoteItem by remember { mutableStateOf<QuestionItem?>(null) }
    var editingNoteText by remember { mutableStateOf("") }

    fun load() {
        scope.launch {
            loading = true
            errorMsg = null
            try {
                val res = viewModel.api().listMistakes(
                    tab = activeTab,
                    q = searchQuery.trim().ifBlank { null }
                )
                items = res.items
                removeThreshold = res.removeThreshold
            } catch (e: Exception) {
                errorMsg = ApiClient.parseError(e)
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(activeTab) {
        load()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.canvas)
    ) {
        Box(modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
            KsbSegmentedControl(
                items = listOf(
                    "mistakes" to "错题本",
                    "favorites" to "收藏",
                    "notes" to "笔记"
                ),
                selectedKey = activeTab,
                onSelect = { activeTab = it }
            )
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = { Text("搜索题干或解析关键词...", fontSize = 13.sp, color = palette.textMuted) },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.weight(1f),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = palette.brand,
                        unfocusedBorderColor = Color.Transparent,
                        focusedContainerColor = palette.card,
                        unfocusedContainerColor = palette.card,
                        focusedTextColor = palette.textPrimary,
                        unfocusedTextColor = palette.textPrimary
                    )
                )
                KsbPrimaryButton(
                    text = "筛选",
                    onClick = { load() }
                )
            }

            if (activeTab == "mistakes" && items.isNotEmpty()) {
                KsbCard(
                    containerColor = palette.brandSoft,
                    borderColor = palette.brandBorder,
                    contentPadding = PaddingValues(12.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "共 ${items.size} 道待消灭错题",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = palette.brandDark
                            )
                            Text(
                                text = "连续答对 $removeThreshold 次自动移出错题本",
                                fontSize = 11.sp,
                                color = palette.textSecondary
                            )
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        KsbPrimaryButton(
                            text = "重练错题",
                            onClick = { onStartMistakesPractice("mistakes") }
                        )
                    }
                }
            }

            if (errorMsg != null) {
                KsbBanner(text = errorMsg ?: "", isError = true)
            }

            if (loading) {
                Box(modifier = Modifier.fillMaxSize()) {
                    KsbLoadingView("正在加载记录...")
                }
            } else if (items.isEmpty()) {
                val emptyTitle = when (activeTab) {
                    "mistakes" -> "暂无错题记录"
                    "favorites" -> "暂无收藏试题"
                    else -> "暂无学习笔记"
                }
                KsbEmptyView(
                    icon = Icons.Default.ErrorOutline,
                    title = emptyTitle,
                    subtitle = "刷题时的错题、收藏或笔记会在这里自动归集"
                )
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    contentPadding = PaddingValues(bottom = 16.dp)
                ) {
                    items(items, key = { it.id }) { q ->
                        val rec = q.record
                        val isFav = rec?.isFavorited == true
                        KsbCard(contentPadding = PaddingValues(14.dp)) {
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                                modifier = Modifier.fillMaxWidth()
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
                                if ((rec?.wrongCount ?: 0) > 0) {
                                    KsbBadge(
                                        text = "错 ${rec?.wrongCount ?: 0} 次",
                                        containerColor = palette.errorBg,
                                        contentColor = palette.error
                                    )
                                }
                            }

                            Spacer(modifier = Modifier.height(8.dp))
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
                                    val isCorrectOpt = q.answer.uppercase().contains(opt.key.uppercase())
                                    Surface(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(vertical = 2.dp),
                                        shape = RoundedCornerShape(8.dp),
                                        color = if (isCorrectOpt) palette.successBg else palette.cardElevated,
                                        border = BorderStroke(
                                            1.dp,
                                            if (isCorrectOpt) palette.success.copy(alpha = 0.45f) else palette.border
                                        )
                                    ) {
                                        Text(
                                            text = "${opt.key}. ${opt.content}",
                                            fontSize = 12.sp,
                                            color = if (isCorrectOpt) palette.success else palette.textSecondary,
                                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                                        )
                                    }
                                }
                            }

                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "参考答案：${q.answer.ifBlank { "无" }}",
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

                            if (!rec?.note.isNullOrBlank()) {
                                Spacer(modifier = Modifier.height(8.dp))
                                Surface(
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(8.dp),
                                    color = palette.warningBg
                                ) {
                                    Text(
                                        text = "我的笔记：${rec?.note}",
                                        fontSize = 12.sp,
                                        color = palette.warning,
                                        modifier = Modifier.padding(10.dp)
                                    )
                                }
                            }

                            Spacer(modifier = Modifier.height(8.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.End,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                TextButton(
                                    onClick = {
                                        editingNoteItem = q
                                        editingNoteText = rec?.note ?: ""
                                    }
                                ) {
                                    Icon(Icons.Default.EditNote, contentDescription = null, modifier = Modifier.size(16.dp), tint = palette.brand)
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("笔记", fontSize = 12.sp, color = palette.brand)
                                }
                                IconButton(
                                    onClick = {
                                        scope.launch {
                                            try {
                                                viewModel.api().toggleQuestionState(
                                                    ToggleQuestionRequest(questionId = q.id, action = "favorite")
                                                )
                                                load()
                                            } catch (e: Exception) {
                                                errorMsg = ApiClient.parseError(e)
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
                                if (activeTab == "mistakes") {
                                    IconButton(
                                        onClick = {
                                            scope.launch {
                                                try {
                                                    viewModel.api().removeFromMistakeBook(q.id)
                                                    load()
                                                } catch (e: Exception) {
                                                    errorMsg = ApiClient.parseError(e)
                                                }
                                            }
                                        }
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.DeleteOutline,
                                            contentDescription = "移出错题本",
                                            tint = palette.error
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

    val noteTarget = editingNoteItem
    if (noteTarget != null) {
        AlertDialog(
            onDismissRequest = { editingNoteItem = null },
            containerColor = palette.card,
            title = { Text("编辑学习笔记", fontWeight = FontWeight.Bold, color = palette.textPrimary) },
            text = {
                OutlinedTextField(
                    value = editingNoteText,
                    onValueChange = { editingNoteText = it },
                    placeholder = { Text("记录核心考点、口诀或易错原因...") },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = palette.brand,
                        unfocusedBorderColor = palette.borderInput,
                        focusedTextColor = palette.textPrimary,
                        unfocusedTextColor = palette.textPrimary
                    )
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        scope.launch {
                            try {
                                viewModel.api().saveNote(SaveNoteRequest(noteTarget.id, editingNoteText.trim()))
                                editingNoteItem = null
                                load()
                            } catch (e: Exception) {
                                errorMsg = ApiClient.parseError(e)
                            }
                        }
                    }
                ) {
                    Text("保存", color = palette.brand, fontWeight = FontWeight.SemiBold)
                }
            },
            dismissButton = {
                TextButton(onClick = { editingNoteItem = null }) {
                    Text("取消", color = palette.textSecondary)
                }
            }
        )
    }
}
