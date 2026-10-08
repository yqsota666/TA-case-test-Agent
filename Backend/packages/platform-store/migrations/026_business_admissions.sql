CREATE TABLE case_business_admissions (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  input_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lease CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  decision VARCHAR(8) NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id,chat_id,case_id,input_hash),
  CONSTRAINT fk_business_admission_case FOREIGN KEY (workspace_id,chat_id,case_id)
    REFERENCES cases(workspace_id,chat_id,id),
  CONSTRAINT ck_business_admission_decision CHECK (decision IS NULL OR decision IN ('ALLOW','CLARIFY','REJECT'))
) ENGINE=InnoDB;
