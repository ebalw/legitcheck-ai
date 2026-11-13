// Общие хелперы для serverless-функций: вызов Gemini, проверка VIP, валидация входа

const MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const MAX_IMAGES = 4;
const MAX_IMAGE_B64_LEN = 3_000_000; // ~2.2 МБ на одно фото в base64
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

function isVip(req) {
    const expected = process.env.VIP_CODE;
    const given = req.headers['x-vip-code'];
    return !!expected && typeof given === 'string' && given === expected;
}

function sanitizeImages(images) {
    if (!Array.isArray(images)) return [];
    return images.slice(0, MAX_IMAGES)
        .filter(i => i && ALLOWED_MIME.includes(i.mimeType) && typeof i.data === 'string' && i.data.length < MAX_IMAGE_B64_LEN)
        .map(i => ({ inlineData: { mimeType: i.mimeType, data: i.data } }));
}

function clip(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function callGemini(body) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        const err = new Error('GEMINI_API_KEY не задан в переменных окружения Vercel');
        err.status = 500;
        throw err;
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('Gemini error', res.status, text.slice(0, 500));
        const err = new Error('Ошибка Gemini API');
        err.status = res.status === 429 ? 429 : 502;
        throw err;
    }
    return res.json();
}

function handleError(res, err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Внутренняя ошибка сервера' });
}

module.exports = { isVip, sanitizeImages, clip, callGemini, handleError };
