// models/products.model.js
const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
  {
    // 🧾 الحقول الأساسية
    name:        { type: String, required: true },
    category:    { type: String, required: true },
    description: { type: String, required: true },
    price:       { type: Number, required: true },
    image:       { type: [String], required: true },
    oldPrice:    { type: Number },
    rating:      { type: Number, default: 0 },
    author:      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // 📏 حقل إضافي لبعض التصنيفات (اختياري)
    size:        { type: String },

    // 🌍 حقول ثنائية اللغة (اختيارية)
    name_en:         { type: String },
    name_ar:         { type: String },
    description_en:  { type: String },
    description_ar:  { type: String },
    category_en:     { type: String },
    category_ar:     { type: String },

    // 🏠 موضع الصفحة الرئيسية (1..6) — إن تم تحديده
    homeIndex: {
      type: Number,
      min: 1,
      max: 6,
    },

    // 📦 حالة التوفر
    inStock:     { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ✅ فهرس فريد + Sparse لضمان عدم تكرار homeIndex فقط للمنتجات التي تملكه
ProductSchema.index({ homeIndex: 1 }, { unique: true, sparse: true });

const Products = mongoose.model("Product", ProductSchema);
module.exports = Products;
