const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const request = require("supertest");

const { createDatabase } = require("../src/db");
const { createApp } = require("../src/server");

async function buildTestApp() {
  const databasePath = path.join(os.tmpdir(), `nonjummo-ebook-test-${Date.now()}-${Math.random()}.db`);
  const db = createDatabase(databasePath);
  await db.migrate();
  const app = createApp({
    db,
    adminPassword: "secret",
    bankAccount: "국민은행 123-456 논준모연구소",
    sessionSecret: "test-session-secret"
  });
  return {
    app,
    db,
    close() {
      db.close();
      fs.rmSync(databasePath, { force: true });
    }
  };
}

test("home page shows seeded products and paging copy", async () => {
  const { app, db, close } = await buildTestApp();
  await db.createProduct({
    title: "Book 1. 논문의 논리구조",
    author: "논준모연구소 (김성하 소장)",
    price: 20000,
    summary: "논문의 기본 구조를 빠르게 익히는 교재",
    tableOfContents: "1장 문제의식\n2장 연구모형",
    hasYoutubeMembership: true,
    coverImageUrl: "https://example.com/cover.jpg",
    isActive: true
  });

  const response = await request(app).get("/");

  assert.equal(response.status, 200);
  assert.match(response.text, /논준모연구소 e-book 교재/);
  assert.match(response.text, /Book 1\. 논문의 논리구조/);
  assert.match(response.text, /장바구니/);
  assert.match(response.text, /주문하기/);
  close();
});

test("admin can log in and create a product", async () => {
  const { app, db, close } = await buildTestApp();
  const agent = request.agent(app);

  await agent.post("/admin/login").type("form").send({ password: "secret" }).expect(302);
  await agent
    .post("/admin/products")
    .type("form")
    .send({
      title: "AI 이후의 미래",
      author: "논준모연구소",
      price: "30000",
      summary: "AI 시대 연구자를 위한 e-book",
      tableOfContents: "1장 AI와 연구\n2장 활용 전략",
      hasYoutubeMembership: "on",
      coverImageUrl: "",
      isActive: "on"
    })
    .expect(302);

  const products = await db.listProducts({ page: 1, pageSize: 10, includeInactive: true });
  assert.equal(products.items.length, 1);
  assert.equal(products.items[0].title, "AI 이후의 미래");
  assert.equal(products.items[0].price, 30000);
  close();
});

test("admin product form shows bundled cover image paths", async () => {
  const { app, close } = await buildTestApp();
  const agent = request.agent(app);

  await agent.post("/admin/login").type("form").send({ password: "secret" }).expect(302);
  const response = await agent.get("/admin/products/new");

  assert.equal(response.status, 200);
  assert.match(response.text, /\/img\/book-01\.jpg/);
  assert.match(response.text, /\/img\/book-RAE\.jpg/);
  close();
});

test("admin can edit an existing product", async () => {
  const { app, db, close } = await buildTestApp();
  const product = await db.createProduct({
    title: "수정 전 교재",
    author: "논준모연구소",
    price: 12000,
    summary: "수정 전 소개",
    tableOfContents: "수정 전 목차",
    hasYoutubeMembership: false,
    coverImageUrl: "/img/book-01.jpg",
    isActive: true
  });
  const agent = request.agent(app);

  await agent.post("/admin/login").type("form").send({ password: "secret" }).expect(302);
  const editPage = await agent.get(`/admin/products/${product.id}/edit`);
  assert.equal(editPage.status, 200);
  assert.match(editPage.text, /수정 전 교재/);

  await agent
    .post(`/admin/products/${product.id}`)
    .type("form")
    .send({
      title: "수정 후 교재",
      author: "논준모연구소 개정판",
      price: "18000",
      summary: "수정 후 소개",
      tableOfContents: "수정 후 목차",
      hasYoutubeMembership: "on",
      coverImageUrl: "/img/book-02.jpg",
      isActive: "on"
    })
    .expect(302);

  const updated = await db.getProduct(product.id, { includeInactive: true });
  assert.equal(updated.title, "수정 후 교재");
  assert.equal(updated.author, "논준모연구소 개정판");
  assert.equal(updated.price, 18000);
  assert.equal(updated.has_youtube_membership, true);
  assert.equal(updated.cover_image_url, "/img/book-02.jpg");
  close();
});

test("customer can order directly and sees bank account on order page", async () => {
  const { app, db, close } = await buildTestApp();
  const product = await db.createProduct({
    title: "직접 주문 교재",
    author: "논준모연구소",
    price: 25000,
    summary: "바로 주문 테스트",
    tableOfContents: "목차",
    hasYoutubeMembership: false,
    coverImageUrl: "",
    isActive: true
  });
  const agent = request.agent(app);

  const orderPage = await agent.post("/order/direct").type("form").send({ productId: product.id });
  assert.equal(orderPage.status, 302);

  const form = await agent.get("/order");
  assert.match(form.text, /국민은행 123-456 논준모연구소/);
  assert.match(form.text, /직접 주문 교재/);

  await agent
    .post("/order")
    .type("form")
    .send({
      customerName: "홍길동",
      phone: "010-1234-5678",
      receiptType: "cash_receipt",
      email: "hong@example.com"
    })
    .expect(302);

  const orders = await db.listOrders();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].customer_name, "홍길동");
  assert.equal(orders[0].total_amount, 25000);
  assert.equal(orders[0].items.length, 1);
  close();
});

test("customer can remove a product from the cart", async () => {
  const { app, db, close } = await buildTestApp();
  const first = await db.createProduct({
    title: "장바구니 유지 교재",
    author: "논준모연구소",
    price: 11000,
    summary: "남아야 하는 상품",
    tableOfContents: "목차",
    hasYoutubeMembership: false,
    coverImageUrl: "",
    isActive: true
  });
  const second = await db.createProduct({
    title: "장바구니 취소 교재",
    author: "논준모연구소",
    price: 22000,
    summary: "삭제되어야 하는 상품",
    tableOfContents: "목차",
    hasYoutubeMembership: false,
    coverImageUrl: "",
    isActive: true
  });
  const agent = request.agent(app);

  await agent.post("/cart/add").type("form").send({ productId: first.id }).expect(302);
  await agent.post("/cart/add").type("form").send({ productId: second.id }).expect(302);
  await agent.post("/cart/remove").type("form").send({ productId: second.id }).expect(302);

  const cart = await agent.get("/cart");
  assert.match(cart.text, /장바구니 유지 교재/);
  assert.doesNotMatch(cart.text, /장바구니 취소 교재/);
  assert.match(cart.text, /11,000원/);
  assert.doesNotMatch(cart.text, /33,000원/);
  assert.match(cart.text, /e-book 목록 보기\(추가구매\)/);
  assert.match(cart.text, /href="\//);
  close();
});

test("admin can mark payment and delivery complete", async () => {
  const { app, db, close } = await buildTestApp();
  const product = await db.createProduct({
    title: "관리자 상태 교재",
    author: "논준모연구소",
    price: 10000,
    summary: "상태 변경 테스트",
    tableOfContents: "목차",
    hasYoutubeMembership: false,
    coverImageUrl: "",
    isActive: true
  });
  const order = await db.createOrder({
    customerName: "김관리",
    phone: "010-0000-0000",
    receiptType: "tax_invoice",
    email: "admin@example.com",
    productIds: [product.id]
  });
  const agent = request.agent(app);

  await agent.post("/admin/login").type("form").send({ password: "secret" }).expect(302);
  await agent.post(`/admin/orders/${order.id}/payment`).type("form").send({ confirmed: "on" }).expect(302);
  await agent.post(`/admin/orders/${order.id}/delivery`).type("form").send({ delivered: "on" }).expect(302);

  const orders = await db.listOrders();
  assert.equal(orders[0].payment_confirmed, true);
  assert.equal(orders[0].delivery_completed, true);
  close();
});

test("admin dashboard shows only undelivered orders and completed orders are paged", async () => {
  const { app, db, close } = await buildTestApp();
  const product = await db.createProduct({
    title: "Paging Product",
    author: "Nonjummo",
    price: 1000,
    summary: "summary",
    tableOfContents: "toc",
    hasYoutubeMembership: false,
    coverImageUrl: "",
    isActive: true
  });

  const pending = await db.createOrder({
    customerName: "Pending Customer",
    phone: "010",
    receiptType: "cash_receipt",
    email: "pending@example.com",
    productIds: [product.id]
  });
  for (let index = 1; index <= 12; index += 1) {
    const order = await db.createOrder({
      customerName: `Done Customer ${String(index).padStart(2, "0")}`,
      phone: `010-${index}`,
      receiptType: "cash_receipt",
      email: `done${index}@example.com`,
      productIds: [product.id]
    });
    await db.setDeliveryCompleted(order.id, true);
  }
  const agent = request.agent(app);
  await agent.post("/admin/login").type("form").send({ password: "secret" }).expect(302);

  const dashboard = await agent.get("/admin");
  assert.match(dashboard.text, /Pending Customer/);
  assert.doesNotMatch(dashboard.text, /Done Customer 01/);
  assert.match(dashboard.text, /발송완료된 주문자/);

  const firstPage = await agent.get("/admin/orders/completed");
  assert.equal(firstPage.status, 200);
  assert.match(firstPage.text, /Done Customer 12/);
  assert.match(firstPage.text, /Done Customer 03/);
  assert.doesNotMatch(firstPage.text, /Done Customer 02/);

  const secondPage = await agent.get("/admin/orders/completed?page=2");
  assert.match(secondPage.text, /Done Customer 02/);
  assert.match(secondPage.text, /Done Customer 01/);
  assert.doesNotMatch(secondPage.text, /Pending Customer/);

  const refreshedPending = await db.listOrders({ deliveryCompleted: false });
  assert.equal(refreshedPending.length, 1);
  assert.equal(refreshedPending[0].id, pending.id);
  close();
});

test("admin can export all completed orders as CSV and HTML", async () => {
  const { app, db, close } = await buildTestApp();
  const product = await db.createProduct({
    title: "Export Product",
    author: "Nonjummo",
    price: 9000,
    summary: "summary",
    tableOfContents: "toc",
    hasYoutubeMembership: false,
    coverImageUrl: "",
    isActive: true
  });
  const completed = await db.createOrder({
    customerName: "Export Customer",
    phone: "010-export",
    receiptType: "tax_invoice",
    email: "export@example.com",
    productIds: [product.id]
  });
  const pending = await db.createOrder({
    customerName: "Not Exported",
    phone: "010-pending",
    receiptType: "cash_receipt",
    email: "pending@example.com",
    productIds: [product.id]
  });
  await db.setDeliveryCompleted(completed.id, true);
  const agent = request.agent(app);
  await agent.post("/admin/login").type("form").send({ password: "secret" }).expect(302);

  const csv = await agent.get("/admin/orders/completed/export.csv");
  assert.equal(csv.status, 200);
  assert.match(csv.headers["content-type"], /text\/csv/);
  assert.match(csv.text, /Export Customer/);
  assert.match(csv.text, /Export Product/);
  assert.doesNotMatch(csv.text, /Not Exported/);

  const html = await agent.get("/admin/orders/completed/export.html");
  assert.equal(html.status, 200);
  assert.match(html.headers["content-type"], /text\/html/);
  assert.match(html.text, /Export Customer/);
  assert.match(html.text, /Export Product/);
  assert.doesNotMatch(html.text, /Not Exported/);

  const stillPending = await db.listOrders({ deliveryCompleted: false });
  assert.equal(stillPending[0].id, pending.id);
  close();
});

test("admin can delete an order from order management", async () => {
  const { app, db, close } = await buildTestApp();
  const product = await db.createProduct({
    title: "Delete Order Product",
    author: "Nonjummo",
    price: 7000,
    summary: "summary",
    tableOfContents: "toc",
    hasYoutubeMembership: false,
    coverImageUrl: "",
    isActive: true
  });
  const order = await db.createOrder({
    customerName: "Delete Order Customer",
    phone: "010-delete",
    receiptType: "cash_receipt",
    email: "delete-order@example.com",
    productIds: [product.id]
  });
  const agent = request.agent(app);

  await agent.post("/admin/login").type("form").send({ password: "secret" }).expect(302);
  await agent.post(`/admin/orders/${order.id}/delete`).type("form").expect(302);

  const orders = await db.listOrders();
  assert.equal(orders.length, 0);
  const dashboard = await agent.get("/admin");
  assert.doesNotMatch(dashboard.text, /Delete Order Customer/);
  close();
});

test("admin can delete a product from product list", async () => {
  const { app, db, close } = await buildTestApp();
  const product = await db.createProduct({
    title: "Delete Product",
    author: "Nonjummo",
    price: 8000,
    summary: "summary",
    tableOfContents: "toc",
    hasYoutubeMembership: false,
    coverImageUrl: "",
    isActive: true
  });
  const agent = request.agent(app);

  await agent.post("/admin/login").type("form").send({ password: "secret" }).expect(302);
  await agent.post(`/admin/products/${product.id}/delete`).type("form").expect(302);

  const products = await db.listProducts({ page: 1, pageSize: 10, includeInactive: true });
  assert.equal(products.items.length, 0);
  const dashboard = await agent.get("/admin");
  assert.doesNotMatch(dashboard.text, /Delete Product/);
  close();
});
