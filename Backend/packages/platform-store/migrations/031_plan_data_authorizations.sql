CREATE TABLE case_plan_data_authorizations (
 workspace_id BIGINT UNSIGNED NOT NULL,
 chat_id BIGINT UNSIGNED NOT NULL,
 case_id BIGINT UNSIGNED NOT NULL,
 version_number INT UNSIGNED NOT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 authorized_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (workspace_id,chat_id,case_id,version_number),
 CONSTRAINT fk_plan_data_authorization_version FOREIGN KEY (workspace_id,chat_id,case_id,version_number) REFERENCES case_sop_versions(workspace_id,chat_id,case_id,version_number),
 CONSTRAINT fk_plan_data_authorization_actor FOREIGN KEY (workspace_id,actor_user_id) REFERENCES workspaces(id,owner_user_id)
) ENGINE=InnoDB;
