// routes/products.route.js
// CITATION: :contentReference[oaicite:1]{index=1}
const express = require("express");
const { Types } = require("mongoose");
const Products = require("./products.model");
const Reviews = require("../reviews/reviews.model");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");
const router = express.Router();

// أدوات الترجمة (باتت Async)
const {
  applyLang,
  localizeProduct,
  localizeProducts,
} = require("../utils/translate");

// رفع الصور
const { uploadImages } = require("../utils/uploadImage");
router.post("/uploadImages", async (req, res) => {
  try {
    const { images } = req.body; // مصفوفة Base64/DataURL
    if (!images || !Array.isArray(images)) {
      return res.status(400).send({ message: "يجب إرسال مصفوفة من الصور" });
    }
    const uploadedUrls = await uploadImages(images);
    res.status(200).send(uploadedUrls);
  } catch (error) {
    console.error("Error uploading images:", error);
    res.status(500).send({ message: "حدث خطأ أثناء تحميل الصور" });
  }
});

const CATEGORIES_NEED_SIZE = new Set([
  "Men’s Washes",
  "Women’s Washes",
  "Liquid Bath Soap",
]);

// ===================== إنشاء منتج =====================
router.post("/create-product", async (req, res) => {
  try {
    const {
      // الحقول الأساسية (قديمة/افتراضية)
      name,
      category,
      size,
      description,
      oldPrice,
      price,
      image,
      author,
      homeIndex,

      // الحقول ثنائية اللغة (اختيارية)
      name_en,
      name_ar,
      description_en,
      description_ar,
      category_en,
      category_ar,
    } = req.body;

    if (!name || !category || !description || !price || !image || !author) {
      return res.status(400).send({ message: "جميع الحقول المطلوبة يجب إرسالها" });
    }

    if (CATEGORIES_NEED_SIZE.has(category) && !size) {
      return res.status(400).send({ message: "يجب تحديد الحجم لهذا التصنيف" });
    }

    let parsedHomeIndex;
    if (homeIndex !== undefined && homeIndex !== null && homeIndex !== "") {
      const n = Number(homeIndex);
      if (Number.isNaN(n) || n < 1 || n > 6) {
        return res.status(400).send({ message: "homeIndex يجب أن يكون رقمًا بين 1 و 6" });
      }
      parsedHomeIndex = n;
    }

    // اسم قديم متوافق (مع الحجم عند الحاجة)
    const legacyName =
      CATEGORIES_NEED_SIZE.has(category) && size ? `${name} - ${size}` : name;

    // توليد الأسماء ثنائية اللغة إن لم تُرسل (كما السابق)
    const computedNameEn = CATEGORIES_NEED_SIZE.has(category) && size
      ? `${(name_en || name || "")} - ${size}`
      : (name_en || name || "");
    const computedNameAr = CATEGORIES_NEED_SIZE.has(category) && size
      ? `${(name_ar || name || "")} - ${size}`
      : (name_ar || name || "");

    const productData = {
      // الحقول القديمة (تبقى للتوافق)
      name: legacyName,
      category,
      description,
      price,
      oldPrice,
      image,
      author,

      // الحقول ثنائية اللغة
      name_en: computedNameEn || undefined,
      name_ar: computedNameAr || undefined,
      description_en: description_en || description || undefined,
      description_ar: description_ar || description || undefined,
      category_en: category_en || category || undefined,
      category_ar: category_ar || category || undefined,
    };

    if (CATEGORIES_NEED_SIZE.has(category)) productData.size = size;
    if (parsedHomeIndex !== undefined) productData.homeIndex = parsedHomeIndex;

    const newProduct = new Products(productData);
    const savedProduct = await newProduct.save();

    res.status(201).send(savedProduct);
  } catch (error) {
    console.error("Error creating new product", error);
    res.status(500).send({ message: "Failed to create new product" });
  }
});

// ===================== جلب جميع المنتجات =====================
router.get("/", async (req, res) => {
  try {
    const {
      category,
      size,
      color,
      minPrice,
      maxPrice,
      homeIndex,
      page = 1,
      limit = 10,
    } = req.query;

    const lang = applyLang(req);

    const filter = {};

    if (category && category !== "all") {
      filter.category = category;
      if (category === "حناء بودر" && size) {
        filter.size = size;
      }
    }

    if (homeIndex !== undefined && homeIndex !== "" && homeIndex !== "null") {
      const n = Number(homeIndex);
      if (!Number.isNaN(n)) filter.homeIndex = n;
    }

    if (color && color !== "all") filter.color = color;

    if (minPrice && maxPrice) {
      const min = parseFloat(minPrice);
      const max = parseFloat(maxPrice);
      if (!isNaN(min) && !isNaN(max)) {
        filter.price = { $gte: min, $lte: max };
      }
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const totalProducts = await Products.countDocuments(filter);
    const totalPages = Math.ceil(totalProducts / limitNum);

    const docs = await Products.find(filter)
      .skip(skip)
      .limit(limitNum)
      .populate("author", "email")
      .sort({ createdAt: -1 });

    // ✅ أصبحت Async
    const products = await localizeProducts(docs, lang);

    res.status(200).send({ products, totalPages, totalProducts });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).send({ message: "Failed to fetch products" });
  }
});

// ===================== جلب منتج واحد (مسار صريح + تحقّق id) =====================
// ===================== جلب منتج واحد (raw يدعم ) =====================
router.get("/product/:id", async (req, res) => {
  try {
    const productId = req.params.id;

    if (!productId || productId === "undefined" || !Types.ObjectId.isValid(productId)) {
      return res.status(400).send({ message: "Invalid product id" });
    }

    const productDoc = await Products.findById(productId).populate(
      "author",
      "email username"
    );
    if (!productDoc) {
      return res.status(404).send({ message: "Product not found" });
    }

    const reviews = await Reviews.find({ productId }).populate(
      "userId",
      "username email"
    );

    // ✅ لو lang=raw، أرجع البيانات الخام بدون أي تعريب أو إسقاط لحقول ثنائية اللغة
    const qlang = String(req.query.lang || "").toLowerCase();
    if (qlang === "raw") {
      const product = productDoc.toObject({ getters: true, virtuals: false });
      return res.status(200).send({ product, reviews });
    }

    // الحالة الافتراضية: تعريب حسب اللغة المطلوبة
    const lang = applyLang(req);
    const product = await localizeProduct(productDoc, lang);
    return res.status(200).send({ product, reviews });
  } catch (error) {
    console.error("Error fetching the product", error);
    res.status(500).send({ message: "Failed to fetch the product" });
  }
});

// ===================== تحديث منتج =====================
const multer = require("multer");
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.patch(
  "/update-product/:id",
  verifyToken,
  verifyAdmin,
  upload.array("image"), // يجب أن يطابق اسم الحقل المرسل من الفرونت
  async (req, res) => {
    const session = await Products.startSession();
    try {
      session.startTransaction();

      const productId = req.params.id;
      const exists = await Products.findById(productId).session(session);
      if (!exists) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).send({ message: "المنتج غير موجود" });
      }

      // ====== التقاط الحقول من FormData (كلّها نصوص) ======
      const {
        name,
        category,
        price,
        oldPrice,
        description,
        author,
        size,
        homeIndex,       // قد يأتي "", رقم كـ string، null، أو undefined
        name_en,
        name_ar,
        description_en,
        description_ar,
        category_en,
        category_ar,
        inStock,         // قد تأتي 'true'/'false'
        keepImages,      // JSON string []
      } = req.body;

      // ====== تحقق أساسي ======
      if (!name || !category || !price || !description) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).send({ message: "جميع الحقول المطلوبة يجب إرسالها" });
      }

      // ====== تحويل الأرقام ======
      const priceNum     = Number(price);
      const oldPriceNum  = oldPrice !== "" && oldPrice !== undefined ? Number(oldPrice) : undefined;

      if (!Number.isFinite(priceNum) || priceNum <= 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).send({ message: "السعر غير صالح" });
      }

      // ====== منطق homeIndex (تعيين أو حذف أو تجاهل) ======
      let homeIndexNum;
      let shouldUnsetHomeIndex = false;

      if (homeIndex !== undefined) {
        if (homeIndex === "" || homeIndex === null) {
          // المستخدم اختار "بدون موضع" → نحذف الحقل
          shouldUnsetHomeIndex = true;
        } else {
          homeIndexNum = Number(homeIndex);
          if (!Number.isFinite(homeIndexNum)) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).send({ message: "homeIndex غير صالح" });
          }
          if (homeIndexNum < 1 || homeIndexNum > 6) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).send({ message: "homeIndex يجب أن يكون بين 1 و 6" });
          }
        }
      }
      // لو homeIndex === undefined → لا نغيره

      // ====== تحويل Boolean ======
      const inStockBool =
        typeof inStock === "boolean"
          ? inStock
          : String(inStock).toLowerCase() === "true";

      // ====== keepImages كنص JSON ======
      let keepImagesArr = [];
      if (typeof keepImages === "string" && keepImages.trim() !== "") {
        try {
          const parsed = JSON.parse(keepImages);
          if (Array.isArray(parsed)) keepImagesArr = parsed.filter(Boolean);
        } catch (_) {
          // تجاهل JSON غير صالح
        }
      }

      // ====== رفع الصور الجديدة (إن وُجدت) ======
      let newImageUrls = [];
      if (Array.isArray(req.files) && req.files.length > 0) {
        newImageUrls = await Promise.all(
          req.files.map((f) => uploadBufferToCloudinary(f.buffer, "products"))
        );
      }

      // ====== بناء بيانات التحديث ======
      const setData = {
        name: String(name).trim(),
        category,
        price: priceNum,
        description: String(description).trim(),
        author,
        inStock: inStockBool,
        ...(Number.isFinite(oldPriceNum) ? { oldPrice: oldPriceNum } : { oldPrice: null }),

        // حقول اختيارية
        ...(size ? { size } : {}),

        // ثنائي اللغة
        ...(name_en ? { name_en } : {}),
        ...(name_ar ? { name_ar } : {}),
        ...(description_en ? { description_en } : {}),
        ...(description_ar ? { description_ar } : {}),

        // تصنيف بلغتين (إن وجد)
        ...(category_en ? { category_en } : {}),
        ...(category_ar ? { category_ar } : {}),
      };

      const unsetData = {};

      // الصور: إذا تم إرسال keepImages أو صور جديدة نكوّن الصورة النهائية
      if (keepImagesArr.length > 0 || newImageUrls.length > 0) {
        setData.image = [...keepImagesArr, ...newImageUrls];
      }
      // وإلّا لن نعدل image

      // ====== إزاحة تلقائية للـ homeIndex (داخل ترانزاكشن) ======
      if (shouldUnsetHomeIndex) {
        // حذف حقل homeIndex من المنتج الحالي
        unsetData.homeIndex = "";
      } else if (Number.isFinite(homeIndexNum)) {
        // 1) أزح أي منتج آخر يشغل نفس الموضع
        await Products.updateOne(
          { homeIndex: homeIndexNum, _id: { $ne: productId } },
          { $unset: { homeIndex: "" } },
          { session }
        );

        // 2) عيّن الموضع للمنتج الحالي
        setData.homeIndex = homeIndexNum;
      }
      // لو homeIndex === undefined: لا نلمسه

      // ====== تنفيذ التحديث ======
      const updateOps = {};
      if (Object.keys(setData).length)   updateOps.$set   = setData;
      if (Object.keys(unsetData).length) updateOps.$unset = unsetData;

      const updated = await Products.findByIdAndUpdate(
        productId,
        updateOps,
        { new: true, runValidators: true, session }
      );

      await session.commitTransaction();
      session.endSession();

      if (!updated) return res.status(404).send({ message: "المنتج غير موجود" });

      return res.status(200).send({ message: "تم تحديث المنتج بنجاح", product: updated });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();

      console.error("خطأ في تحديث المنتج", error);

      // في حال سباق نادر جدًا، لو بقي تعارض فهرس:
      if (error?.code === 11000 && error?.keyPattern?.homeIndex) {
        return res.status(409).send({ message: "موضع الصفحة الرئيسية مستخدم حاليًا. أعد المحاولة." });
      }

      return res.status(500).send({ message: "فشل تحديث المنتج", error: error.message });
    }
  }
);



// ===================== منتجات مشابهة =====================
router.get("/related/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const lang = applyLang(req);

    if (!id || id === "undefined" || !Types.ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid product id" });
    }

    const product = await Products.findById(id);
    if (!product) {
      return res.status(404).send({ message: "Product not found" });
    }

    const titleRegex = new RegExp(
      product.name
        .split(" ")
        .filter((word) => word.length > 1)
        .join("|"),
      "i"
    );

    const relatedDocs = await Products.find({
      _id: { $ne: id },
      $or: [{ name: { $regex: titleRegex } }, { category: product.category }],
    }).sort({ createdAt: -1 });

    // ✅ أصبحت Async
    const relatedProducts = await localizeProducts(relatedDocs, lang);
    return res.status(200).send(relatedProducts);
  } catch (error) {
    console.error("Error fetching the related products", error);
    res.status(500).send({ message: "Failed to fetch related products" });
  }
});

// ===================== حذف منتج =====================
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !Types.ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid product id" });
    }

    const deletedProduct = await Products.findByIdAndDelete(id);
    if (!deletedProduct) {
      return res.status(404).send({ message: "Product not found" });
    }

    await Reviews.deleteMany({ productId: id });
    res.status(200).send({ message: "Product deleted successfully" });
  } catch (error) {
    console.error("Error deleting the product", error);
    res.status(500).send({ message: "Failed to delete the product" });
  }
});

module.exports = router;
