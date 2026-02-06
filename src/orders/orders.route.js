// ========================= routes/orders.js =========================
const express = require("express");
const axios = require("axios");
const Order = require("./orders.model");

require("dotenv").config();

const router = express.Router();

const THAWANI_API_KEY = process.env.THAWANI_API_KEY;
const THAWANI_API_URL = process.env.THAWANI_API_URL;
const THAWANI_PUBLISH_KEY = process.env.THAWANI_PUBLISH_KEY;

const ORDER_CACHE = new Map(); 

const toBaisa = (omr) => Math.max(100, Math.round(Number(omr || 0) * 1000)); // >= 100 بيسة

const pairDiscountForProduct = (p) => {
  const isShayla = p.category === "الشيلات فرنسية" || p.category === "الشيلات سادة";
  if (!isShayla) return 0;
  const qty = Number(p.quantity || 0);
  const pairs = Math.floor(qty / 2);
  return pairs * 1; // 1 ر.ع لكل زوج
};

const hasGiftValues = (gc) => {
  if (!gc || typeof gc !== "object") return false;
  const v = (x) => (x ?? "").toString().trim();
  return !!(v(gc.from) || v(gc.to) || v(gc.phone) || v(gc.note));
};

const normalizeGift = (gc) =>
  hasGiftValues(gc)
    ? {
        from: gc.from || "",
        to: gc.to || "",
        phone: gc.phone || "",
        note: gc.note || "",
      }
    : undefined;

const FREE_SHIPPING_THRESHOLD = 14; // ر.ع

router.post("/create-checkout-session", async (req, res) => {
  const {
    products,
    email,
    customerName,
    customerPhone,
    country,
    wilayat,
    description,
    depositMode,
    giftCard,
    gulfCountry,
  } = req.body;

  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: "Invalid or empty products array" });
  }

  try {
    const productsSubtotal = products.reduce(
      (sum, p) => sum + Number(p.price || 0) * Number(p.quantity || 0),
      0
    );

    const totalPairDiscount = products.reduce(
      (sum, p) => sum + pairDiscountForProduct(p),
      0
    );

    const subtotalAfterDiscount = Math.max(0, productsSubtotal - totalPairDiscount);

    let shippingFee =
      country === "دول الخليج"
        ? gulfCountry === "الإمارات"
          ? 4
          : 5
        : 2;


    if (subtotalAfterDiscount >= FREE_SHIPPING_THRESHOLD) {
      shippingFee = 0;
    }

    const originalTotal = subtotalAfterDiscount + shippingFee;

    const DEPOSIT_AMOUNT_OMR = 10;

    let lineItems = [];
    let amountToCharge = 0;

    if (depositMode) {
      lineItems = [
        {
          name: "دفعة مقدم",
          quantity: 1,
          unit_amount: toBaisa(DEPOSIT_AMOUNT_OMR),
        },
      ];
      amountToCharge = DEPOSIT_AMOUNT_OMR;
    } else {
      lineItems = products.map((p) => {
        const unitBase = Number(p.price || 0);
        const qty = Math.max(1, Number(p.quantity || 1));
        const productDiscount = pairDiscountForProduct(p);
        const unitAfterDiscount = Math.max(0.1, unitBase - productDiscount / qty);

        return {
          name: String(p.name || "منتج"),
          quantity: qty,
          unit_amount: toBaisa(unitAfterDiscount),
        };
      });

      if (shippingFee > 0) {
        lineItems.push({
          name: "رسوم الشحن",
          quantity: 1,
          unit_amount: toBaisa(shippingFee),
        });
      }

      amountToCharge = originalTotal;
    }

    const nowId = Date.now().toString();

    const orderPayload = {
      orderId: nowId,
      products: products.map((p) => ({
        productId: p._id,
        quantity: p.quantity,
        name: p.name,
        price: p.price,
        image: Array.isArray(p.image) ? p.image[0] : p.image,
        category: p.category || "",
        selectedSize: p.selectedSize || undefined,
        measurements: p.measurements || {},
        giftCard: normalizeGift(p.giftCard),
      })),
      amountToCharge,
      shippingFee,
      customerName,
      customerPhone,
      country,
      wilayat,
      description,
      email: email || "",
      status: "completed",
      depositMode: !!depositMode,
      remainingAmount: depositMode ? Math.max(0, originalTotal - DEPOSIT_AMOUNT_OMR) : 0,
      giftCard: normalizeGift(giftCard),
    };

    ORDER_CACHE.set(nowId, orderPayload);

    const data = {
      client_reference_id: nowId,
      mode: "payment",
      products: lineItems,
      success_url: "https://www.bondarabia.com/SuccessRedirect?client_reference_id=" + nowId,
      cancel_url: "https://www.bondarabia.com/checkout",
      metadata: {
        email: String(email || ""),
        customer_name: String(customerName || ""),
        customer_phone: String(customerPhone || ""),
        country: String(country || ""),
        wilayat: String(wilayat || ""),
        description: String(description || ""),
        shippingFee: String(shippingFee),
        internal_order_id: String(nowId),
      },
    };

    const response = await axios.post(`${THAWANI_API_URL}/checkout/session`, data, {
      headers: {
        "Content-Type": "application/json",
        "thawani-api-key": THAWANI_API_KEY,
      },
    });

    const sessionId = response?.data?.data?.session_id;
    if (!sessionId) {
      ORDER_CACHE.delete(nowId);
      return res.status(500).json({ error: "No session_id returned" });
    }

    const paymentLink = `https://checkout.thawani.om/pay/${sessionId}?key=${THAWANI_PUBLISH_KEY}`;
    res.json({ id: sessionId, paymentLink });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

router.post("/confirm-payment", async (req, res) => {
  const { client_reference_id } = req.body;

  if (!client_reference_id) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  try {
    // ✅ لو الصفحة اتحدثت/انعمل Refresh بعد الحفظ: رجّع الطلب من DB بدل 404
    const existing = await Order.findOne({ orderId: client_reference_id });
    if (existing && existing.status === "completed") {
      return res.json({ order: existing });
    }

    // 1️⃣ جلب الطلب من الكاش
    const cached = ORDER_CACHE.get(client_reference_id);
    if (!cached) {
      return res.status(404).json({ error: "Order cache not found" });
    }

    // 2️⃣ المبلغ المدفوع فعليًا (OMR)
    const paidAmountOMR = Number(req.body.amount || cached.amountToCharge || 0);

    // 3️⃣ البحث عن الطلب إن كان محفوظ سابقًا
    let order = await Order.findOne({ orderId: client_reference_id });

    // 4️⃣ تجهيز المنتجات مع حفظ الحجم
    const productsWithSize = Array.isArray(cached.products)
      ? cached.products.map((p) => ({
          productId: p.productId || p._id,
          quantity: p.quantity,
          name: p.name,
          price: p.price,
          image: Array.isArray(p.image) ? p.image[0] : p.image,
          category: p.category || "",
          selectedSize: p.selectedSize || undefined,
          measurements: p.measurements || {},
          giftCard: p.giftCard || undefined,
        }))
      : [];

    // 5️⃣ إنشاء الطلب إذا لم يكن موجود
    if (!order) {
      order = new Order({
        orderId: cached.orderId,
        products: productsWithSize,
        amount: paidAmountOMR,
        shippingFee: cached.shippingFee,
        customerName: cached.customerName,
        customerPhone: cached.customerPhone,
        country: cached.country,
        wilayat: cached.wilayat,
        description: cached.description,
        email: cached.email,
        status: "completed",
        depositMode: cached.depositMode,
        remainingAmount: cached.remainingAmount,
        giftCard: cached.giftCard,
      });
    } else {
      // 6️⃣ تحديث الطلب الموجود
      order.status = "completed";
      order.amount = paidAmountOMR;
      order.shippingFee = cached.shippingFee;

      if (productsWithSize.length > 0) {
        order.products = productsWithSize;
      }

      order.depositMode = cached.depositMode;
      order.remainingAmount = cached.remainingAmount;
      order.giftCard = cached.giftCard;
      order.customerName = cached.customerName;
      order.customerPhone = cached.customerPhone;
      order.country = cached.country;
      order.wilayat = cached.wilayat;
      order.description = cached.description;
      order.email = cached.email;
    }

    // 7️⃣ بيانات الدفع
    order.paidAt = new Date();

    await order.save();

    // 8️⃣ تنظيف الكاش
    ORDER_CACHE.delete(client_reference_id);

    res.json({ order });
  } catch (error) {
    console.error("Confirm payment error:", error);
    res.status(500).json({ error: "Failed to confirm payment" });
  }
});

// Get order by email
router.get("/:email", async (req, res) => {
  const email = req.params.email;

  if (!email) {
    return res.status(400).send({ message: "Email is required" });
  }

  try {
    const orders = await Order.find({ email: email });

    if (orders.length === 0) {
      return res.status(404).send({ message: "No orders found for this email" });
    }

    res.status(200).send({ orders });
  } catch (error) {
    console.error("Error fetching orders by email", error);
    res.status(500).send({ message: "Failed to fetch orders by email" });
  }
});

// get order by id
router.get("/order/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).send({ message: "Order not found" });
    }
    res.status(200).send(order);
  } catch (error) {
    console.error("Error fetching orders by user id", error);
    res.status(500).send({ message: "Failed to fetch orders by user id" });
  }
});

// get all orders
router.get("/", async (req, res) => {
  try {
    const orders = await Order.find({ status: "completed" }).sort({ createdAt: -1 });
    if (orders.length === 0) {
      return res.status(404).send({ message: "No orders found", orders: [] });
    }

    res.status(200).send(orders);
  } catch (error) {
    console.error("Error fetching all orders", error);
    res.status(500).send({ message: "Failed to fetch all orders" });
  }
});

// update order status
router.patch("/update-order-status/:id", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status) {
    return res.status(400).send({ message: "Status is required" });
  }

  try {
    const updatedOrder = await Order.findByIdAndUpdate(
      id,
      { status, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!updatedOrder) {
      return res.status(404).send({ message: "Order not found" });
    }

    res.status(200).json({
      message: "Order status updated successfully",
      order: updatedOrder,
    });
  } catch (error) {
    console.error("Error updating order status", error);
    res.status(500).send({ message: "Failed to update order status" });
  }
});

// delete order
router.delete("/delete-order/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const deletedOrder = await Order.findByIdAndDelete(id);
    if (!deletedOrder) {
      return res.status(404).send({ message: "Order not found" });
    }
    res.status(200).json({
      message: "Order deleted successfully",
      order: deletedOrder,
    });
  } catch (error) {
    console.error("Error deleting order", error);
    res.status(500).send({ message: "Failed to delete order" });
  }
});

module.exports = router;
