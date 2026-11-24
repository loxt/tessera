-- Tessera "shop" fixture (MySQL 8). Deterministic seed for integration tests and manual QA.
USE shop;
SET NAMES utf8mb4;

CREATE TABLE customers (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name varchar(255) NOT NULL,
  email varchar(255) UNIQUE,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active tinyint(1) NOT NULL DEFAULT 1
) COMMENT 'People who buy things';

CREATE TABLE products (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sku varchar(32) NOT NULL UNIQUE,
  title text NOT NULL,
  price decimal(10,2) NOT NULL,
  data json,
  image blob,
  big_counter bigint
);

CREATE TABLE orders (
  id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id int NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status varchar(16) NOT NULL DEFAULT 'new',
  INDEX orders_customer_id_idx (customer_id),
  CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id) REFERENCES customers (id)
);

CREATE TABLE order_items (
  order_id int NOT NULL,
  product_id int NOT NULL,
  qty int NOT NULL,
  PRIMARY KEY (order_id, product_id),
  CONSTRAINT order_items_order_fk FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT order_items_product_fk FOREIGN KEY (product_id) REFERENCES products (id)
);

CREATE TABLE audit_log (
  msg text,
  at datetime
);

CREATE VIEW order_totals AS
SELECT o.id AS order_id, o.customer_id, SUM(i.qty * p.price) AS total
FROM orders o
JOIN order_items i ON i.order_id = o.id
JOIN products p ON p.id = i.product_id
GROUP BY o.id, o.customer_id;

DELIMITER //
-- definer = the app user, so SHOW CREATE PROCEDURE returns the body for it
CREATE DEFINER = 'tessera'@'%' PROCEDURE order_count(IN cid int)
BEGIN
  SELECT COUNT(*) AS n FROM orders WHERE customer_id = cid;
END //
DELIMITER ;

INSERT INTO customers (name, email, created_at, active) VALUES
('Zoë Ångström 日本語 🚀', 'customer1@example.com', '2024-01-02 09:00:00', 1),
('Customer 2', 'customer2@example.com', '2024-01-03 09:00:00', 1),
('Customer 3', 'customer3@example.com', '2024-01-04 09:00:00', 1),
('Customer 4', 'customer4@example.com', '2024-01-05 09:00:00', 1),
('Customer 5', 'customer5@example.com', '2024-01-06 09:00:00', 0),
('Customer 6', 'customer6@example.com', '2024-01-07 09:00:00', 1),
('Customer 7', NULL, '2024-01-08 09:00:00', 1),
('Customer 8', 'customer8@example.com', '2024-01-09 09:00:00', 1),
('Customer 9', 'customer9@example.com', '2024-01-10 09:00:00', 1),
('Customer 10', 'customer10@example.com', '2024-01-11 09:00:00', 0),
('Customer 11', 'customer11@example.com', '2024-01-12 09:00:00', 1),
('Customer 12', 'customer12@example.com', '2024-01-13 09:00:00', 1),
('Customer 13', 'customer13@example.com', '2024-01-14 09:00:00', 1),
('Customer 14', NULL, '2024-01-15 09:00:00', 1),
('Customer 15', 'customer15@example.com', '2024-01-16 09:00:00', 0),
('Customer 16', 'customer16@example.com', '2024-01-17 09:00:00', 1),
('Customer 17', 'customer17@example.com', '2024-01-18 09:00:00', 1),
('Customer 18', 'customer18@example.com', '2024-01-19 09:00:00', 1),
('Customer 19', 'customer19@example.com', '2024-01-20 09:00:00', 1),
('Customer 20', 'customer20@example.com', '2024-01-21 09:00:00', 0);

INSERT INTO products (sku, title, price, data, image, big_counter) VALUES
('SKU-001', 'Product 1', 3.25, '{"color": "c1", "tags": ["a", 1]}', X'01cafe', 9007199254740993),
('SKU-002', REPEAT('Long description text. ', 200), 6.50, '{"color": "c2", "tags": ["a", 2]}', X'02cafe', 2000),
('SKU-003', 'Product 3', 9.75, '{"color": "c3", "tags": ["a", 3]}', NULL, 3000),
('SKU-004', 'Product 4', 13.00, NULL, X'04cafe', 4000),
('SKU-005', 'Product 5', 16.25, '{"color": "c5", "tags": ["a", 5]}', X'05cafe', 5000),
('SKU-006', 'Product 6', 19.50, '{"color": "c6", "tags": ["a", 6]}', NULL, 6000),
('SKU-007', 'Product 7', 22.75, '{"color": "c7", "tags": ["a", 7]}', X'07cafe', 7000),
('SKU-008', 'Product 8', 26.00, NULL, X'08cafe', 8000),
('SKU-009', 'Product 9', 29.25, '{"color": "c9", "tags": ["a", 9]}', NULL, 9000),
('SKU-010', 'Product 10', 32.50, '{"color": "c10", "tags": ["a", 10]}', X'0acafe', 10000);

INSERT INTO orders (customer_id, created_at, status) VALUES
(2, '2024-03-01 13:00:00', 'paid'), (3, '2024-03-01 14:00:00', 'shipped'),
(4, '2024-03-01 15:00:00', 'new'), (5, '2024-03-01 16:00:00', 'paid'),
(6, '2024-03-01 17:00:00', 'shipped'), (7, '2024-03-01 18:00:00', 'new'),
(8, '2024-03-01 19:00:00', 'paid'), (9, '2024-03-01 20:00:00', 'shipped'),
(10, '2024-03-01 21:00:00', 'new'), (11, '2024-03-01 22:00:00', 'paid'),
(1, '2024-03-01 23:00:00', 'shipped'), (1, '2024-03-02 00:00:00', 'new'),
(2, '2024-03-02 01:00:00', 'paid'), (3, '2024-03-02 02:00:00', 'shipped'),
(4, '2024-03-02 03:00:00', 'new'), (5, '2024-03-02 04:00:00', 'paid'),
(6, '2024-03-02 05:00:00', 'shipped'), (7, '2024-03-02 06:00:00', 'new'),
(8, '2024-03-02 07:00:00', 'paid'), (9, '2024-03-02 08:00:00', 'shipped');

INSERT INTO order_items (order_id, product_id, qty) VALUES
(1, 1, 2), (1, 2, 1), (2, 3, 4), (2, 4, 1), (3, 5, 2), (3, 6, 3),
(4, 7, 1), (4, 8, 2), (5, 9, 3), (5, 10, 1), (6, 1, 2), (6, 3, 1),
(7, 2, 4), (8, 4, 1), (9, 5, 2), (10, 6, 3), (11, 7, 1), (12, 8, 2),
(13, 9, 3), (14, 10, 1), (15, 1, 2), (16, 2, 1), (17, 3, 4), (18, 4, 1),
(19, 5, 2), (20, 6, 3);

INSERT INTO audit_log (msg, at) VALUES
('seeded', '2024-01-01 00:00:00'), ('checked', NULL), (NULL, '2024-01-02 00:00:00');
