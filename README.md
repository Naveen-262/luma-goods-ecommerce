# Luma Goods — E-commerce Website

Luma Goods is a small, full-stack e-commerce website for the internship submission. It demonstrates a product catalogue, product details, a persistent shopping bag, checkout validation, order creation, and MySQL storage.

## Features

- Product listing loaded from MySQL through `GET /api/products`
- Product details loaded through `GET /api/products/:id`
- Add-to-bag controls with quantity selection
- Shopping bag stored in browser `localStorage`
- Checkout form with client-side and server-side validation
- Transactional `POST /api/orders` that creates a customer, stores an order, and reduces stock
- Responsive vanilla HTML/CSS/JavaScript frontend with no build step

## Setup (Windows PowerShell)

Run these commands from the project directory after starting a local MySQL or
MariaDB server:

```powershell
Set-Location C:\Users\Admin\Luma Goods
npm install
Copy-Item .env.example .env
```

Open `.env` and update `DB_USER`, `DB_PASSWORD`, `DB_HOST`, or `DB_PORT` if
your local database uses different values. The default configuration expects
MariaDB/MySQL at `127.0.0.1:3306` with user `root` and an empty password.

### Fresh database

For a new database, import the complete schema and seed products:

```powershell
Get-Content .\database\schema.sql | mysql -u root -p
npm test
npm run dev
```

If your root account has no password, press Enter when prompted. If the
`mysql` command is not on PATH, import `database/schema.sql` through
phpMyAdmin or the database tool bundled with XAMPP.

### Existing older database

If `ecommerce_db` already exists from an older version of this project, do
not drop it. Run the idempotent migration instead:

```powershell
npm run db:migrate
npm test
npm run dev
```

The migration creates the configured database when the MySQL account permits
it, adds only missing columns and indexes, copies legacy product `image`
values into `image_url`, and makes legacy order `product_id` and `quantity`
nullable for multi-item orders. It preserves existing rows, does not drop
tables, and can be run again safely. The current workspace had this older
schema, so this is the safe setup path that was used.

### Local product images

Product photos are stored in `public/images/products/` and referenced by
local `/images/products/...` paths. This means the site does not need an
internet connection to display product images at runtime. After copying the
image assets into a new checkout, update the existing product rows with:

```powershell
npm run db:images
```

That command checks that all mapped local files exist, updates only
`products.image_url`, preserves product IDs and all other product fields, and
can be run repeatedly. The image source and license notes are in
`public/images/README.md`.

For a production-style start, use `npm start` instead of `npm run dev`.

Open <http://localhost:3000> after the server starts. The same Express process serves the frontend pages from `public/`.

Run the automated API checks with:

```powershell
npm test
```

The tests use a deterministic mock database, so they do not replace the MySQL setup needed for a real browser checkout.

## Project structure

```text
public/             HTML pages, shared CSS, and browser JavaScript
app.js              Express routes and order transaction logic
server.js           Environment loading and server startup
database/schema.sql MySQL database, tables, and sample products
```

## API

- `GET /api/products` returns all seeded products.
- `GET /api/products/:id` returns one product or a `PRODUCT_NOT_FOUND` JSON error.
- `POST /api/orders` accepts JSON like:

```json
{
  "customer": {
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "address": "1 Example Street"
  },
  "items": [
    { "product_id": 1, "quantity": 2 }
  ]
}
```

The order endpoint validates all fields, checks product availability inside a transaction, creates or updates the checkout customer by email, decrements stock, and returns the created order. Errors use the shape `{ "error": { "code": "...", "message": "..." } }`.

## Notes for submission

This project intentionally uses demo product images and does not process real payments. Before submitting, run the site locally, capture screenshots of the home, product, bag, and confirmation pages, and add them to the internship report and presentation.
