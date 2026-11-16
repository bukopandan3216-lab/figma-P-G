# How the App Follows the Database ERD — Step-by-Step Walkthrough

**Companion to:** [`supabase/schema_complete_ERD.md`](../supabase/schema_complete_ERD.md) (diagram) and [`supabase/schema_complete.sql`](../supabase/schema_complete.sql) (live schema).
**Live project:** Supabase `lvtlehesxweckggyemnm` · PostgreSQL 17.6 · 25 tables · all RLS-enabled · 8 RPCs.

---

## 0. The 30-second version (say this first)

> "The app is a thin React client over Postgres. Every screen reads and writes **through the database**, and every write goes through a **transactional function** so the data can never end up half-written. The ERD is not a picture of the database — it *is* the database. When you add a product in the admin panel you are actually inserting a row into `products`, a row into `product_variants`, and a row into `inventory`, linked by three foreign keys; when a supplier delivers, the purchase order raises `inventory` and writes a permanent trail into `inventory_movements`."

### Table groups (25 tables, 6 groups)

| Group | Tables | Purpose |
|---|---|---|
| **Identity** | `profiles` (PK `user_id`, FK → `auth.users.id`) | One row per person. Stores role, skin profile, account status. |
| **Catalogue** | `brands`, `categories`, `products`, `product_variants` | What we sell, and the sellable SKUs. |
| **Stock** | `inventory`, `inventory_movements` | Current stock + the append-only ledger of how it changed. |
| **Supply** | `suppliers`, `supplier_products`, `purchase_orders`, `purchase_order_items` | Who supplies us, what they supply, and what we ordered. |
| **Selling** | `orders`, `order_items`, `payments`, `cart_items`, `wishlist_items`, `product_reviews` | Customer side of the business. |
| **Engagement** | `recommendation_rules`, `recommendations`, `customer_product_interactions`, `user_activity_log`, `support_inquiries`, `support_responses`, `user_addresses`, `user_payment_methods` | Personalisation, audit trail, support, customer data. |

---

## 1. Your example: "I add a product on the Product page — which tables are touched?"

**Your take:** *"we have products, categories, brands… and the quantity, price. To create a product we need those tables. Correct? No other table needed?"*

**Answer: almost — it is 4 tables, not 3.**

| Step | Table | What is written | Why it is needed |
|---|---|---|---|
| 1 | `brands` | *read* — the brand row for the name typed in the form | `products.brand_id` is a FK, so the brand must already exist |
| 2 | `categories` | *read* — the category row for the name typed in the form | `products.category_id` is a FK |
| 3 | **`products`** | **INSERT** — `product_id, brand_id, category_id, name, price, images, status…` | the product row itself |
| 4 | **`product_variants`** | **INSERT** — `variant_id, product_id, sku, size, scent, additional_price` | a product is not sellable until it has a SKU |
| 5 | **`inventory`** | **INSERT** — `inventory_id, variant_id, stock_quantity, reorder_level` | stock lives per variant, not per product |

Plus (not a table): the image file goes to the **`product-images`** storage bucket; only the URL is stored in `products.image` / `products.images[]`.

**Where it lives:** row in `public.products`; the screen reads it back with
`supabase.from('products').select('id:product_id, …, brands(name), categories(name), product_variants(id:variant_id, …, inventory(stock_quantity))')` — one round trip that joins brand, category, variants and stock.

**Point at the ERD:** `brands.brand_id → products.brand_id`, `categories.category_id → products.category_id`, `products.product_id → product_variants.product_id`, `product_variants.variant_id → inventory.variant_id`.

**Code:** `src/pages/admin/AdminProducts.tsx` (writes) · `src/lib/catalog.ts` (reads).

---

## 2. Suppliers and logistics (the connection you asked for)

### 2.1 Link a supplier to the products they supply

*Admin → Suppliers → Add/Edit Supplier → "Products Supplied" checkboxes.*

| Step | Table | Operation |
|---|---|---|
| 1 | `suppliers` | INSERT/UPDATE the supplier (name, contact, status) |
| 2 | `supplier_products` | DELETE the old links, INSERT one row per linked product |

`supplier_products` is a **junction table** with a composite key `(supplier_id, product_id)` — this is the many-to-many link that answers *"our products come from our suppliers"*. A supplier can supply many products; a product can be sourced from several suppliers.

### 2.2 Order stock from a supplier

*Admin → Purchase Orders → Create PO.* One RPC: `create_purchase_order(supplier, expected delivery, terms, notes, items[])`

| Step | Table | Operation |
|---|---|---|
| 1 | `purchase_orders` | INSERT (`purchase_order_id, created_by = the admin, supplier_id, status='Pending', po_no`, `total_cost`) |
| 2 | `purchase_order_items` | INSERT one row per ordered product (`purchase_order_id, product_id, variant_id, quantity, unit_cost`) |
| 3 | `purchase_orders` | UPDATE `total_cost` = Σ(quantity × unit_cost) |

### 2.3 Supplier delivers → stock increases (the logistics payoff)

*Admin → Purchase Orders → "Mark Received".* One RPC: `receive_purchase_order(purchase_order_id, notes)`

| Step | Table | Operation |
|---|---|---|
| 1 | `purchase_orders` | UPDATE `status = 'Received'` (locked row, cannot be received twice) |
| 2 | `inventory` | UPDATE `stock_quantity += ordered quantity` for the variant (row locked with `FOR UPDATE`) |
| 3 | `inventory_movements` | INSERT `movement_type='Stock In'`, `reference = po_no`, **`purchase_order_id` = the PO** — this is the traceability link |
| 4 | `inventory_movements` | `movement_no` auto-generated `SI-YYYY-000123` by trigger |

**Point at the ERD:** `suppliers.supplier_id → purchase_orders.supplier_id` → `purchase_orders.purchase_order_id → inventory_movements.purchase_order_id` → `product_variants.variant_id → inventory_movements.variant_id`.
*Verified live: receiving a PO moved stock 67 → 68, wrote a linked movement, and flipped the PO to `Received` (tested in a rolled-back transaction).*

### 2.4 Manual stock correction

*Admin → Inventory → adjust stock.* RPC `record_inventory_movement` → `inventory` UPDATE + `inventory_movements` INSERT (`Stock In`/`Stock Out`, `created_by` = staff id).

---

## 3. Customer-facing flows

### 3.1 Sign up / sign in

`auth.users` (Supabase Auth) → trigger `handle_new_user` → INSERT `profiles(user_id, first_name, last_name, email, skin_profile)`.
Role default `customer`; `account_status` default `Active`. `touch_user_activity` RPC stamps `profiles.last_seen_at` and appends a `session.active` row to `user_activity_log` every 15 minutes.

### 3.2 Browsing the catalogue (Home, Category, Search, Product page)

Pure **reads**, no writes:

| Screen | Tables read |
|---|---|
| Home / Category / Search | `products` + `brands(name)` + `categories(name)` + `product_variants` + `inventory(stock_quantity)` |
| Product page | same, plus `product_reviews` (average rating + list) |
| "For You" | `recommendation_rules` + `profiles.skin_profile` + `customer_product_interactions` + `cart_items` + `wishlist_items` + `orders` → `recommendations` INSERT |

`inventory` is read through the variant, so **stock is always shown at SKU level**.

### 3.3 Add to cart / wishlist

| Action | Table | Notes |
|---|---|---|
| Add to cart | `cart_items` INSERT/UPSERT `(user_id, product_id, quantity, variant_id)` | composite PK `(user_id, product_id)` |
| Change qty / remove | `cart_items` UPDATE/DELETE | `updated_at` maintained |
| Wishlist | `wishlist_items` INSERT/DELETE `(user_id, product_id)` | |
| Behaviour tracking | `customer_product_interactions` INSERT (`view`, `cart`, `wishlist`, `recommendation_shown`, `recommendation_clicked`) | powers the recommendation engine and the Insights page |

### 3.4 Checkout — the most important flow to present

*Cart → Checkout → Place Order.* The browser **cannot** insert into `orders` (the grant is revoked); it calls one RPC: **`place_order(...)`** — a single transaction:

| # | Table | Operation (inside one transaction) |
|---|---|---|
| 1 | `orders` | INSERT `order_id, user_id, totals, shipping snapshot, status='Pending', payment_status='Unpaid'`, `order_no` auto-generated `ORD-YYYY-000123` by trigger |
| 2 | `inventory` | SELECT … FOR UPDATE, then `stock_quantity -= qty` — **locked row**, so two shoppers cannot oversell |
| 3 | `order_items` | INSERT `order_id, variant_id, quantity, price_at_purchase` (the price *at purchase time*) |
| 4 | `inventory_movements` | INSERT `Stock Out` + **`order_id`** link → the sale is traceable |
| 5 | `payments` | INSERT `provider='Stripe'|'Cash on Delivery'`, `status='Pending'`, `amount` |
| 6 | `customer_product_interactions` | INSERT `interaction_type='purchase'` (+ the recommendation that led to it) |

If any step fails (e.g. not enough stock), **the whole transaction rolls back** — no order, no items, no payment row, no stock change. The RPC also refuses to run for an inactive/non-customer account.

**Point at the ERD:** `profiles.user_id → orders.user_id`, `orders.order_id → order_items.order_id`, `product_variants.variant_id → order_items.variant_id`, `orders.order_id → payments.order_id`, `orders.order_id → inventory_movements.order_id`.

### 3.5 Payment

`payments` starts `Pending`. Card payments create a Stripe PaymentIntent — the server/Edge Function marks `orders.payment_status = 'Paid'` (the publishable key never touches the database connection).

### 3.6 Reviews

*Product page → write a review.* RPC `submit_product_review(product_id, rating, review)`:
requires a **delivered order containing that product** (checks `orders` + `order_items` + `product_variants`), rating 1–5, text 10–1200 chars, one review per customer per product (`unique(product_id, user_id)`).

### 3.7 Support

Chat widget / Contact page → INSERT `support_inquiries(user_id, customer_name, email, subject, message, status='Open')` → staff reply INSERTs `support_responses(inquiry_id, …)` and UPDATEs `support_inquiries.status/sentiment/support_reply`.

### 3.8 Account area

`user_addresses` (saved addresses), `user_payment_methods` (GCash/PayMaya/card — **only the label and a masked detail are stored**, never card numbers), `orders` history with embedded `order_items → product_variants → products`.

---

## 4. Admin dashboards and audit trail

| Screen | Source |
|---|---|
| Dashboard | views `sales_by_month`, `product_sales` (revenue, units sold, stock) + `orders` + `inventory` |
| Inventory | `inventory` + `inventory_movements` + `products` |
| Insights | `customer_product_interactions` + `profiles.skin_profile` + `cart_items` + `wishlist_items` + `orders` + `product_sales` |
| Activity Log | RPC `get_staff_activity()` / `get_customer_activity()` reading `user_activity_log` |

**`user_activity_log` is written automatically by a trigger** (`audit_user_activity`) on 18 tables — every insert/update/delete by a signed-in user is recorded with actor, action and record id. That is why the Activity Log needs no manual logging code.

---

## 5. Security model (show this if the professor asks "who can write what?")

`has_permission(module, action)` maps roles to modules; RLS policies on all 25 tables enforce it; RPCs are `SECURITY DEFINER` so business rules (e.g. "only a customer can place an order") live in one place.

| Role | Modules |
|---|---|
| `customer` | browse, cart, wishlist, orders (own), reviews, support, addresses, payment methods |
| `beauty_staff` | inventory (view/manage), activity (view) |
| `beauty_admin` | dashboard, products, inventory, suppliers, purchases, customers, activity, sales, insights, recommendations, reports, support |
| `super_admin` | everything, plus user management via the `manage-user` Edge Function |

---

## 6. Presenter cheat sheet

**"Which tables does adding a product touch?"** → `brands` (read), `categories` (read), `products` (write), `product_variants` (write), `inventory` (write). Image file → `product-images` bucket, URL stored in `products.image`.

**"Where is the price and quantity stored?"** → price in `products.price` (+ `product_variants.additional_price`); quantity in `inventory.stock_quantity`, which is **per variant**, and only ever changes through `inventory_movements`.

**"How do you know which supplier a product came from?"** → `supplier_products(supplier_id, product_id)` many-to-many; the purchase that replenished it is `purchase_orders.purchase_order_id` recorded on the `inventory_movements` row.

**"What if two customers buy the last item?"** → `place_order` locks the inventory row `FOR UPDATE` and decrements inside a transaction, so the second checkout fails with "Insufficient stock" and rolls back.

**"How do you know who changed a record?"** → `user_activity_log` trigger + `inventory_movements.created_by`.

**"Why do orders repeat the address instead of linking to user_addresses?"** → the order is a legal snapshot of the address used at that time; later address edits must not rewrite history.

**"What is the difference between `inventory` and `inventory_movements`?"** → `inventory` is the current balance (fast reads, one row per variant); `inventory_movements` is the ledger (audit, traceability, and the source for stock reports).

**"Where is the ERD?"** → `supabase/schema_complete_ERD.md` (Mermaid + DBML), generated from `supabase/schema_complete.sql`, which is the exact script applied to the live database.
