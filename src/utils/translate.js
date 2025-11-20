// utils/translate.js
// CITATION: :contentReference[oaicite:0]{index=0}
const { translateText } = require('./translator');

/**
 * يختار اللغة من كويري الريكوست: ?lang=ar | ?lang=en
 * أي قيمة غير "ar" ستُعتبر "en" افتراضيًا
 */
function pickLangFromReq(req) {
  return req?.query?.lang === 'ar' ? 'ar' : 'en';
}

/** يُعيد نسخة Plain Object من مستند Mongoose أو كائن عادي */
function toPOJO(doc) {
  if (!doc) return {};
  if (typeof doc.toObject === 'function') return doc.toObject();
  return { ...doc };
}

/**
 * يستبدل الحقول الأساسية (name / description / category) بالقيم الثنائية
 * وإن كانت اللغة المطلوبة "ar" والحقول العربية مفقودة، يترجم تلقائيًا من الإنجليزية.
 *
 * @param {Object} product - مستند المنتج (Mongoose doc أو POJO)
 * @param {"en"|"ar"} lang - اللغة المطلوبة
 * @param {Object} options
 *   - stripBilingualFields: هل نحذف الحقول الثنائية من الاستجابة؟ (افتراضي true)
 */
async function localizeProduct(product, lang = 'en', options = {}) {
  const { stripBilingualFields = true } = options;
  const p = toPOJO(product);

  // دالة تلتقط أفضل قيمة لحقل معيّن بحسب اللغة،
  // مع ترجمة تلقائية إلى العربية إن طلب المستخدم "ar" ولا يوجد *_ar.
  const pickField = async (base) => {
    const ar = p[`${base}_ar`];
    const en = p[`${base}_en`];
    const legacy = p[base];

    if (lang === 'ar') {
      if (ar && String(ar).trim()) return ar;
      const source = (en && String(en).trim()) ? en : (legacy || '');
      if (!source) return '';
      // ترجمة تلقائية EN ➜ AR
      return await translateText(source, 'ar', 'en');
    } else {
      // en
      if (en && String(en).trim()) return en;
      if (legacy && String(legacy).trim()) return legacy;
      // لو في *_ar فقط، نحاول ترجمتها إلى الإنجليزية (اختياري)
      if (ar && String(ar).trim()) {
        return await translateText(ar, 'en', 'ar');
      }
      return '';
    }
  };

  // نحدّث الحقول المعروضة
  p.name = await pickField('name');
  p.description = await pickField('description');
  p.category = await pickField('category');

  if (stripBilingualFields) {
    delete p.name_en;
    delete p.name_ar;
    delete p.description_en;
    delete p.description_ar;
    delete p.category_en;
    delete p.category_ar;
  }

  return p;
}

/** يطبّق التحويل على مصفوفة منتجات */
async function localizeProducts(list, lang = 'en', options = {}) {
  if (!Array.isArray(list)) return [];
  return Promise.all(list.map((item) => localizeProduct(item, lang, options)));
}

/** مُساعد مختصر للاستخدام داخل الراوتر */
function applyLang(req) {
  return pickLangFromReq(req);
}

module.exports = {
  pickLangFromReq,
  localizeProduct,
  localizeProducts,
  applyLang,
};
