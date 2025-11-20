// utils/translator.js
// يقوم بالترجمة التلقائية EN ➜ AR عبر DeepL أو LibreTranslate (إن وُجدت مفاتيح البيئة)
// إن لم تتوفر خدمة ترجمة، يُعيد النص كما هو.
// ENV:
//   - DEEPL_API_KEY              (مثال: "xxxxxxxx:fx")
//   - LIBRETRANSLATE_URL         (مثال: "http://localhost:5000")
const axios = require('axios');

const HAS_DEEPL = !!process.env.DEEPL_API_KEY;
const HAS_LIBRE = !!process.env.LIBRETRANSLATE_URL;

const mapLang = (lang, provider) => {
  const L = (lang || 'en').toLowerCase();
  if (provider === 'deepl') {
    if (L.startsWith('ar')) return 'AR';
    return 'EN';
  }
  // libre
  return L.startsWith('ar') ? 'ar' : 'en';
};

async function translateText(text, targetLang = 'ar', sourceLang = 'en') {
  try {
    if (!text || !String(text).trim()) return text;

    if (HAS_DEEPL) {
      const url = 'https://api-free.deepl.com/v2/translate';
      const body = new URLSearchParams({
        auth_key: process.env.DEEPL_API_KEY,
        text: text,
        target_lang: mapLang(targetLang, 'deepl'),
        source_lang: mapLang(sourceLang, 'deepl'),
      });
      const res = await axios.post(url, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      });
      const out = res?.data?.translations?.[0]?.text;
      return out || text;
    }

    if (HAS_LIBRE) {
      const base = process.env.LIBRETRANSLATE_URL.replace(/\/+$/, '');
      const res = await axios.post(
        `${base}/translate`,
        {
          q: text,
          source: sourceLang ? sourceLang.toLowerCase() : 'auto',
          target: targetLang.toLowerCase(),
          format: 'text',
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
      );
      return res?.data?.translatedText || text;
    }

    return text; // لا مزوّد ترجمة متاح
  } catch {
    return text; // في حال فشل الترجمة، نُعيد النص الأصلي
  }
}

module.exports = { translateText };
