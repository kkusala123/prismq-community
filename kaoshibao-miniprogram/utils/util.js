const TYPE_LABELS = {
    single: '单选题',
    multiple: '多选题',
    boolean: '判断题',
    fill: '填空题',
    short: '简答题',
};

function normalize(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/\s+/g, '')
        .replace(/[，。；、,.;:]/g, '')
        .toUpperCase();
}

function sortChars(value) {
    return String(value || '').split('').sort().join('');
}

/**
 * 本地判题：与后端 grader 保持一致的宽松策略
 * @returns {{isCorrect: boolean, standardAnswer: string, userAnswer: string}}
 */
function gradeAnswer(type, standardAnswer, userAnswer) {
    const standard = String(standardAnswer || '');
    const answer = String(userAnswer || '');
    if (!answer.trim()) {
        return { isCorrect: false, standardAnswer: standard, userAnswer: answer };
    }

    let isCorrect = false;
    if (type === 'multiple') {
        isCorrect = sortChars(normalize(answer)) === sortChars(normalize(standard));
    } else if (type === 'fill') {
        const standards = standard.split(/[\/|｜]/).map(normalize).filter(Boolean);
        isCorrect = standards.indexOf(normalize(answer)) >= 0;
    } else if (type === 'short') {
        isCorrect = false;
    } else {
        isCorrect = normalize(answer) === normalize(standard);
    }

    return { isCorrect: isCorrect, standardAnswer: standard, userAnswer: answer };
}

function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = function (n) {
        return n < 10 ? '0' + n : String(n);
    };
    if (h > 0) {
        return pad(h) + ':' + pad(m) + ':' + pad(s);
    }
    return pad(m) + ':' + pad(s);
}

function formatDate(input) {
    if (!input) return '';
    const d = new Date(input);
    if (isNaN(d.getTime())) return '';
    const pad = function (n) {
        return n < 10 ? '0' + n : String(n);
    };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function percent(part, total) {
    const t = Number(total) || 0;
    if (t <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((Number(part) / t) * 100)));
}

function shuffle(list) {
    const copy = (list || []).slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
    }
    return copy;
}

function truncate(text, max) {
    const str = String(text || '');
    const limit = max || 40;
    if (str.length <= limit) return str;
    return str.slice(0, limit) + '…';
}

module.exports = {
    TYPE_LABELS: TYPE_LABELS,
    gradeAnswer: gradeAnswer,
    formatDuration: formatDuration,
    formatDate: formatDate,
    percent: percent,
    shuffle: shuffle,
    truncate: truncate,
};
