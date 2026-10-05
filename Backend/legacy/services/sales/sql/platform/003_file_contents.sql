-- Original protocol bytes participate in the same transaction as the import.
-- Raw downloads must still verify package ownership and every assigned record.
CREATE TABLE IF NOT EXISTS exchange_file_contents (
  workspace_id BIGINT UNSIGNED NOT NULL,
  file_id BIGINT UNSIGNED NOT NULL,
  original_bytes LONGBLOB NOT NULL,
  PRIMARY KEY (workspace_id,file_id),
  CONSTRAINT fk_file_content FOREIGN KEY (workspace_id,file_id) REFERENCES exchange_files(workspace_id,id)
) ENGINE=InnoDB;
