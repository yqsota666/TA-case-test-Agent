CREATE TABLE case_application_preparations (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  state_json JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id,chat_id,case_id),
  CONSTRAINT fk_application_preparation_confirmation FOREIGN KEY (workspace_id,chat_id,case_id)
    REFERENCES case_data_confirmations(workspace_id,chat_id,case_id)
) ENGINE=InnoDB;
