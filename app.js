// Инициализация иконок Lucide
lucide.createIcons();

// =====================================================================
// НАСТРОЙКИ ЛИМИТОВ И API
// =====================================================================
const DAILY_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 часа в миллисекундах
const STORAGE_KEY = 'legitcheck_last_free_usage_ts';
const VIP_STORAGE_KEY = 'legitcheck_vip_unlocked';
const VIP_CODE_STORAGE_KEY = 'legitcheck_vip_code';
const MAX_PHOTOS = 4;
const MAX_IMAGE_SIDE = 1280; // сжатие фото, чтобы уложиться в лимит тела запроса Vercel (4.5 МБ)

// Состояние приложения
let uploadedImages = []; // массив объектов { base64, mimeType, dataUrl }
let currentAnalysisContext = null; // сохраняем результат для follow-up вопросов
let countdownTimerId = null;


// =====================================================================
// ЗАГРУЗКА ФОТО
// =====================================================================
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const previewsContainer = document.getElementById('image-previews');
const photoCountEl = document.getElementById('photo-count');

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
    dropZone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }, false);
});
['dragenter', 'dragover'].forEach(ev => {
    dropZone.addEventListener(ev, () => dropZone.classList.add('border-blue-500', 'bg-blue-500/5'), false);
});
['dragleave', 'drop'].forEach(ev => {
    dropZone.addEventListener(ev, () => dropZone.classList.remove('border-blue-500', 'bg-blue-500/5'), false);
});
dropZone.addEventListener('drop', e => handleFiles(e.dataTransfer.files), false);
fileInput.addEventListener('change', function () {
    handleFiles(this.files);
    this.value = '';
});

// Сжатие изображения через canvas -> JPEG
function compressImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
            width = Math.round(width * scale);
            height = Math.round(height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
            URL.revokeObjectURL(url);
            resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg', dataUrl });
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение')); };
        img.src = url;
    });
}

async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) {
        if (fileList && fileList.length) showToast('Выберите файлы изображений (PNG, JPG, WEBP)', 'warning');
        return;
    }
    const free = MAX_PHOTOS - uploadedImages.length;
    if (free <= 0) {
        showToast(`Максимум ${MAX_PHOTOS} фото`, 'warning');
        return;
    }
    if (files.length > free) showToast(`Добавлено только ${free} из ${files.length} фото (лимит ${MAX_PHOTOS})`, 'warning');
    for (const file of files.slice(0, free)) {
        try {
            uploadedImages.push(await compressImage(file));
        } catch (err) {
            showToast('Не удалось обработать одно из фото (формат HEIC не везде поддерживается)', 'error');
        }
    }
    renderPreviews();
}

function removeImage(index) {
    uploadedImages.splice(index, 1);
    renderPreviews();
}

function renderPreviews() {
    photoCountEl.textContent = `${uploadedImages.length} / ${MAX_PHOTOS}`;
    if (uploadedImages.length === 0) {
        previewsContainer.classList.add('hidden');
        previewsContainer.innerHTML = '';
        return;
    }
    previewsContainer.classList.remove('hidden');
    previewsContainer.innerHTML = uploadedImages.map((img, i) => `
        <div class="relative aspect-square rounded-xl overflow-hidden border border-zinc-800 bg-dark-900 group">
            <img src="${img.dataUrl}" alt="Фото ${i + 1}" class="w-full h-full object-cover">
            <button type="button" onclick="removeImage(${i})" aria-label="Удалить фото"
                class="absolute top-1.5 right-1.5 w-7 h-7 rounded-lg bg-black/70 hover:bg-red-600 text-white flex items-center justify-center transition-colors">
                <i data-lucide="x" class="w-4 h-4"></i>
            </button>
        </div>
    `).join('');
    lucide.createIcons();
}

// =====================================================================
// УВЕДОМЛЕНИЯ И СЕТЬ
// =====================================================================
function showToast(message, type = 'info') {
    const styles = {
        success: 'border-emerald-500/30 bg-emerald-950/90 text-emerald-200',
        error: 'border-red-500/30 bg-red-950/90 text-red-200',
        warning: 'border-amber-500/30 bg-amber-950/90 text-amber-200',
        info: 'border-blue-500/30 bg-blue-950/90 text-blue-200'
    };
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `pointer-events-auto border rounded-xl px-4 py-3 text-sm shadow-xl backdrop-blur transition-all duration-300 opacity-0 translate-x-4 ${styles[type] || styles.info}`;
    el.textContent = message;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.remove('opacity-0', 'translate-x-4'));
    setTimeout(() => {
        el.classList.add('opacity-0', 'translate-x-4');
        setTimeout(() => el.remove(), 300);
    }, 4500);
}

// fetch с повторами при 429 / 5xx и разбором JSON
async function fetchWithRetry(url, options, retries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, options);
            if (res.ok) return await res.json();
            const err = new Error(`HTTP ${res.status}`);
            err.status = res.status;
            if (res.status !== 429 && res.status < 500) throw err;
            lastError = err;
        } catch (err) {
            if (err.status && err.status !== 429 && err.status < 500) throw err;
            lastError = err;
        }
        if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
    throw lastError;
}

// Проверка статуса дневного лимита пользователя
function isVipUnlocked() {
    return localStorage.getItem(VIP_STORAGE_KEY) === 'true' && !!localStorage.getItem(VIP_CODE_STORAGE_KEY);
}

function getVipCode() {
    return isVipUnlocked() ? localStorage.getItem(VIP_CODE_STORAGE_KEY) : '';
}

function getQuotaStatus() {
    if (isVipUnlocked()) {
        return { canUse: true, isVip: true, remainingMs: 0 };
    }
    const lastUsed = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
    if (!lastUsed) {
        return { canUse: true, isVip: false, remainingMs: 0 };
    }
    const elapsed = Date.now() - lastUsed;
    if (elapsed >= DAILY_LIMIT_MS) {
        localStorage.removeItem(STORAGE_KEY);
        return { canUse: true, isVip: false, remainingMs: 0 };
    }
    return { canUse: false, isVip: false, remainingMs: DAILY_LIMIT_MS - elapsed };
}

// Фиксация использования бесплатной попытки
function consumeDailyQuota() {
    if (isVipUnlocked()) return;
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
    updateQuotaUI();
}

// Форматирование миллисекунд в ЧЧ:ММ:СС
function formatDuration(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

// Обновление индикаторов лимита в шапке и на кнопке
function updateQuotaUI() {
    const status = getQuotaStatus();
    const badge = document.getElementById('quota-badge');
    const quotaText = document.getElementById('quota-text');
    const analyzeBtnText = document.getElementById('analyze-btn-text');
    const limitHint = document.getElementById('limit-hint');
    const countdownEl = document.getElementById('limit-countdown');

    if (status.isVip) {
        badge.className = 'flex items-center gap-1.5 text-xs font-medium px-2.5 sm:px-3 py-1.5 rounded-xl bg-purple-500/15 text-purple-300 border border-purple-500/30';
        quotaText.textContent = 'VIP Безлимит';
        analyzeBtnText.textContent = 'Проверить на оригинальность';
        limitHint.textContent = 'Активирован безлимитный доступ к ИИ-эксперту Gemini.';
        return;
    }

    if (status.canUse) {
        badge.className = 'flex items-center gap-1.5 text-xs font-medium px-2.5 sm:px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-300 border border-emerald-500/25';
        quotaText.textContent = '1 / 1 бесплатно сегодня';
        analyzeBtnText.textContent = 'Проверить на оригинальность (Бесплатно • 1/день)';
        limitHint.textContent = 'Каждому пользователю доступна 1 бесплатная полная экспертиза в сутки через нейросеть Gemini.';
    } else {
        const timeStr = formatDuration(status.remainingMs);
        badge.className = 'flex items-center gap-1.5 text-xs font-medium px-2.5 sm:px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-300 border border-amber-500/25';
        quotaText.textContent = `0 / 1 • через ${timeStr}`;
        analyzeBtnText.textContent = `Бесплатный лимит через ${timeStr}`;
        limitHint.textContent = 'Вы уже использовали сегодняшнюю бесплатную проверку. Новая откроется по таймеру.';
        if (countdownEl) countdownEl.textContent = timeStr;
    }
}

// Запуск живого таймера обновления лимита каждую секунду
updateQuotaUI();
countdownTimerId = setInterval(updateQuotaUI, 1000);

function openLimitModal() {
    updateQuotaUI();
    const modal = document.getElementById('limit-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeLimitModal() {
    const modal = document.getElementById('limit-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function applyVipCode() {
    const input = document.getElementById('vip-code-input');
    const code = input.value.trim();
    if (!code) return;
    try {
        const res = await fetch('/api/vip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.valid) {
            localStorage.setItem(VIP_STORAGE_KEY, 'true');
            localStorage.setItem(VIP_CODE_STORAGE_KEY, code);
            input.value = '';
            updateQuotaUI();
            closeLimitModal();
            showToast('VIP-доступ активирован! Лимит снят.', 'success');
        } else {
            showToast('Неверный VIP-код доступа', 'error');
        }
    } catch (err) {
        showToast('Не удалось проверить код. Попробуйте позже.', 'error');
    }
}

// Запуск легитчека
async function startLegitCheck() {
    // Проверка дневного лимита (1 бесплатный запрос в день)
    const quota = getQuotaStatus();
    if (!quota.canUse) {
        openLimitModal();
        return;
    }

    const brand = document.getElementById('brand-input').value.trim();
    const model = document.getElementById('model-input').value.trim();
    const notes = document.getElementById('notes-input').value.trim();

    if (uploadedImages.length === 0 && !brand && !model) {
        showToast('Пожалуйста, загрузите хотя бы одно фото вещи или укажите её бренд и модель', 'warning');
        return;
    }

    // Переключение экранов на загрузку
    document.getElementById('hero-section').classList.add('hidden');
    document.getElementById('input-section').classList.add('hidden');
    document.getElementById('results-section').classList.add('hidden');
    document.getElementById('loading-section').classList.remove('hidden');

    // Имитация прогресса этапов проверки
    const statuses = [
        'Идентификация бренда, силуэта и артикула...',
        'Поиск архивных данных о коллекции и годе релиза...',
        'Анализ строчек, типографики бирок и материалов...',
        'Формирование экспертного заключения и истории...'
    ];
    let step = 0;
    const bar = document.getElementById('loading-bar');
    const statusText = document.getElementById('loading-status');
    bar.style.width = '20%';
    statusText.textContent = statuses[0];

    const progressInterval = setInterval(() => {
        step++;
        if (step < statuses.length) {
            statusText.textContent = statuses[step];
            bar.style.width = `${20 + step * 22}%`;
        }
    }, 1800);

    try {
        const resultData = await callGeminiLegitCheck(brand, model, notes, uploadedImages);
        clearInterval(progressInterval);
        bar.style.width = '100%';
        
        // Списываем бесплатную дневную попытку только после успешной проверки
        consumeDailyQuota();

        currentAnalysisContext = {
            brand,
            model,
            notes,
            result: resultData
        };

        setTimeout(() => {
            renderResults(resultData);
        }, 400);

    } catch (error) {
        clearInterval(progressInterval);
        console.error(error);
        document.getElementById('loading-section').classList.add('hidden');
        document.getElementById('hero-section').classList.remove('hidden');
        document.getElementById('input-section').classList.remove('hidden');
        showToast('Не удалось завершить проверку. Попробуйте еще раз или загрузите более четкие фото.', 'error');
    }
}

// Запрос экспертизы на наш сервер (ключ Gemini хранится только на сервере)
async function callGeminiLegitCheck(brand, model, notes, images) {
    return await fetchWithRetry('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-vip-code': getVipCode() },
        body: JSON.stringify({
            brand, model, notes,
            images: images.map(img => ({ mimeType: img.mimeType, data: img.base64 }))
        })
    });
}

// Отрисовка результатов экспертизы
function renderResults(data) {
    document.getElementById('loading-section').classList.add('hidden');
    document.getElementById('results-section').classList.remove('hidden');
    document.getElementById('reset-btn').classList.remove('hidden');

    // Настройка стилей карточки вердикта в зависимости от статуса
    const verdictCard = document.getElementById('verdict-card');
    const iconBg = document.getElementById('verdict-icon-bg');
    const iconEl = document.getElementById('verdict-icon');
    const badge = document.getElementById('verdict-badge');
    const scoreBar = document.getElementById('score-bar');

    verdictCard.classList.remove('border-emerald-500/40', 'border-red-500/40', 'border-amber-500/40');
    iconBg.className = 'w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center shrink-0';
    badge.className = 'text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg';

    if (data.verdictStatus === 'AUTHENTIC') {
        verdictCard.classList.add('border-emerald-500/40');
        iconBg.classList.add('bg-emerald-500/15', 'text-emerald-400');
        iconEl.setAttribute('data-lucide', 'shield-check');
        badge.classList.add('bg-emerald-500/20', 'text-emerald-300');
        scoreBar.className = 'h-full rounded-full transition-all duration-1000 bg-gradient-to-r from-emerald-500 to-teal-400';
    } else if (data.verdictStatus === 'FAKE') {
        verdictCard.classList.add('border-red-500/40');
        iconBg.classList.add('bg-red-500/15', 'text-red-400');
        iconEl.setAttribute('data-lucide', 'shield-alert');
        badge.classList.add('bg-red-500/20', 'text-red-300');
        scoreBar.className = 'h-full rounded-full transition-all duration-1000 bg-gradient-to-r from-red-600 to-rose-400';
    } else {
        verdictCard.classList.add('border-amber-500/40');
        iconBg.classList.add('bg-amber-500/15', 'text-amber-400');
        iconEl.setAttribute('data-lucide', 'help-circle');
        badge.classList.add('bg-amber-500/20', 'text-amber-300');
        scoreBar.className = 'h-full rounded-full transition-all duration-1000 bg-gradient-to-r from-amber-500 to-yellow-400';
    }

    // Заполнение текстовых данных
    badge.textContent = data.verdictTitle;
    document.getElementById('confidence-badge').textContent = `Точность анализа: ${data.confidenceScore}%`;
    document.getElementById('res-item-title').textContent = `${data.brand} — ${data.modelName}`;
    document.getElementById('res-brand-collection').textContent = `Коллекция: ${data.collection}`;
    document.getElementById('res-release-year').innerHTML = `<i data-lucide="calendar" class="w-3.5 h-3.5 text-blue-400"></i><span>Релиз: ${data.releaseYear}</span>`;
    document.getElementById('res-verdict-summary').textContent = data.verdictSummary;

    // Анимация прогресс-бара
    document.getElementById('score-text').textContent = `${data.confidenceScore}%`;
    setTimeout(() => {
        scoreBar.style.width = `${data.confidenceScore}%`;
    }, 100);

    // Рендер пунктов разбора подлинности
    const pointsContainer = document.getElementById('authenticity-points');
    pointsContainer.innerHTML = data.authenticityPoints.map(pt => {
        let statusBadge = '';
        let borderClass = 'border-zinc-800/80 bg-dark-900/60';
        
        if (pt.status === 'PASS') {
            statusBadge = `<span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400"><i data-lucide="check" class="w-3 h-3"></i> Оригинал</span>`;
            borderClass = 'border-emerald-500/20 bg-emerald-950/10';
        } else if (pt.status === 'FAIL') {
            statusBadge = `<span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-red-500/15 text-red-400"><i data-lucide="x" class="w-3 h-3"></i> Несоответствие</span>`;
            borderClass = 'border-red-500/20 bg-red-950/10';
        } else {
            statusBadge = `<span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-400"><i data-lucide="eye" class="w-3 h-3"></i> Требует внимания</span>`;
            borderClass = 'border-amber-500/20 bg-amber-950/10';
        }

        return `
            <div class="p-4 rounded-2xl border ${borderClass} transition-all">
                <div class="flex items-center justify-between gap-2 mb-1.5">
                    <h4 class="font-semibold text-sm text-white">${pt.feature}</h4>
                    ${statusBadge}
                </div>
                <p class="text-xs sm:text-sm text-zinc-300 leading-relaxed">${pt.explanation}</p>
            </div>
        `;
    }).join('');

    // Блок недостающих деталей
    const missingBox = document.getElementById('missing-details-box');
    if (data.missingDetails && data.missingDetails.trim().length > 5) {
        missingBox.classList.remove('hidden');
        document.getElementById('res-missing-details').textContent = data.missingDetails;
    } else {
        missingBox.classList.add('hidden');
    }

    // История коллекции и модели
    document.getElementById('res-collection-tag').textContent = `${data.collection} (${data.releaseYear})`;
    document.getElementById('res-collection-story').textContent = data.collectionStory;
    document.getElementById('res-model-history').textContent = data.modelHistory;

    // Галерея снимков в результатах
    const gallery = document.getElementById('result-gallery');
    if (uploadedImages.length > 0) {
        gallery.parentElement.classList.remove('hidden');
        gallery.innerHTML = uploadedImages.map((img, i) => `
            <div class="aspect-square rounded-xl overflow-hidden border border-zinc-800 bg-dark-900">
                <img src="${img.dataUrl}" alt="Снимок ${i + 1}" class="w-full h-full object-cover">
            </div>
        `).join('');
    } else {
        gallery.parentElement.classList.add('hidden');
    }

    // Очищаем чат уточнений
    document.getElementById('followup-messages').innerHTML = '';
    document.getElementById('followup-messages').classList.add('hidden');

    lucide.createIcons();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Дополнительные вопросы эксперту по текущей вещи
async function askFollowUp(e) {
    e.preventDefault();
    const input = document.getElementById('followup-input');
    const question = input.value.trim();
    if (!question || !currentAnalysisContext) return;

    const btn = document.getElementById('followup-btn');
    const messagesBox = document.getElementById('followup-messages');
    messagesBox.classList.remove('hidden');

    // Добавляем сообщение пользователя
    messagesBox.innerHTML += `
        <div class="flex justify-end">
            <div class="bg-blue-600/20 border border-blue-500/30 text-blue-100 rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm max-w-[85%]">
                ${escapeHtml(question)}
            </div>
        </div>
    `;
    input.value = '';
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>`;
    lucide.createIcons();
    messagesBox.scrollTop = messagesBox.scrollHeight;

    try {
        const data = await fetchWithRetry('/api/followup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-vip-code': getVipCode() },
            body: JSON.stringify({
                context: currentAnalysisContext.result,
                question,
                images: uploadedImages.map(img => ({ mimeType: img.mimeType, data: img.base64 }))
            })
        });

        const answer = data?.answer || 'Не удалось получить ответ.';

        messagesBox.innerHTML += `
            <div class="flex justify-start">
                <div class="bg-dark-900 border border-zinc-800 text-zinc-200 rounded-2xl rounded-tl-sm px-4 py-3 text-sm max-w-[90%] leading-relaxed">
                    <span class="text-[11px] font-bold text-blue-400 block mb-1">Эксперт LegitCheck AI</span>
                    ${escapeHtml(answer).replace(/\n/g, '<br>')}
                </div>
            </div>
        `;
    } catch (err) {
        showToast('Ошибка при отправке вопроса', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<span>Спросить</span><i data-lucide="send" class="w-4 h-4"></i>`;
        lucide.createIcons();
        messagesBox.scrollTop = messagesBox.scrollHeight;
    }
}

function escapeHtml(str) {
    return str.replace(/[&<>"']/g, function(m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
}

// Сброс и возврат к проверке новой вещи
function resetApp() {
    uploadedImages = [];
    currentAnalysisContext = null;
    document.getElementById('brand-input').value = '';
    document.getElementById('model-input').value = '';
    document.getElementById('notes-input').value = '';
    renderPreviews();

    document.getElementById('results-section').classList.add('hidden');
    document.getElementById('loading-section').classList.add('hidden');
    document.getElementById('reset-btn').classList.add('hidden');
    document.getElementById('hero-section').classList.remove('hidden');
    document.getElementById('input-section').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Модальное окно советов
function openTipsModal() {
    const modal = document.getElementById('tips-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeTipsModal() {
    const modal = document.getElementById('tips-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

// Демо-пример для мгновенной проверки интерфейса без загрузки фото
function fillDemoExample() {
    resetApp();
    document.getElementById('brand-input').value = 'Nike x Travis Scott';
    document.getElementById('model-input').value = 'Air Jordan 1 Retro High OG Mocha (CD4487-100)';
    document.getElementById('notes-input').value = 'Проверь ключевые признаки оригинала этой пары: обратный свуш, замшу, логотип Cactus Jack и размерную бирку.';
    showToast('Заполнен демо-запрос! Нажмите «Проверить на оригинальность»', 'info');
}
