-- Shared wire counters carry no customer data. A real TA channel shares this namespace.
CREATE TABLE IF NOT EXISTS ta_daily_sequences (
  ta_environment_id BIGINT UNSIGNED NOT NULL,
  ta_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  distributor_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  business_date DATE NOT NULL,
  last_summary_no INT UNSIGNED NOT NULL,
  PRIMARY KEY (ta_environment_id,ta_code,distributor_code,business_date),
  CONSTRAINT fk_sequence_environment FOREIGN KEY (ta_environment_id) REFERENCES ta_environments(id),
  CONSTRAINT ck_sequence_limit CHECK (last_summary_no BETWEEN 1 AND 99999999)
) ENGINE=InnoDB;
