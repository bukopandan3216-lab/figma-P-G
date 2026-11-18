# P&G Beauty Store and Admin MIS
## Program Analysis and Feature Research

**Prepared:** 13 November 2026  
**Research method:** Static review of application routes, React pages, data services, Supabase SQL, employee-management function, and setup documentation. This report describes what the source code implements; it is not a live production or database audit.

## 1. Executive summary

This repository contains a combined consumer beauty-product storefront and an administrative management portal. Customers can browse a product catalog, search and filter products, save a wishlist, maintain a profile, complete a beauty quiz, view recommendations, submit support inquiries, and place orders. The admin portal is intended to manage catalog data, inventory, suppliers, customer/order information, reports, recommendations, support, and employee accounts.

The application is a working UI connected to Supabase for several core data flows, but it is not uniformly production-complete. Catalog and inventory management, customer/order reads, account data, support inquiry storage, and the employee-management foundation use database-backed operations. Other areas contain placeholder controls, generated sample report rows, static metrics, or workflows that report success without persisting settings. In particular, card payment is not processed, the purchase-order creation screen is not wired to persist purchase orders, and the separate Users & Access page is still a mock interface.

**Best description:** a P&G-themed beauty-commerce prototype with a growing Supabase-backed store/admin foundation. It can cater to shoppers and administrators in a configured environment, but several operational workflows need completion and live Supabase setup before it should be treated as a full production MIS.

## 2. What the program caters to

### Primary audiences

| Audience | What the program offers |
|---|---|
| Beauty and personal-care shoppers | Product discovery, product details, category and brand browsing, stock visibility, cart, checkout, wishlist, and a beauty-profile questionnaire. |
| Returning customer/account holders | Profile, saved addresses and payment-method labels, order history, support-ticket history, and persisted quiz profile. |
| Guest visitors | Public catalog browsing and a guest support inquiry. Checkout, quiz profile saving, and account features require sign-in. |
| Super Admin | Intended full administrative access and employee provisioning/management, subject to the RBAC migration and Supabase function being deployed. |
| Manager | A fixed, restricted set of business modules and employee-management access excluding Super Admin accounts. |
| Employee and Staff | Module access assigned to the account, with a small set of position-based defaults. |
| Store operators | Product, inventory, supplier, sales, customer, support, and dashboard data intended to support day-to-day store operations. |

### Operating context reflected in the code

The storefront is branded as P&G Beauty and focuses on skin, hair, body, and personal-care shopping. The former Oral Care category and its products, brands, and transaction history have been removed from the catalogue and database. Some admin summaries regroup categories. Philippine settings appear in the database defaults, address copy, and admin currency formatting, but customer-facing pages and checkout use dollar signs and a `$35` shipping threshold. Currency, pricing, tax, shipping, and locale therefore need alignment before real transactions.

## 3. Feature inventory and implementation status

### Customer storefront

| Feature | What it does | Status and evidence |
|---|---|---|
| Home/catalog discovery | Loads products and categories, shows featured/trending/recommended sections, and links to quiz and category shopping. | Database-backed through the catalog provider; home merchandising labels and some hero/trust-bar claims are presentation copy. [`HomePage.tsx`](src/pages/customer/HomePage.tsx), [`CatalogContext.tsx`](src/context/CatalogContext.tsx) |
| Category browsing | Filters by category, brand, price, in-stock, and sale status; supports sorting and a mobile filter drawer. | Implemented against the loaded catalog. [`CategoryPage.tsx`](src/pages/customer/CategoryPage.tsx) |
| Search | Searches product name, brand, category, and tags. | Implemented as client-side filtering of the loaded catalog, with dynamic frequent/top-selling suggestions from `get_search_suggestions` in the navigation overlay. [`SearchPage.tsx`](src/pages/customer/SearchPage.tsx), [`CustomerNav.tsx`](src/components/CustomerNav.tsx) |
| Product detail | Shows product information, available stock, image gallery, size options, cart/wishlist actions, and related products. | Product data is database-backed; review cards, ingredients, use instructions, and some benefit claims are static examples rather than product-specific review records. [`ProductDetailPage.tsx`](src/pages/customer/ProductDetailPage.tsx) |
| Account registration and login | Email/password signup and login, plus Google/Facebook OAuth when configured. Admin accounts use a separate login route. | Supabase Auth is used. New users are intended to receive a Customer profile through the database trigger. Social providers require dashboard setup. [`AuthContext.tsx`](src/context/AuthContext.tsx), [`AdminPages.tsx`](src/pages/admin/AdminPages.tsx) |
| Password reset | Presents an email form and confirmation screen. | Incomplete: the reviewed UI changes local page state but does not call Supabase password-reset functionality. [`AccountPages.tsx`](src/pages/customer/AccountPages.tsx) |
| Beauty quiz | Asks about skin, hair, or body concerns and age range; saves a profile for signed-in users. | Form and Supabase profile update exist. Recommendations are generated by local scoring logic, not an external AI model. [`QuizPage.tsx`](src/pages/customer/QuizPage.tsx), [`recommendations.ts`](src/lib/recommendations.ts) |
| Personalized recommendations | Ranks products using ratings, quiz/profile text, local purchase-history keywords, availability, and active rules. | Rule-based and heuristic. The UI’s match percentages and some explanation tags are static display content; the page title should not be read as proof of a trained AI model. [`ForYouPage.tsx`](src/pages/customer/ForYouPage.tsx), [`recommendations.ts`](src/lib/recommendations.ts) |
| Cart and wishlist | Adds/removes products, changes quantities, and keeps customer cart/wishlist data in local storage and attempts to sync signed-in data to Supabase. | Implemented with both local and remote state. Some background sync calls do not surface Supabase errors to the user. [`AppContext.tsx`](src/context/AppContext.tsx) |
| Checkout and orders | Collects shipping details, presents card or cash-on-delivery choices, creates an order through a database RPC, and updates stock. | Order placement and stock decrement are transaction-oriented in `place_order`. Card payment is not charged; the database records a pending payment. Shipping/tax amounts and displayed currency need confirmation. [`CartCheckoutPage.tsx`](src/pages/customer/CartCheckoutPage.tsx), [`catalog.ts`](src/lib/catalog.ts), [`schema.sql`](supabase/schema.sql), [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) |
| Customer account | Profile editing, order history, wishlist, support tickets, addresses, and payment-method management. | Mixed persistence: profiles, orders, tickets, addresses, and payment-method labels use Supabase; checkout also reads address/payment preferences from local storage, so saved profile data and checkout defaults may not always match. [`AccountPages.tsx`](src/pages/customer/AccountPages.tsx) |
| Floating chat | Provides separate AI-stylist and support chat launchers. Support messages are inserted as inquiries; the stylist chat responds with a simple canned acknowledgement. | Support inquiries are database-backed when Supabase is configured. The AI chat is not connected to an AI service. [`FloatingChat.tsx`](src/components/FloatingChat.tsx) |

### Admin and store operations

| Module | What it caters to | Status and evidence |
|---|---|---|
| Dashboard | Admin overview of sales, customers, products, stock, categories, and low-stock counts. | Most figures are computed from Supabase views/tables and refresh periodically. Some UI values (date greeting, change percentages, chart badge) are fixed presentation values, not calculated trends. [`AdminDashboard.tsx`](src/pages/admin/AdminDashboard.tsx), [`adminData.ts`](src/lib/adminData.ts) |
| Products | Add, edit, archive, restore, and permanently delete catalog records; upload product images. | Core writes use Supabase and Storage. New product creation creates a default variant and inventory row. The edit form does not currently persist every field it displays (for example brand/category/description). [`AdminProducts.tsx`](src/pages/admin/AdminProducts.tsx), [`productImages.ts`](src/lib/productImages.ts) |
| Inventory | View stock by variant, adjust quantities, set reorder levels, and review recent movements. | Database-backed. Stock movements use an RPC with quantity validation and row locking. [`AdminInventory.tsx`](src/pages/admin/AdminInventory.tsx), [`schema.sql`](supabase/schema.sql) |
| Suppliers | List supplier information, view a supplier profile, and add suppliers. | Listing and insertion are database-backed; supplier edit/deactivation and a complete procurement workflow are not evident in the reviewed screen. [`AdminPages.tsx`](src/pages/admin/AdminPages.tsx), [`adminData.ts`](src/lib/adminData.ts) |
| Purchases / purchase orders | Intended procurement management. | The screen lists data returned by `fetchPurchases`, which currently queries customer `orders`, not `purchase_orders`. The Create PO modal has no persistence action or item-line implementation. Treat this module as incomplete, not operational purchase-order management. [`AdminPages.tsx`](src/pages/admin/AdminPages.tsx), [`adminData.ts`](src/lib/adminData.ts) |
| Customers | List customer profiles, order totals, computed segments, profile details, and order history. | Profile/order reads are database-backed. Customer segmentation uses simple order-count thresholds; edit actions are not present in the reviewed page. [`AdminPages.tsx`](src/pages/admin/AdminPages.tsx), [`adminData.ts`](src/lib/adminData.ts) |
| Sales | Summary cards and transaction list. | Based on database orders; the transaction list is limited to 100 records. The reviewed screen is primarily read-only. [`AdminPages.tsx`](src/pages/admin/AdminPages.tsx), [`adminData.ts`](src/lib/adminData.ts) |
| Customer Insights | Demand, stock, segments, bundles, and next-step suggestions. | Mixed: product-sales/customer counts feed some areas, but visible category metrics, segment rates, bundle lift values, and action suggestions are explicitly mock/static content. [`AdminPages.tsx`](src/pages/admin/AdminPages.tsx) |
| Recommendations | View/add/toggle rules and inspect a proposed AI endpoint configuration. | Active rules are database-backed and the local recommendation function can be exercised. Endpoint configuration is not persisted or called; model accuracy/retraining figures are static. New-rule description/priority are simplified into a rule name and weight, with empty triggers. [`AdminPages.tsx`](src/pages/admin/AdminPages.tsx), [`adminData.ts`](src/lib/adminData.ts), [`recommendations.ts`](src/lib/recommendations.ts) |
| Reports | Preview and export catalog, inventory, sales, purchase, supplier, customer, and activity reports. | Product/inventory reports are derived from catalog data. Several sales, purchase, supplier, customer, and activity report rows/summary values are hardcoded examples; exported CSVs can therefore contain non-live values. Contact Us Report remains separately under Reports. [`AdminPages.tsx`](src/pages/admin/AdminPages.tsx) |
| Contact Us Report | Review customer support inquiries and prepare a reply. | Inquiry retrieval is database-backed. “Send Reply” currently attempts to persist a response/status, then opens a mailto/Gmail draft or copies text; it does not send an email itself. Some Supabase write errors are ignored and the UI updates optimistically, so verify database persistence before relying on resolved-ticket status. [`AdminPages.tsx`](src/pages/admin/AdminPages.tsx), [`schema.sql`](supabase/schema.sql) |
| Employees | View/search/filter real employee profiles, invite accounts, edit employee records, and deactivate/reactivate accounts. | A database-backed page and server-side function are present. They depend on the RBAC SQL migration, deployed Edge Function, and server-only service key. Position defaults cover only a subset of listed positions. [`AdminEmployees.tsx`](src/pages/admin/AdminEmployees.tsx), [`employees.ts`](src/lib/employees.ts), [`manage-employee/index.ts`](supabase/functions/manage-employee/index.ts), [`employee_rbac.sql`](supabase/employee_rbac.sql) |
| Users & Access | Intended management of system users and permissions. | Placeholder: the current page fetches user rows but displays a hardcoded activity log and a nonfunctional add-user modal. Employee management is implemented separately; do not treat this page as a functioning account-management tool. [`AdminPages.tsx`](src/pages/admin/AdminPages.tsx) |
| Settings | Intended store, notification, security, and integration configuration. | Placeholder: the general settings form reports “saved” but does not persist settings; notification toggles are visual controls; security/integration tabs are marked as future implementation. [`AdminPages.tsx`](src/pages/admin/AdminPages.tsx) |

## 4. Roles and access model

The intended roles are Super Admin, Manager, Employee, and Staff, alongside Customer. The employee migration maps legacy `Beauty Admin` to Manager and `Beauty Staff` to Staff. Super Admin is given broad access; Manager permissions are a fixed module/action matrix; Employee and Staff access is stored per profile in `module_permissions`. Frontend navigation and route guards use the same general role model. Database RLS policies and the `manage-employee` Edge Function are intended to enforce access beyond the UI.

The position list includes Bagger, Repacker, Courier, Cashier, Warehouse Staff, Inventory Staff, Order Processor, Sales Employee, Customer Service Employee, and Other. Only some positions receive defaults: warehouse/repacker inventory view, inventory staff inventory operations, order processor purchases, sales employee sales, and customer service customers/support. Bagger, Courier, Cashier, and Other default to no module permissions. No dedicated packing, delivery dispatch, or POS task pages were found in the route inventory.

**Deployment dependency:** source files alone do not enable backend access control. The `employee_rbac.sql` migration must be applied and the Edge Function deployed/configured as described in [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md). Until then, employee listing/provisioning and server-side restrictions may be unavailable or inconsistent with the intended design.

## 5. Technical structure and data flow

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, and React Router. Reusable providers supply authentication, catalog, cart, and wishlist state.
- **Backend/data:** Supabase Auth, Postgres tables and views, row-level security, SQL functions/RPCs, and Supabase Storage for product images. The employee Edge Function uses Supabase server-side admin capabilities.
- **Data areas:** profiles/roles; brands/categories/products/variants; per-variant inventory and movement ledger; suppliers and purchase orders; customer orders/items/payments; carts/wishlists; addresses/payment-method labels; recommendation rules; support inquiries/responses; employee audit events.
- **Typical customer flow:** browse catalog → select product → cart/wishlist → sign in → checkout → `place_order` validates/records order and decrements variant stock → account shows order history.
- **Typical support flow:** floating support chat → `support_inquiries` row → customer account ticket list → staff review in Contact Us Report → staff prepares an email draft and records a reply/status if the database update succeeds.
- **Typical employee flow:** Super Admin/Manager invites via Edge Function → Auth invite creates identity → profile is assigned role/position/department/permissions → the app loads that profile for route/navigation checks.

## 6. Important limitations and readiness findings

1. **Several admin screens are prototypes rather than complete business workflows.** Highest-impact examples are purchase-order creation, Users & Access, Settings, and parts of Customer Insights and Reports.
2. **Do not assume all displayed analytics are live.** Static cards and sample report arrays are present; report exports may include hardcoded example rows.
3. **Payment processing is not complete.** Card fields are collected for checkout validation but no payment provider confirmation flow is implemented. Setup documentation explicitly says payments remain pending until a server-side PaymentIntent flow is added.
4. **Customer-facing localization is inconsistent.** Database/setup context is Philippine-oriented, while customer prices, shipping threshold, tax presentation, and some text use USD-style display.
5. **Customer support reply is a prepared draft, not automatic email delivery.** Persistence errors in the reply workflow should be surfaced and verified rather than interpreted as delivery.
6. **AI claims should be qualified.** The product recommender is a local score/rule algorithm, the shopper chat is canned, and admin insights include mock metrics. No connected LLM or deployed recommendation model is evidenced.
7. **Employee security depends on deployment steps.** The migration/function must exist in the actual Supabase project. A frontend route guard is not a substitute for RLS or server-side authorization.
8. **Sample/seed data must be distinguished from actual business records.** The setup guide describes `seed_1000.sql` as destructive and says it inserts historical analytics orders. These records should not be represented as current live transactions.
9. **Live state was not inspected.** This research cannot confirm which migrations have been applied, whether Supabase secrets/functions/providers are configured, or the actual accounts and records currently present. The previously supplied user context reported one admin and one customer account; that is user-provided information, not independently queried database evidence.

## 7. Overall assessment

The product is aimed at consumers shopping for P&G beauty/personal-care products and at store operators who need catalog, stock, customer, sales, and support visibility. Its strongest implemented pathways are catalog browsing, profile-based quiz storage, inventory movement, order creation, customer account data, support ticket intake, and the employee RBAC foundation. The main gap is breadth versus operational depth: several modules look complete visually but still rely on mock data or non-persistent controls. Before using the MIS as an authoritative business system, prioritize payment-provider integration, purchase-order CRUD and receiving, persisted settings, real report datasets, reliable email/support delivery, and deployment verification of the RBAC migration/function.

## 8. Source index

- Customer and admin routes: [`src/App.tsx`](src/App.tsx)
- Authentication and user roles: [`src/context/AuthContext.tsx`](src/context/AuthContext.tsx)
- Customer catalog/cart state: [`src/context/CatalogContext.tsx`](src/context/CatalogContext.tsx), [`src/context/AppContext.tsx`](src/context/AppContext.tsx)
- Catalog and order service: [`src/lib/catalog.ts`](src/lib/catalog.ts)
- Admin data queries: [`src/lib/adminData.ts`](src/lib/adminData.ts)
- Recommendation scoring: [`src/lib/recommendations.ts`](src/lib/recommendations.ts)
- Customer pages: [`src/pages/customer/`](src/pages/customer/)
- Admin pages: [`src/pages/admin/`](src/pages/admin/)
- Database schema and policies: [`supabase/schema.sql`](supabase/schema.sql), [`supabase/order_fix_update.sql`](supabase/order_fix_update.sql), [`supabase/employee_rbac.sql`](supabase/employee_rbac.sql)
- Employee provisioning: [`supabase/functions/manage-employee/index.ts`](supabase/functions/manage-employee/index.ts)
- Deployment/setup notes: [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md)
