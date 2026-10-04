-- Existing completed and pending turns are discussion turns. New proposal
-- requests carry their kind so a retry cannot change the operation.
ALTER TABLE case_discussion_turns
  ADD COLUMN turn_kind VARCHAR(16) NOT NULL DEFAULT 'DISCUSS',
  ADD CONSTRAINT ck_discussion_kind CHECK (turn_kind IN ('DISCUSS','PROPOSE_PLAN'));

ALTER TABLE case_sop_versions
  ADD COLUMN source_turn_number INT UNSIGNED NULL,
  ADD CONSTRAINT fk_sop_source_turn
    FOREIGN KEY (workspace_id,chat_id,case_id,source_turn_number)
    REFERENCES case_discussion_turns(workspace_id,chat_id,case_id,turn_number);
