-- The pending status is longer than the original VARCHAR(16). MySQL requires
-- dropping and restoring CHECK constraints that reference the modified column.
ALTER TABLE case_sop_versions
  DROP CHECK ck_sop_status,
  DROP CHECK ck_sop_lock,
  MODIFY COLUMN status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  ADD CONSTRAINT ck_sop_status CHECK (status IN ('DRAFT','PENDING_CONFIRMATION','LOCKED')),
  ADD CONSTRAINT ck_sop_lock CHECK ((status='LOCKED')=(locked_at IS NOT NULL));
