const auth = require('../../utils/auth');
const service = require('../../utils/service');
const util = require('../../utils/util');
const codeFormat = require('../../utils/codeFormat');

Page({
    data: {
        authState: 'checking',
        authError: '',
        loading: true,
        errorText: '',
        bankId: '',
        mode: 'sequential',
        sortBy: 'default',
        shuffleQuestions: false,
        chapterId: '',
        type: '',
        recite: false,
        startId: '',

        questions: [],
        total: 0,
        index: 0,

        current: null,
        stemSegments: [],
        explainSegments: [],
        currentOptions: [],
        currentAnswer: '',
        currentJudged: null,
        showAnswer: false,
        isFavorite: false,
        typeLabel: '',

        answers: {},
        judgedMap: {},
        cardItems: [],
        showCard: false,
        answeredCount: 0,
        correctCount: 0,
        accuracy: 0,

        showFinishModal: false,
        finishTitle: '',
        finishDesc: '',
        finishAccuracy: 0,
        finishAnswered: 0,
        finishCorrect: 0,
        finishTotal: 0,

        progressText: '',
        progressPercent: 0,
        submitting: false,
        modeLabel: '',
        starText: '',
        slideDir: '',
        stageWidth: 375,
        aiExplainMap: {},
        aiErrorMap: {},
        aiSavedMap: {},
        currentAiExplain: null,
        currentAiAnalysisSegments: [],
        aiLoading: false,
        aiError: '',
        aiSaved: false,
    },

    onLoad(options) {
        const opts = options || {};
        const rawMode = opts.mode || 'sequential';
        const shuffle = String(opts.shuffle || '') === '1' || rawMode === 'random';
        const initialSort =
            opts.sortBy ||
            (rawMode === 'difficulty_asc' || rawMode === 'difficulty_desc' ? rawMode : 'default');
        let width = 375;
        try {
            const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
            width = (info && info.windowWidth) || 375;
        } catch (e) {
            width = 375;
        }
        this.lastCardIndex = -1;
        this.completionShown = false;
        this.setData({
            bankId: opts.bankId || '',
            mode: rawMode,
            sortBy: initialSort,
            shuffleQuestions: shuffle,
            chapterId: opts.chapterId || '',
            type: opts.type || '',
            recite: String(opts.recite || '') === '1',
            startId: opts.startId || '',
            modeLabel: this.getModeLabel(rawMode, opts.recite, initialSort, shuffle),
            stageWidth: width,
        });
        this.pendingLoad = true;
    },

    onShow() {
        this.restore();
    },

    onHide() {
        this.clearAutoNext();
        this.clearSlide();
        this.flushSaveProgress();
    },

    onUnload() {
        this.clearAutoNext();
        this.clearSlide();
        this.flushSaveProgress();
    },

    restore() {
        auth.restore(this, () => this.loadIfPending());
    },

    onSignedIn() {
        this.pendingLoad = true;
        auth.signedIn(this, () => this.loadIfPending());
    },

    loadIfPending() {
        if (!this.pendingLoad) return;
        this.pendingLoad = false;
        this.loadSession();
    },

    clearSignedOutData() {
        this.pendingLoad = false;
        this.lastCardIndex = -1;
        this.setData({ questions: [], total: 0, current: null, cardItems: [], errorText: '', progressPercent: 0 });
    },

    getModeLabel(mode, recite, sortBy, shuffle) {
        if (String(recite || '') === '1') return '背题模式';
        if (shuffle) return '乱序出题';
        if (sortBy === 'difficulty_asc') return '由易到难';
        if (sortBy === 'difficulty_desc') return '由难到易';
        if (mode === 'random') return '随机练习';
        if (mode === 'unlearned' || mode === 'unmastered') return '只练未掌握';
        if (mode === 'mistakes') return '错题重练';
        if (mode === 'favorites') return '收藏练习';
        if (mode === 'unanswered') return '只练未作答';
        return '顺序练习';
    },

    effectiveProgressMode() {
        return this.data.sortBy && this.data.sortBy !== 'default'
            ? this.data.sortBy
            : this.data.mode;
    },

    changeSortBy(e) {
        const nextSort = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.sort) || 'default');
        if (nextSort === this.data.sortBy && !this.data.shuffleQuestions) return;
        this.clearAutoNext();
        this.clearSlide();
        this.flushSaveProgress();
        this.setData({
            sortBy: nextSort,
            shuffleQuestions: false,
            modeLabel: this.getModeLabel(this.data.mode, this.data.recite ? '1' : '', nextSort, false),
        });
        this.loadSession();
    },

    toggleShuffle() {
        const next = !this.data.shuffleQuestions;
        this.clearAutoNext();
        this.clearSlide();
        this.flushSaveProgress();
        this.setData({
            shuffleQuestions: next,
            modeLabel: this.getModeLabel(this.data.mode, this.data.recite ? '1' : '', this.data.sortBy, next),
        });
        this.loadSession();
    },

    reshuffleNow() {
        this.clearAutoNext();
        this.clearSlide();
        this.setData({
            shuffleQuestions: true,
            showFinishModal: false,
            modeLabel: this.getModeLabel(this.data.mode, this.data.recite ? '1' : '', this.data.sortBy, true),
        });
        this.loadSession();
    },

    loadSession() {
        this.setData({ loading: true, errorText: '', showFinishModal: false });
        this.completionShown = false;
        this.progressCleared = false;
        service
            .fetchSession({
                bankId: this.data.bankId,
                mode: this.data.mode,
                sortBy: this.data.sortBy,
                shuffleQuestions: this.data.shuffleQuestions,
                chapterId: this.data.chapterId,
                type: this.data.type,
            })
            .then((res) => {
                const list = (res && res.questions) || [];
                if (list.length === 0) {
                    this.lastCardIndex = -1;
                    this.setData({ loading: false, questions: [], total: 0, cardItems: [], progressPercent: 0 });
                    return;
                }

                let startIndex = 0;
                if (this.data.startId) {
                    for (let i = 0; i < list.length; i += 1) {
                        if (list[i].id === this.data.startId) {
                            startIndex = i;
                            break;
                        }
                    }
                } else {
                    const canResume =
                        this.canTrackMode() && !this.data.chapterId && !this.data.type;
                    const preferred =
                        res.lastProgressIndex >= 0 && res.lastProgressIndex < list.length
                            ? res.lastProgressIndex
                            : res.nextUnansweredIndex >= 0 && res.nextUnansweredIndex < list.length
                            ? res.nextUnansweredIndex
                            : 0;
                    if (canResume) {
                        startIndex = preferred;
                    }
                }

                const restoredAnswers = {};
                const restoredJudged = {};
                const cardItems = [];
                let answered = 0;
                let correct = 0;
                for (let i = 0; i < list.length; i += 1) {
                    const item = list[i];
                    let cellState = 'todo';
                    if (item && item.record && Number(item.record.answeredCount) > 0 && item.record.lastAnswer) {
                        const ok = !!item.record.lastCorrect;
                        restoredAnswers[item.id] = String(item.record.lastAnswer);
                        restoredJudged[item.id] = {
                            isCorrect: ok,
                            standardAnswer: String(item.answer || ''),
                            explanation: String(item.explanation || ''),
                            removed: false,
                        };
                        cellState = ok ? 'right' : 'wrong';
                        answered += 1;
                        if (ok) correct += 1;
                    }
                    cardItems.push({
                        no: i + 1,
                        state: cellState,
                        current: i === startIndex,
                        index: i,
                    });
                }

                this.lastCardIndex = startIndex;
                this.setData({
                    loading: false,
                    questions: list,
                    total: list.length,
                    index: startIndex,
                    answers: restoredAnswers,
                    judgedMap: restoredJudged,
                    cardItems: cardItems,
                    answeredCount: answered,
                    correctCount: correct,
                    accuracy: answered > 0 ? Math.round((correct / answered) * 100) : 0,
                });
                this.buildView(false);
            })
            .catch((err) => {
                this.setData({ loading: false, errorText: (err && err.message) || '题目加载失败' });
            });
    },

    /* 仅传输当前题目视图与 2 个增量答题卡格子的变更，避免大题库全量序列化阻塞 120fps 滑动 */
    buildView(updateStats) {
        const list = this.data.questions;
        const index = this.data.index;
        const q = list[index];

        if (!q) {
            this.setData({ current: null, progressPercent: 0 });
            return;
        }

        const answerStr = String(this.data.answers[q.id] || '');
        const judged = this.data.judgedMap[q.id] || null;
        const showAnswer = !!judged || this.data.recite;
        const standard = judged ? String(judged.standardAnswer) : String(q.answer || '');

        const options = (q.options || []).map((o) => {
            const selected = answerStr.indexOf(o.key) >= 0;
            let state = '';
            if (judged) {
                if (standard.indexOf(o.key) >= 0) {
                    state = 'correct';
                } else if (selected) {
                    state = 'wrong';
                }
            } else if (selected) {
                state = 'selected';
            }
            return { key: o.key, content: o.content, selected: selected, state: state };
        });

        const expText = judged ? judged.explanation : q.explanation;
        const aiRes = (this.data.aiExplainMap && this.data.aiExplainMap[q.id]) || null;
        const aiErr = (this.data.aiErrorMap && this.data.aiErrorMap[q.id]) || '';
        const aiSaved = !!(this.data.aiSavedMap && this.data.aiSavedMap[q.id]);
        const patch = {
            current: q,
            stemSegments: codeFormat.parseRichSegments(q.stem),
            explainSegments: codeFormat.parseRichSegments(expText),
            currentOptions: options,
            currentAnswer: answerStr,
            currentJudged: judged,
            showAnswer: showAnswer,
            isFavorite: !!(q.record && q.record.isFavorited),
            typeLabel: util.TYPE_LABELS[q.type] || '题目',
            starText: Number(q.starRating || 0) > 0 ? '★ ' + Number(q.starRating) + ' 星' : '',
            progressText: index + 1 + ' / ' + list.length,
            // 进度条宽度由逻辑层算好，避免 WXML 内联 style 里出现三元表达式的冒号
            // （开发者工具会把 style 当 CSS 解析，报 semi-colon expected）
            progressPercent:
                list.length > 0
                    ? Math.max(0, Math.min(100, Math.round(((index + 1) / list.length) * 10000) / 100))
                    : 0,
            currentAiExplain: aiRes,
            currentAiAnalysisSegments:
                aiRes && aiRes.analysis ? codeFormat.parseRichSegments(aiRes.analysis) : [],
            aiLoading: this.aiLoadingId === q.id,
            aiError: aiErr,
            aiSaved: aiSaved,
        };

        if (this.lastCardIndex !== index && list.length > 0) {
            if (this.lastCardIndex >= 0 && this.lastCardIndex < list.length) {
                patch['cardItems[' + this.lastCardIndex + '].current'] = false;
            }
            patch['cardItems[' + index + '].current'] = true;
            this.lastCardIndex = index;
        }

        if (updateStats) {
            const keys = Object.keys(this.data.judgedMap);
            const answered = keys.length;
            let correct = 0;
            for (let i = 0; i < keys.length; i += 1) {
                if (this.data.judgedMap[keys[i]].isCorrect) correct += 1;
            }
            patch.answeredCount = answered;
            patch.correctCount = correct;
            patch.accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;
            if (judged) {
                patch['cardItems[' + index + '].state'] = judged.isCorrect ? 'right' : 'wrong';
            }
        }

        this.setData(patch);
    },

    tapOption(e) {
        const q = this.data.current;
        if (!q) return;

        if (this.data.judgedMap[q.id] || this.data.recite) {
            return;
        }

        const key = e.currentTarget.dataset.key;
        const answers = Object.assign({}, this.data.answers);

        if (q.type === 'multiple') {
            const arr = String(answers[q.id] || '').split('');
            const pos = arr.indexOf(key);
            if (pos >= 0) {
                arr.splice(pos, 1);
            } else {
                arr.push(key);
            }
            arr.sort();
            answers[q.id] = arr.join('');
            this.setData({ answers: answers });
            this.buildView(false);
            return;
        }

        answers[q.id] = key;
        this.setData({ answers: answers });
        this.buildView(false);
        this.judgeCurrent();
    },

    onFillInput(e) {
        const q = this.data.current;
        if (!q || this.data.judgedMap[q.id]) return;
        const answers = Object.assign({}, this.data.answers);
        answers[q.id] = e.detail.value;
        this.setData({ answers: answers, currentAnswer: e.detail.value });
    },

    submitCurrent() {
        const q = this.data.current;
        if (!q) return;
        const ans = String(this.data.answers[q.id] || '').trim();
        if (!ans) {
            wx.showToast({ title: '请先作答', icon: 'none' });
            return;
        }
        this.judgeCurrent();
    },

    judgeCurrent() {
        const q = this.data.current;
        if (!q) return;
        if (this.data.judgedMap[q.id]) return;
        if (this.data.recite) return;

        const ans = String(this.data.answers[q.id] || '').trim();
        if (!ans) return;
        if (this.data.submitting) return;

        const curIdx = this.data.index;
        this.setData({ submitting: true });
        service
            .submitAnswer({
                questionId: q.id,
                answer: ans,
                currentIndex: curIdx,
                mode: this.effectiveProgressMode(),
                bankId: this.data.bankId,
            })
            .then((res) => {
                const judgedMap = Object.assign({}, this.data.judgedMap);
                judgedMap[q.id] = {
                    isCorrect: !!res.isCorrect,
                    standardAnswer: res.standardAnswer,
                    explanation: res.explanation,
                    removed: !!res.removedFromMistakeBook,
                };

                const questions = this.data.questions.slice();
                const target = questions[curIdx];
                if (target && target.id === q.id && res.record) {
                    target.record = res.record;
                }

                this.setData({ judgedMap: judgedMap, questions: questions, submitting: false });
                this.buildView(true);

                if (res.removedFromMistakeBook) {
                    wx.showToast({ title: '已掌握，移出错题本', icon: 'none' });
                }

                const doneAll = Object.keys(judgedMap).length >= this.data.total && this.data.total > 0;
                const isLast = curIdx >= this.data.total - 1;
                if ((doneAll || isLast) && !this.completionShown) {
                    this.completionShown = true;
                    this.progressCleared = true;
                    setTimeout(() => {
                        this.openFinishModal();
                    }, 360);
                    return;
                }
                this.progressCleared = false;

                if (
                    res.isCorrect &&
                    !this.data.recite &&
                    curIdx < this.data.total - 1 &&
                    this.autoNextEnabled()
                ) {
                    this.scheduleAutoNext(curIdx);
                }
            })
            .catch((err) => {
                this.setData({ submitting: false });
                wx.showToast({ title: (err && err.message) || '判题失败', icon: 'none' });
            });
    },

    onSwipeStart() {
        this.clearAutoNext();
    },

    onSwipeCommit(payload) {
        const dir = payload && payload.dir === 'prev' ? 'prev' : 'next';
        this.clearAutoNext();
        if (dir === 'next') {
            if (this.data.index >= this.data.total - 1) return;
            this.setData({ index: this.data.index + 1 });
        } else {
            if (this.data.index <= 0) return;
            this.setData({ index: this.data.index - 1 });
        }
        this.buildView(false);
        this.scheduleSaveProgress();
    },

    canTrackMode() {
        const m = this.data.mode;
        return m === 'sequential' || m === 'difficulty_asc' || m === 'difficulty_desc';
    },

    canTrackProgress() {
        return !!(
            this.data.bankId &&
            this.canTrackMode() &&
            !this.data.shuffleQuestions &&
            !this.data.chapterId &&
            !this.data.type &&
            this.data.total > 0
        );
    },

    scheduleSaveProgress() {
        if (!this.canTrackProgress()) return;
        this.progressDirty = true;
        if (this.progressTimer) {
            clearTimeout(this.progressTimer);
        }
        this.progressTimer = setTimeout(() => {
            this.progressTimer = null;
            this.progressDirty = false;
            if (!this.canTrackProgress()) return;
            service
                .saveProgress(this.data.bankId, this.data.index, this.effectiveProgressMode())
                .catch(function () {});
        }, 500);
    },

    flushSaveProgress() {
        if (this.progressTimer) {
            clearTimeout(this.progressTimer);
            this.progressTimer = null;
        }
        if (this.progressCleared || !this.progressDirty || !this.canTrackProgress()) return;
        this.progressDirty = false;
        service
            .saveProgress(this.data.bankId, this.data.index, this.effectiveProgressMode())
            .catch(function () {});
    },

    clearSlide() {
        if (this.slideTimer) {
            clearTimeout(this.slideTimer);
            this.slideTimer = null;
        }
    },

    slideTo(index, dir) {
        this.clearSlide();
        this.progressCleared = false;
        this.setData({ index: index, slideDir: dir });
        this.buildView(false);
        this.scheduleSaveProgress();
        this.slideTimer = setTimeout(() => {
            this.slideTimer = null;
            this.setData({ slideDir: '' });
        }, 200);
    },

    clearAutoNext() {
        if (this.autoNextTimer) {
            clearTimeout(this.autoNextTimer);
            this.autoNextTimer = null;
        }
    },

    autoNextEnabled() {
        const user = service.getUser() || {};
        const settings = user.settings || {};
        return settings.autoNextOnCorrect !== false;
    },

    autoNextDelay() {
        const user = service.getUser() || {};
        const settings = user.settings || {};
        const raw = Number(settings.autoNextDelayMs);
        if (isFinite(raw) && raw >= 150 && raw <= 2500) return raw;
        return 650;
    },

    scheduleAutoNext(fromIndex) {
        this.clearAutoNext();
        const delay = this.autoNextDelay();
        this.autoNextTimer = setTimeout(() => {
            this.autoNextTimer = null;
            if (this.data.recite) return;
            if (this.data.index !== fromIndex) return;
            if (this.data.index >= this.data.total - 1) return;
            this.slideTo(this.data.index + 1, 'next');
        }, delay);
    },

    toggleFavorite() {
        const q = this.data.current;
        if (!q) return;

        service
            .toggleQuestion({ questionId: q.id, action: 'favorite' })
            .then((res) => {
                const questions = this.data.questions.slice();
                questions.forEach(function (item) {
                    if (item.id === q.id) {
                        item.record = Object.assign({}, item.record || {}, {
                            isFavorited: res.isFavorited,
                        });
                    }
                });
                this.setData({ questions: questions });
                this.buildView(false);
                wx.showToast({ title: res.isFavorited ? '已收藏' : '已取消收藏', icon: 'none' });
            })
            .catch((err) => {
                wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
            });
    },

    prevQuestion() {
        this.clearAutoNext();
        if (this.data.index <= 0) {
            wx.showToast({ title: '已经是第一题', icon: 'none' });
            return;
        }
        this.slideTo(this.data.index - 1, 'prev');
    },

    nextQuestion() {
        this.clearAutoNext();
        if (this.data.index >= this.data.total - 1) {
            this.openFinishModal();
            return;
        }
        this.slideTo(this.data.index + 1, 'next');
    },

    noop() {},

    goBack() {
        wx.navigateBack({ delta: 1 });
    },

    openCard() {
        this.setData({ showCard: true });
    },

    closeCard() {
        this.setData({ showCard: false });
    },

    jumpTo(e) {
        this.clearAutoNext();
        const index = Number(e.currentTarget.dataset.index);
        if (isNaN(index)) return;
        const from = this.data.index;
        this.setData({ showCard: false });
        if (index === from) {
            this.buildView(false);
            return;
        }
        this.slideTo(index, index > from ? 'next' : 'prev');
    },

    openFinishModal() {
        const answered = Object.keys(this.data.judgedMap).length;
        const correct = this.data.correctCount;
        const rate = answered > 0 ? Math.round((correct / answered) * 100) : 0;
        let title = '太棒了！又完成一轮刷题';
        let desc = '保持这份节奏，每一次复盘都在靠近满分！';
        if (rate >= 90 && answered > 0) {
            title = '表现惊艳！高分收官';
            desc = '正确率高达 ' + rate + '%，知识点掌握得非常扎实，继续保持！';
        } else if (rate >= 70) {
            title = '干得漂亮！稳步进阶';
            desc = '本轮正确率 ' + rate + '%，再把错题巩固一遍就更稳了！';
        } else if (answered === 0) {
            title = '已浏览完本轮全部题目';
            desc = '随时可以再来一轮或切换到背题模式巩固记忆！';
        } else {
            title = '坚持就是胜利！';
            desc = '万事开头难，复盘一下解析再来一轮，进步会非常明显！';
        }

        this.progressCleared = true;
        if (this.progressTimer) {
            clearTimeout(this.progressTimer);
            this.progressTimer = null;
        }
        this.progressDirty = false;
        if (this.data.total > 0) {
            service
                .resetProgress({
                    bankId: this.data.bankId,
                    mode: this.effectiveProgressMode(),
                    questionIds:
                        this.data.bankId === 'all'
                            ? this.data.questions.map(function (q) {
                                  return q.id;
                              })
                            : undefined,
                })
                .catch(function () {});
        }

        this.setData({
            showCard: false,
            showFinishModal: true,
            finishTitle: title,
            finishDesc: desc,
            finishAccuracy: rate,
            finishAnswered: answered,
            finishCorrect: correct,
            finishTotal: this.data.total,
        });
    },

    closeFinishModal() {
        this.setData({ showFinishModal: false });
    },

    confirmFinishBack() {
        this.setData({ showFinishModal: false });
        wx.navigateBack({ delta: 1 });
    },

    confirmResetProgress() {
        const total = this.data.total;
        if (!total) return;
        wx.showModal({
            title: '一键重刷',
            content: '确认清空当前刷题进度并从第 1 题重新开始吗？（收藏、笔记与错题本不受影响）',
            confirmText: '确认重刷',
            success: (res) => {
                if (!res.confirm) return;
                this.clearAutoNext();
                this.clearSlide();
                if (this.progressTimer) {
                    clearTimeout(this.progressTimer);
                    this.progressTimer = null;
                }
                this.progressDirty = false;
                this.progressCleared = true;
                service
                    .resetProgress({
                        bankId: this.data.bankId,
                        mode: this.effectiveProgressMode(),
                        questionIds:
                            this.data.bankId === 'all'
                                ? this.data.questions.map(function (q) {
                                      return q.id;
                                  })
                                : undefined,
                    })
                    .then(() => {
                        if (this.data.shuffleQuestions) {
                            this.reshuffleNow();
                        } else {
                            this.repeatPractice();
                        }
                    })
                    .catch((err) => {
                        wx.showToast({
                            title: (err && err.message) || '重置进度失败',
                            icon: 'none',
                        });
                    });
            },
        });
    },

    repeatPractice() {
        this.clearAutoNext();
        this.clearSlide();
        this.completionShown = false;
        this.progressCleared = false;
        const list = (this.data.questions || []).map(function (q) {
            if (!q || !q.record) return q;
            return Object.assign({}, q, {
                record: Object.assign({}, q.record, {
                    answeredCount: 0,
                    lastAnswer: null,
                    lastIsCorrect: null,
                }),
            });
        });
        const resetCards = list.map(function (q, i) {
            return { no: i + 1, state: 'todo', current: i === 0, index: i };
        });
        this.lastCardIndex = 0;
        this.setData({
            showFinishModal: false,
            questions: list,
            index: 0,
            answers: {},
            judgedMap: {},
            cardItems: resetCards,
            answeredCount: 0,
            correctCount: 0,
            accuracy: 0,
            slideDir: '',
        });
        this.buildView(false);
        if (this.canTrackProgress()) {
            service
                .saveProgress(this.data.bankId, 0, this.effectiveProgressMode())
                .catch(function () {});
        }
        wx.showToast({ title: '已开启新一轮作答', icon: 'none' });
    },

    copyCodeBlock(e) {
        const code = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.code) || '';
        if (!code) return;
        wx.setClipboardData({
            data: code,
            success: () => wx.showToast({ title: '已复制代码', icon: 'success' }),
        });
    },

    askAiExplain(e) {
        const q = this.data.current;
        if (!q || this.aiLoadingId === q.id) return;
        const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
        const saveToQuestion = String(ds.save || '') === '1';
        const qid = q.id;
        const nextErrMap = Object.assign({}, this.data.aiErrorMap);
        delete nextErrMap[qid];

        this.aiLoadingId = qid;
        this.setData({
            aiLoading: true,
            aiError: '',
            aiErrorMap: nextErrMap,
        });

        service
            .explainQuestion({
                questionId: qid,
                userAnswer: this.data.currentAnswer || '',
                saveToQuestion: saveToQuestion,
                type: q.type,
                stem: q.stem,
                options: q.options || [],
                answer:
                    (this.data.currentJudged && this.data.currentJudged.standardAnswer) ||
                    q.answer ||
                    '',
                explanation:
                    (this.data.currentJudged && this.data.currentJudged.explanation) ||
                    q.explanation ||
                    '',
            })
            .then((res) => {
                const nextExplainMap = Object.assign({}, this.data.aiExplainMap);
                nextExplainMap[qid] = {
                    keyPoint: (res && res.keyPoint) || '',
                    analysis: (res && res.analysis) || '',
                    mnemonic: (res && res.mnemonic) || '',
                };
                const nextSavedMap = Object.assign({}, this.data.aiSavedMap);
                if (saveToQuestion) {
                    nextSavedMap[qid] = true;
                    wx.showToast({ title: '已写入题库解析', icon: 'success' });
                }
                this.setData({
                    aiExplainMap: nextExplainMap,
                    aiSavedMap: nextSavedMap,
                });
            })
            .catch((err) => {
                const msg = (err && err.message) || 'AI 解析生成失败';
                const errMap = Object.assign({}, this.data.aiErrorMap);
                errMap[qid] = msg;
                this.setData({ aiErrorMap: errMap });
                wx.showToast({ title: msg, icon: 'none' });
            })
            .then(() => {
                if (this.aiLoadingId === qid) {
                    this.aiLoadingId = '';
                }
                this.buildView(false);
            });
    },

    finish() {
        this.openFinishModal();
    },

    retry() {
        this.loadSession();
    },
});
