const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");
const { newDb } = require("pg-mem");

const { createDatabase } = require("../src/db");
const { createApp } = require("../src/server");

async function buildTestApp() {
  const memory = newDb();
  const pg = memory.adapters.createPg();
  const pool = new pg.Pool();
  const db = createDatabase({ pool });
  await db.migrate();
  const app = createApp({
    db,
    adminPassword: "secret",
    bankAccount: "국민은행 123-456 논준모연구소",
    sessionSecret: "test-session-secret"
  });
  return { app, db, pool };
}

test("home page shows seeded products and paging copy", async () => {
  const { app, db, pool } = await buildTestApp();
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
  await pool.end();
});

test("admin can log in and create a product", async () => {
  const { app, db, pool } = await buildTestApp();
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
  await pool.end();
});

test("customer can order directly and sees bank account on order page", async () => {
  const { app, db, pool } = await buildTestApp();
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
  await pool.end();
});

test("admin can mark payment and delivery complete", async () => {
  const { app, db, pool } = await buildTestApp();
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
  await pool.end();
});
