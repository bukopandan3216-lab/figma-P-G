# Supabase setup

The app expects these local environment variables:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The project-local `.env.local` is ignored by git. Never put the PostgreSQL connection string or database password in frontend code or a Vite environment variable.

## Initialize the empty project

1. Open the Supabase dashboard for the project and open **SQL Editor**.
2. Apply the schema:
   - **Empty project:** run [`supabase/schema/split/schema_fresh.sql`](supabase/schema/split/schema_fresh.sql) once.
   - **Existing database built from the older migration chain:** run [`supabase/schema/split/schema_upgrade.sql`](supabase/schema/split/schema_upgrade.sql) instead. It applies only the guarded deltas.
   - Both scripts are generated from [`supabase/schema/idempotent/schema_complete.sql`](supabase/schema/idempotent/schema_complete.sql). That single file is the canonical schema and also safe to run against either kind of project. **Do not run [`supabase/employee_rbac.sql`](supabase/employee_rbac.sql):** it introduces a department-based `Manager`/`Staff`/`Super Admin` model this app does not use, and the canonical schema reverts it.
3. Deploy the `manage-user` Edge Function (for example, `supabase functions deploy manage-user`). Supabase provides `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions; never add it to a `VITE_` variable or browser code. The function validates the caller's role before changing roles, inviting users, or updating customer status.
4. Load the catalog with [`supabase/seeds/seed.sql`](supabase/seeds/seed.sql). It is additive: it loads the curated P&G catalog, brands, categories, variants (every variant has an expiry date), inventory, suppliers, recommendation rules, and keeps the configured admin profile untouched.
5. Optionally run [`supabase/seeds/demo_analytics.sql`](supabase/seeds/demo_analytics.sql) to add 1,500 repeatable demo orders and their order-item/payment rows across the past year. It uses existing Auth-backed customer profiles (or staff/admin profiles if there are no customers), does not create or modify Auth accounts, and is additive and safe to rerun.
6. In **Authentication > Providers**, enable Email. Enable Google and Facebook only after configuring their provider client IDs and redirect URLs.
7. Reload the Vite app.

The schema creates the requested relational tables, indexes, RLS policies, analytical views, and the transactional `place_order` function. The RBAC migration (`pdf_rbac.sql`) reuses `profiles` for employee records and applies role-scoped database policies using the lowercase roles the app expects; `customer_status_activity.sql` then adds account-status enforcement and the activity RPCs shown under Activity Log. Employee invitations, edits, and account status changes require the deployed Edge Function. Product uploads are resized and compressed to WebP or JPEG and stored in the public `product-images` bucket; only their URLs are stored on product rows. Checkout calls `place_order` so an insufficient-stock item rolls back the order, item rows, payment marker, and inventory decrement together.

## Customer account status and activity

For existing projects, run [`supabase/customer_status_activity.sql`](supabase/customer_status_activity.sql) after the schema/RBAC migrations. It restores the `account_status` and `last_seen_at` profile fields, defaults existing accounts to Active, enforces inactive-account access restrictions, and installs the account/customer activity RPCs. Deploy the updated `manage-user` Edge Function with `supabase functions deploy manage-user`; its gateway JWT check is disabled in [`supabase/config.toml`](supabase/config.toml) so browser preflight requests reach the function. The function still validates the bearer token and administrator role itself. Staff/admin audit events and customer sign-ins, product interactions, and orders are shown separately under Activity Log.

## Identifier convention

Every table has a surrogate primary key named after the entity it identifies, and every foreign key column uses the same name as the primary key it references: `brands.brand_id -> products.brand_id`, `categories.category_id -> products.category_id`, `products.product_id -> product_variants.product_id`, `product_variants.variant_id -> inventory.variant_id`, `profiles.user_id -> orders.user_id`, `suppliers.supplier_id -> brands.supplier_id`, `purchase_orders.purchase_order_id -> purchase_order_items.purchase_order_id`, `orders.order_id -> order_items.order_id` / `payments.order_id`. `cart_items` and `wishlist_items` use composite keys of the referenced ids. `supabase/schema/idempotent/schema_complete.sql` contains a guarded rename block (mirrored in `schema_upgrade.sql`) so databases created before this convention are migrated in place without losing data.

## Supplier catalogue and delivery

Suppliers own unique brands (`brands.supplier_id` is required), and each brand owns its products and size variants. Suppliers are created with their first brand through **Admin -> Suppliers -> Add Supplier**; **Add Brand** extends an existing supplier. Purchase orders are raised with the `create_purchase_order` RPC, which validates that the product belongs to a brand of the selected supplier. The supplier delivery is booked in with the `receive_purchase_order` RPC: it marks the purchase order `Received`, increases `inventory` for each ordered variant and writes a `Stock In` row into `inventory_movements` linked back to the purchase order.

## Reference material

- `supabase/schema_complete_ERD.md` â€” Mermaid + DBML entity relationship diagram (matches the live database).
- `docs/APP_DATABASE_FLOW.md` â€” step-by-step walkthrough of how each screen maps to the ERD.

## New Features Added

### Inventory Movement Tracking
- `inventory_movements.stock_after` â€” snapshot of stock level at time of movement
- `inventory_movements.user_document` â€” document number of the staff member who made the movement
- `profiles.document_number` â€” user's government ID / document number

### Product Discount / Sale
- `products.sale_price` â€” active discounted price
- `products.discount_type` â€” `percentage` or `fixed`
- `products.discount_value` â€” discount amount
- `products.discount_start` / `products.discount_end` â€” sale date window
- Admin can set discount/sale via the "Set Discount / Sale" button (tag icon) beside Archive on the Products page

### Customer Loyalty Segmentation
- `get_customer_segment(uuid)` â€” returns `New`, `Silver` (â‰¥1mo, â‚±10k), `Gold` (â‰¥3mo, â‚±50k), `Platinum` (â‰¥6mo, â‚±150k), `Diamond` (â‰¥12mo, â‚±500k)

### Supplier Delivery (Receiving POs)
- `receive_purchase_order(uuid, text)` â€” marks PO as `Received`, increases `inventory`, writes `Stock In` movement linked to the PO

### Activity Log Filtering
- `get_customer_activity()` now returns only: `order.placed`, `order.cancelled`, `order.delivered`, `support.ticket_submitted`

### Ended Discount Notifications
- `get_ended_discounts()` â€” returns products whose sale window has expired

## Reference

- `supabase/schema_complete_ERD.md` â€” Mermaid + DBML entity relationship diagram
- `docs/APP_DATABASE_FLOW.md` â€” step-by-step walkthrough of how each screen maps to the ERD

## Production payment note and does not store card number, expiry, or CVV. A Supabase Edge Function or server-side payment endpoint must create and confirm the Stripe PaymentIntent before marking `orders.payment_status = 'Paid'`. The publishable client must never receive the database connection string or service-role key.
