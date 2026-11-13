const { sanitizeImages, clip, callGemini, handleError } = require('./_lib/gemini');
const { SYSTEM_PROMPT, buildUserText, GENERATION_CONFIG } = require('./_lib/prompts');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    try {
        const body = req.body || {};
        const brand = clip(body.brand, 120);
        const model = clip(body.model, 200);
        const notes = clip(body.notes, 1000);
        const images = sanitizeImages(body.images);

        if (images.length === 0 && !brand && !model) {
            return res.status(400).json({ error: 'Нужно фото или бренд/модель' });
        }

        const parts = [{ text: buildUserText({ brand, model, notes, hasImages: images.length > 0 }) }, ...images];
        const data = await callGemini({
            contents: [{ role: 'user', parts }],
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            generationConfig: GENERATION_CONFIG
        });

        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!raw) return res.status(502).json({ error: 'Пустой ответ от модели' });

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(JSON.parse(raw));
    } catch (err) {
        return handleError(res, err);
    }
};
