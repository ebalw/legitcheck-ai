const crypto = require('crypto');

module.exports = (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const expected = process.env.VIP_CODE || '';
    const given = String((req.body && req.body.code) || '');
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    const valid = expected.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ valid });
};
