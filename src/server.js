const path = require("node:path");
const express = require("express");
const session = require("express-session");
const { createDatabase } = require("./db");
const fs = require("node:fs");

function ensureCart(req) {
  if (!Array.isArray(req.session.cart)) req.session.cart = [];
  return req.session.cart;
}

function uniqueCart(ids) {
  return [...new Set(ids.map((id) => Number(id)).filter(Boolean))];
}

function selectedProductIds(body) {
  const value = body.productIds;
  if (Array.isArray(value)) return uniqueCart(value);
  return uniqueCart(value ? [value] : []);
}

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  return res.redirect("/admin/login");
}

function receiptLabel(type) {
  return type === "tax_invoice" ? "세금계산서" : "현금영수증";
}

function listCoverImages() {
  const imgDir = path.join(__dirname, "public", "img");
  if (!fs.existsSync(imgDir)) return [];
  return fs.readdirSync(imgDir)
    .filter((file) => /\.(jpe?g|png|webp|gif)$/i.test(file))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => `/img/${file}`);
}

function productFromBody(body) {
  return {
    title: (body.title || "").trim(),
    author: (body.author || "").trim(),
    price: Number(body.price || 0),
    summary: (body.summary || "").trim(),
    tableOfContents: (body.tableOfContents || "").trim(),
    hasYoutubeMembership: body.hasYoutubeMembership === "on",
    coverImageUrl: (body.coverImageUrl || "").trim(),
    isActive: body.isActive === "on"
  };
}

function validProduct(product) {
  return product.title && product.author && product.summary && product.tableOfContents && product.price >= 0;
}

function orderItemTitles(order) {
  return order.items.map((item) => item.product_title).join(" / ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function ordersToCsv(orders) {
  const rows = [
    ["주문자", "주문 e-book", "금액", "증빙", "연락처", "e-mail", "입금확인", "발송완료", "주문일"]
  ];
  for (const order of orders) {
    rows.push([
      order.customer_name,
      orderItemTitles(order),
      order.total_amount,
      receiptLabel(order.receipt_type),
      order.phone,
      order.email,
      order.payment_confirmed ? "확인" : "미확인",
      order.delivery_completed ? "발송완료" : "미발송",
      order.created_at
    ]);
  }
  return "\uFEFF" + rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
}

function ordersToHtml(orders) {
  const rows = orders.map((order) => `
    <tr>
      <td>${escapeHtml(order.customer_name)}</td>
      <td>${escapeHtml(orderItemTitles(order))}</td>
      <td>${escapeHtml(order.total_amount.toLocaleString("ko-KR"))}원</td>
      <td>${escapeHtml(receiptLabel(order.receipt_type))}</td>
      <td>${escapeHtml(order.phone)}</td>
      <td>${escapeHtml(order.email)}</td>
      <td>${escapeHtml(order.payment_confirmed ? "확인" : "미확인")}</td>
      <td>${escapeHtml(order.created_at)}</td>
    </tr>
  `).join("");
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>발송완료된 주문자</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d8dee9; padding: 8px; text-align: left; vertical-align: top; }
  </style>
</head>
<body>
  <h1>발송완료된 주문자</h1>
  <table>
    <thead>
      <tr>
        <th>주문자</th><th>주문 e-book</th><th>금액</th><th>증빙</th>
        <th>연락처</th><th>e-mail</th><th>입금확인</th><th>주문일</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
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

  app.post("/cart/add-selected", (req, res) => {
    const productIds = selectedProductIds(req.body);
    if (productIds.length === 0) return res.redirect("/");
    req.session.cart = uniqueCart([...ensureCart(req), ...productIds]);
    return res.redirect("/cart");
  });

  app.post("/cart/remove", (req, res) => {
    const productId = Number(req.body.productId);
    req.session.cart = ensureCart(req).filter((id) => Number(id) !== productId);
    if (Array.isArray(req.session.orderProductIds)) {
      req.session.orderProductIds = req.session.orderProductIds.filter((id) => Number(id) !== productId);
    }
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

  app.post("/order/selected", (req, res) => {
    const productIds = selectedProductIds(req.body);
    if (productIds.length === 0) return res.redirect("/");
    req.session.orderProductIds = productIds;
    return res.redirect("/order");
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
      const orders = await db.listOrders({ deliveryCompleted: false });
      res.render("admin-dashboard", { title: "관리자 페이지", products: products.items, orders });
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/orders/completed", requireAdmin, async (req, res, next) => {
    try {
      const page = Math.max(Number(req.query.page || 1), 1);
      const orders = await db.listOrdersPage({ deliveryCompleted: true, page, pageSize: 10 });
      res.render("admin-completed-orders", {
        title: "발송완료된 주문자",
        orders,
        page,
        maxPage: Math.max(Math.ceil(orders.total / orders.pageSize), 1)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/orders/completed/export.csv", requireAdmin, async (req, res, next) => {
    try {
      const orders = await db.listOrders({ deliveryCompleted: true });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="completed-orders.csv"');
      res.send(ordersToCsv(orders));
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/orders/completed/export.html", requireAdmin, async (req, res, next) => {
    try {
      const orders = await db.listOrders({ deliveryCompleted: true });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="completed-orders.html"');
      res.send(ordersToHtml(orders));
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/products/new", requireAdmin, (req, res) => {
    res.render("admin-product-form", {
      title: "상품 등록",
      product: {},
      formAction: "/admin/products",
      submitLabel: "등록하기",
      coverImages: listCoverImages(),
      error: ""
    });
  });

  app.post("/admin/products", requireAdmin, async (req, res, next) => {
    try {
      const product = productFromBody(req.body);
      if (!validProduct(product)) {
        return res.status(422).render("admin-product-form", {
          title: "상품 등록",
          product,
          formAction: "/admin/products",
          submitLabel: "등록하기",
          coverImages: listCoverImages(),
          error: "상품명, 저자/소속, 가격, 소개, 목차를 확인해 주세요."
        });
      }
      await db.createProduct(product);
      res.redirect("/admin");
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/products/:id/edit", requireAdmin, async (req, res, next) => {
    try {
      const product = await db.getProduct(req.params.id, { includeInactive: true });
      if (!product) return res.redirect("/admin");
      res.render("admin-product-form", {
        title: "상품 수정",
        product: {
          ...product,
          tableOfContents: product.table_of_contents,
          hasYoutubeMembership: product.has_youtube_membership,
          coverImageUrl: product.cover_image_url,
          isActive: product.is_active
        },
        formAction: `/admin/products/${product.id}`,
        submitLabel: "수정하기",
        coverImages: listCoverImages(),
        error: ""
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/products/:id", requireAdmin, async (req, res, next) => {
    try {
      const product = productFromBody(req.body);
      if (!validProduct(product)) {
        return res.status(422).render("admin-product-form", {
          title: "상품 수정",
          product,
          formAction: `/admin/products/${req.params.id}`,
          submitLabel: "수정하기",
          coverImages: listCoverImages(),
          error: "상품명, 저자/소속, 가격, 소개, 목차를 확인해 주세요."
        });
      }
      await db.updateProduct(req.params.id, product);
      res.redirect("/admin");
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/products/:id/delete", requireAdmin, async (req, res, next) => {
    try {
      await db.deleteProduct(req.params.id);
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

  app.post("/admin/orders/:id/delete", requireAdmin, async (req, res, next) => {
    try {
      await db.deleteOrder(req.params.id);
      res.redirect(req.get("referer") && req.get("referer").includes("/admin/orders/completed") ? "/admin/orders/completed" : "/admin");
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
