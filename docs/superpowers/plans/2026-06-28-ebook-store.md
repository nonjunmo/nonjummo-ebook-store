# E-book Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Render-ready e-book sales site for 논준모연구소 with SQLite-backed products, orders, and admin status management.

**Architecture:** Express renders EJS pages for public shopping, ordering, and admin management. A small SQLite data layer owns schema creation and queries. Tests use temporary SQLite files through the same query layer.

**Tech Stack:** Node.js, Express, EJS, express-session, better-sqlite3, node:test, supertest.

---

## File Structure

- `package.json`: npm scripts and dependencies.
- `.env.example`: Render/local environment variable template.
- `src/db.js`: SQLite database creation, schema migration, and query functions.
- `src/server.js`: Express app factory, routes, sessions, and form handling.
- `src/views/*.ejs`: Public and admin server-rendered screens.
- `src/public/styles.css`: Responsive styling based on the supplied mockup.
- `test/app.test.js`: End-to-end HTTP tests for products, cart/order flow, and admin state changes.

## Tasks

### Task 1: Project Skeleton And Failing Tests

- [ ] Create `package.json` with `start`, `dev`, and `test` scripts.
- [ ] Create `.env.example` with `DATABASE_URL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `BANK_ACCOUNT`, and `PORT`.
- [ ] Create `test/app.test.js` that imports `createApp` and `createDatabase`, then verifies the home page, admin product creation, direct order creation, and order status updates.
- [ ] Run `npm test` and confirm it fails because `src/server.js` and `src/db.js` do not exist.

### Task 2: SQLite Data Layer

- [ ] Create `src/db.js` with `createDatabase`, `migrate`, product CRUD, cart product lookup, order creation, order listing, and order status updates.
- [ ] Use parameterized SQL for every input.
- [ ] Run `npm test` and confirm route tests now fail because the Express app does not exist.

### Task 3: Express Routes

- [ ] Create `src/server.js` with an app factory that accepts `{ db, sessionSecret, adminPassword, bankAccount }`.
- [ ] Implement public routes: `GET /`, `POST /cart/add`, `GET /cart`, `POST /order/direct`, `GET /order`, `POST /order`.
- [ ] Implement admin routes: `GET /admin/login`, `POST /admin/login`, `GET /admin`, `GET /admin/products/new`, `POST /admin/products`, `POST /admin/orders/:id/payment`, `POST /admin/orders/:id/delivery`.
- [ ] Run `npm test` and confirm view/template failures are next.

### Task 4: Views And Styling

- [ ] Create EJS views for layout, home, cart, order, success, admin login, admin dashboard, and product form.
- [ ] Create `src/public/styles.css` with responsive list layout, order form, and admin tables.
- [ ] Run `npm test` and confirm all tests pass.

### Task 5: Manual Verification

- [ ] Run `npm start`.
- [ ] Open `http://localhost:3000`.
- [ ] Register a product through admin, add it to cart, submit an order, then mark payment and delivery complete.
- [ ] Stop the server and report the local URL and Render environment variables.

## Self-Review

The plan covers public listing, 10-item paging, cart/direct order flows, order form fields, bank account copy, SQLite persistence, admin product registration, payment confirmation, and delivery completion. The plan intentionally excludes automatic email sending in the first version, matching the approved design.
