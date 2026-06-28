const path = require("node:path");
const express = require("express");
const session = require("express-session");
const { createDatabase } = require("./db");

function ensureCart(req) {
  if (!Array.isArray(req.session.cart)) req.session.cart = [];
  return req.session.cart;
}

function uniqueCart(ids) {
  return [...new Set(ids.map((id) => Number(id)).filter(Boolean))];
}

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  return res.redirect("/admin/login");
}

function receiptLabel(type) {
  return type === "tax_invoice" ? "세금계산서" : "현금영수증";
}

function createApp(options = {}) {
  const app = express();
  const db = options.db;
  const adminPassword = options.adminPassword || process.env.ADMIN_PASSWORD || "change-me";
  const bankAccount = options.bankAccount || process.env.BANK_ACCOUNT || "국민은행 000000-00-000000 논준모연구소";

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(__dirname, "public")));
  app.use(session({
    secret: options.sessionSecret || process.env.SESSION_SECRET || "dev-session-secret",
    resave: false,
    saveUninitialized: false
  }));
  app.use((req, res, next) => {
    res.locals.cartCount = Array.isArray(req.session.cart) ? req.session.cart.length : 0;
    res.locals.isAdmin = Boolean(req.session.isAdmin);
    res.locals.receiptLabel = receiptLabel;
    next();
  });

  app.get("/", async (req, res, next) => {
    try {
      const page = Math.max(Number(req.query.page || 1), 1);
      const products = await db.listProducts({ page, pageSize: 10 });
      res.render("home", {
        title: "논준모연구소 e-book 교재",
        products,
        page
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/cart/add", async (req, res) => {
    const cart = ensureCart(req);
    req.session.cart = uniqueCart([...cart, req.body.productId]);
    res.redirect("/cart");
  });

  app.get("/cart", async (req, res, next) => {
    try {
      const products = await db.getProductsByIds(ensureCart(req));
      const total = products.reduce((sum, product) => sum + product.price, 0);
      res.render("cart", { title: "장바구니", products, total });
    } catch (error) {
      next(error);
    }
  });

  app.post("/order/direct", (req, res) => {
    req.session.orderProductIds = uniqueCart([req.body.productId]);
    res.redirect("/order");
  });

  app.post("/order/from-cart", (req, res) => {
    req.session.orderProductIds = uniqueCart(ensureCart(req));
    res.redirect("/order");
  });

  app.get("/order", async (req, res, next) => {
    try {
      const productIds = uniqueCart(req.session.orderProductIds || ensureCart(req));
      const products = await db.getProductsByIds(productIds);
      const total = products.reduce((sum, product) => sum + product.price, 0);
      res.render("order", {
        title: "주문하기",
        products,
        total,
        bankAccount,
        form: {},
        error: ""
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/order", async (req, res, next) => {
    try {
      const productIds = uniqueCart(req.session.orderProductIds || ensureCart(req));
      const form = {
        customerName: (req.body.customerName || "").trim(),
        phone: (req.body.phone || "").trim(),
        receiptType: req.body.receiptType,
        email: (req.body.email || "").trim()
      };
      const products = await db.getProductsByIds(productIds);
      const total = products.reduce((sum, product) => sum + product.price, 0);
      if (!form.customerName || !form.phone || !form.email || !["cash_receipt", "tax_invoice"].includes(form.receiptType)) {
        return res.status(422).render("order", {
          title: "주문하기",
          products,
          total,
          bankAccount,
          form,
          error: "이름, 연락처, 증빙 선택, e-mail을 모두 입력해 주세요."
        });
      }
      if (products.length === 0) {
        return res.status(422).render("order", {
          title: "주문하기",
          products,
          total,
          bankAccount,
          form,
          error: "주문할 e-book을 선택해 주세요."
        });
      }
      await db.createOrder({ ...form, productIds });
      req.session.cart = [];
      req.session.orderProductIds = [];
      res.redirect("/order/success");
    } catch (error) {
      next(error);
    }
  });

  app.get("/order/success", (req, res) => {
    res.render("success", { title: "주문 완료" });
  });

  app.get("/admin/login", (req, res) => {
    res.render("admin-login", { title: "관리자 로그인", error: "" });
  });

  app.post("/admin/login", (req, res) => {
    if (req.body.password === adminPassword) {
      req.session.isAdmin = true;
      return res.redirect("/admin");
    }
    return res.status(401).render("admin-login", { title: "관리자 로그인", error: "비밀번호를 확인해 주세요." });
  });

  app.post("/admin/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/"));
  });

  app.get("/admin", requireAdmin, async (req, res, next) => {
    try {
      const products = await db.listProducts({ page: 1, pageSize: 100, includeInactive: true });
      const orders = await db.listOrders();
      res.render("admin-dashboard", { title: "관리자 페이지", products: products.items, orders });
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/products/new", requireAdmin, (req, res) => {
    res.render("admin-product-form", {
      title: "상품 등록",
      product: {},
      error: ""
    });
  });

  app.post("/admin/products", requireAdmin, async (req, res, next) => {
    try {
      const product = {
        title: (req.body.title || "").trim(),
        author: (req.body.author || "").trim(),
        price: Number(req.body.price || 0),
        summary: (req.body.summary || "").trim(),
        tableOfContents: (req.body.tableOfContents || "").trim(),
        hasYoutubeMembership: req.body.hasYoutubeMembership === "on",
        coverImageUrl: (req.body.coverImageUrl || "").trim(),
        isActive: req.body.isActive === "on"
      };
      if (!product.title || !product.author || !product.summary || !product.tableOfContents || product.price < 0) {
        return res.status(422).render("admin-product-form", {
          title: "상품 등록",
          product,
          error: "상품명, 저자/소속, 가격, 소개, 목차를 확인해 주세요."
        });
      }
      await db.createProduct(product);
      res.redirect("/admin");
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/orders/:id/payment", requireAdmin, async (req, res, next) => {
    try {
      await db.setPaymentConfirmed(req.params.id, req.body.confirmed === "on");
      res.redirect("/admin");
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/orders/:id/delivery", requireAdmin, async (req, res, next) => {
    try {
      await db.setDeliveryCompleted(req.params.id, req.body.delivered === "on");
      res.redirect("/admin");
    } catch (error) {
      next(error);
    }
  });

  return app;
}

async function start() {
  const db = createDatabase();
  await db.migrate();
  const app = createApp({ db });
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`논준모연구소 e-book site listening on http://localhost:${port}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  createApp
};
