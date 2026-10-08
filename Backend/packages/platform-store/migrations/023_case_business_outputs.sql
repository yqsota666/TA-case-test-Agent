CREATE TABLE case_business_outputs (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 workspace_id BIGINT UNSIGNED NOT NULL,
 chat_id BIGINT UNSIGNED NOT NULL,
 case_id BIGINT UNSIGNED NOT NULL,
 plan_version INT UNSIGNED NOT NULL,
 request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_kind VARCHAR(24) NOT NULL,
 content_text MEDIUMTEXT NOT NULL,
 content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_business_output_request (workspace_id,chat_id,case_id,request_id),
 KEY ix_business_output_latest (workspace_id,chat_id,case_id,plan_version,id),
 CONSTRAINT fk_business_output_case FOREIGN KEY (workspace_id,chat_id,case_id) REFERENCES cases(workspace_id,chat_id,id),
 CONSTRAINT fk_business_output_plan FOREIGN KEY (workspace_id,chat_id,case_id,plan_version) REFERENCES case_sop_versions(workspace_id,chat_id,case_id,version_number),
 CONSTRAINT fk_business_output_actor FOREIGN KEY (workspace_id,actor_user_id) REFERENCES workspaces(id,owner_user_id),
 CONSTRAINT ck_business_output_kind CHECK (source_kind IN ('USER_RESULT','SYNTHETIC_TEST'))
) ENGINE=InnoDB;
