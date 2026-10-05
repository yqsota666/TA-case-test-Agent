-- Explicitly mark the public demo account; ordinary accounts cannot be adopted.
CREATE TABLE IF NOT EXISTS platform_demo_accounts (
  demo_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  seeded_at DATETIME(3) NULL,
  UNIQUE KEY uq_demo_user (user_id),
  CONSTRAINT fk_demo_user FOREIGN KEY (user_id) REFERENCES platform_users(id)
) ENGINE=InnoDB;
