CREATE TABLE case_workflow_checkpoints (
 workspace_id BIGINT UNSIGNED NOT NULL,
 chat_id BIGINT UNSIGNED NOT NULL,
 case_id BIGINT UNSIGNED NOT NULL,
 saver_blob MEDIUMBLOB NOT NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (workspace_id,chat_id,case_id),
 CONSTRAINT fk_workflow_case FOREIGN KEY (workspace_id,chat_id,case_id) REFERENCES cases(workspace_id,chat_id,id)
) ENGINE=InnoDB;

CREATE TABLE case_workflow_events (
 workspace_id BIGINT UNSIGNED NOT NULL,
 chat_id BIGINT UNSIGNED NOT NULL,
 case_id BIGINT UNSIGNED NOT NULL,
 event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 expected_stage VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 response_json JSON NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (workspace_id,chat_id,case_id,event_id),
 CONSTRAINT fk_workflow_event_case FOREIGN KEY (workspace_id,chat_id,case_id) REFERENCES cases(workspace_id,chat_id,id)
) ENGINE=InnoDB;
