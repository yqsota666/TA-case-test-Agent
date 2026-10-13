CREATE TABLE account_model_quotas (
 user_id BIGINT UNSIGNED PRIMARY KEY,
 daily_tokens BIGINT UNSIGNED NOT NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 FOREIGN KEY (user_id) REFERENCES platform_users(id)
);
CREATE TABLE account_demo_users (
 user_id BIGINT UNSIGNED PRIMARY KEY,
 FOREIGN KEY (user_id) REFERENCES platform_users(id)
);
CREATE TABLE model_consumption_exemptions (
 consumption_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 FOREIGN KEY (consumption_id) REFERENCES model_consumption(id)
);
