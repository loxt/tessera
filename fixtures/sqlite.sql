-- Tessera "shop" fixture (SQLite). Deterministic seed for integration tests and manual QA.
PRAGMA foreign_keys = ON;

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email VARCHAR(255) UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  sku VARCHAR(32) NOT NULL UNIQUE,
  title TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  data JSON,
  image BLOB,
  big_counter BIGINT
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'new'
);
CREATE INDEX orders_customer_id_idx ON orders (customer_id);

CREATE TABLE order_items (
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE audit_log (
  msg TEXT,
  at TIMESTAMP
);

CREATE VIEW order_totals AS
SELECT o.id AS order_id, o.customer_id, SUM(i.qty * p.price) AS total
FROM orders o
JOIN order_items i ON i.order_id = o.id
JOIN products p ON p.id = i.product_id
GROUP BY o.id, o.customer_id;

WITH RECURSIVE g(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM g WHERE n < 30)
INSERT INTO customers (name, email, created_at, active)
SELECT 'Customer ' || n,
       CASE WHEN n % 7 = 0 THEN NULL ELSE 'customer' || n || '@example.com' END,
       datetime('2024-01-01 09:00:00', '+' || n || ' days'),
       n % 5 <> 0
FROM g;
UPDATE customers SET name = 'Zoë Ångström 日本語 🚀' WHERE id = 1;

WITH RECURSIVE g(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM g WHERE n < 20)
INSERT INTO products (sku, title, price, data, image, big_counter)
SELECT printf('SKU-%03d', n),
       'Product ' || n,
       n * 3.25,
       CASE WHEN n % 4 = 0 THEN NULL ELSE json_object('color', 'c' || n, 'tags', json_array('a', n)) END,
       CASE WHEN n % 3 = 0 THEN NULL ELSE unhex(printf('%02x', n) || 'cafe') END,
       CASE WHEN n = 1 THEN 9007199254740993 ELSE n * 1000 END
FROM g;
UPDATE products SET title = (WITH RECURSIVE r(s, k) AS (SELECT '', 0 UNION ALL SELECT s || 'Long description text. ', k + 1 FROM r WHERE k < 200) SELECT s FROM r WHERE k = 200) WHERE id = 2;

WITH RECURSIVE g(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM g WHERE n < 40)
INSERT INTO orders (customer_id, created_at, status)
SELECT (n % 30) + 1,
       datetime('2024-03-01 12:00:00', '+' || n || ' hours'),
       CASE n % 3 WHEN 0 THEN 'new' WHEN 1 THEN 'paid' ELSE 'shipped' END
FROM g;

WITH RECURSIVE g(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM g WHERE n < 40)
INSERT INTO order_items (order_id, product_id, qty)
SELECT n, ((n * 7 + k) % 20) + 1, (n + k) % 4 + 1
FROM g, (SELECT 0 AS k UNION ALL SELECT 1);

INSERT INTO audit_log (msg, at)
VALUES ('seeded', '2024-01-01 00:00:00'), ('checked', NULL), (NULL, '2024-01-02 00:00:00');
