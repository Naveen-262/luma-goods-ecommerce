CREATE DATABASE IF NOT EXISTS ecommerce_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE ecommerce_db;

CREATE TABLE IF NOT EXISTS products (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  price DECIMAL(10, 2) UNSIGNED NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  stock INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  address VARCHAR(500) NOT NULL,
  password_hash VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_reference CHAR(36) NOT NULL,
  user_id INT UNSIGNED NULL,
  product_id INT UNSIGNED NULL,
  quantity INT UNSIGNED NULL,
  customer_name VARCHAR(100) NOT NULL,
  customer_email VARCHAR(254) NOT NULL,
  shipping_address VARCHAR(500) NOT NULL,
  items_json JSON NOT NULL,
  total_price DECIMAL(10, 2) UNSIGNED NOT NULL,
  total_amount DECIMAL(10, 2) UNSIGNED NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_reference (order_reference),
  KEY idx_orders_user_id (user_id),
  KEY idx_orders_product_id (product_id),
  CONSTRAINT fk_orders_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_orders_product
    FOREIGN KEY (product_id) REFERENCES products (id)
    ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT IGNORE INTO products (name, description, price, image_url, stock) VALUES
  ('Classic Cotton T-Shirt', 'A soft, everyday cotton t-shirt with a comfortable fit.', 19.99, '/images/products/classic-tshirt-1.jpg', 40),
  ('Canvas Backpack', 'A durable canvas backpack for work, travel, and daily use.', 49.00, '/images/products/travel-backpack-1.jpg', 25),
  ('Minimal Wrist Watch', 'A clean, versatile wrist watch with a classic leather strap.', 74.50, '/images/products/smart-watch-1.jpg', 15),
  ('Ceramic Coffee Mug', 'A hand-finished ceramic mug for coffee, tea, or cocoa.', 14.95, '/images/products/ceramic-coffee-mug-1.jpg', 60),
  ('Wireless Headphones', 'Lightweight wireless headphones with a long-lasting battery.', 89.99, '/images/products/wireless-headphones-1.jpg', 20);
