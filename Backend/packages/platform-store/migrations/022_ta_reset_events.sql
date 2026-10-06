CREATE TABLE ta_reset_events (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 workspace_id BIGINT UNSIGNED NOT NULL,
 channel_id BIGINT UNSIGNED NOT NULL,
 epoch INT UNSIGNED NOT NULL,
 account_id_cutoff BIGINT UNSIGNED NOT NULL,
 request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 reason VARCHAR(2000) NOT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_reset_epoch (workspace_id,channel_id,epoch),
 UNIQUE KEY uq_reset_request (workspace_id,channel_id,request_id),
 CONSTRAINT fk_reset_channel FOREIGN KEY (workspace_id,channel_id) REFERENCES exchange_channels(workspace_id,id),
 CONSTRAINT fk_reset_actor FOREIGN KEY (workspace_id,actor_user_id) REFERENCES workspaces(id,owner_user_id),
 CONSTRAINT ck_reset_reason CHECK (CHAR_LENGTH(TRIM(reason))>0)
) ENGINE=InnoDB;
