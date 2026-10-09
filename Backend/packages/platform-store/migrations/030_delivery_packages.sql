CREATE TABLE exchange_delivery_profiles (
  workspace_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  profile_json JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id,channel_id),
  CONSTRAINT fk_delivery_profile_channel FOREIGN KEY (workspace_id,channel_id)
    REFERENCES exchange_channels(workspace_id,id)
) ENGINE=InnoDB;

CREATE TABLE exchange_delivery_packages (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  batch_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  profile_json JSON NOT NULL,
  manifest_json JSON NOT NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  raw_bytes LONGBLOB NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id,chat_id,batch_id),
  CONSTRAINT fk_delivery_package_batch FOREIGN KEY (workspace_id,chat_id,batch_id)
    REFERENCES exchange_batches(workspace_id,chat_id,id)
) ENGINE=InnoDB;
