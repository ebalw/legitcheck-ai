const { sanitizeImages, clip, callGemini, handleError } = require('./_lib/gemini');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    try {
        const body = req.body || {};
        const question = clip(body.question, 1000);
        if (!question) return res.status(400).json({ error: 'Пустой вопрос' });

        const context = JSON.stringify(body.context || {}).slice(0, 20000);
        const images = sanitizeImages(body.images);
        const prompt = `Контекст проведенного легитчека: ${context}\n\nВопрос пользователя по этой вещи: ${question}\n\nОтветь кратко, по делу и экспертно на русском языке.`;

        const data = await callGemini({ contents: [{ role: 'user', parts: [{ text: prompt }, ...images] }] });
        const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!answer) return res.status(502).json({ error: 'Пустой ответ от модели' });

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ answer });
    } catch (err) {
        return handleError(res, err);
    }
};
