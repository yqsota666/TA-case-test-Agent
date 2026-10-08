CREATE TABLE case_discussion_images (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  turn_number INT UNSIGNED NOT NULL,
  images_json MEDIUMTEXT NOT NULL,
  image_analysis TEXT NOT NULL,
  PRIMARY KEY (workspace_id,chat_id,case_id,turn_number),
  CONSTRAINT fk_discussion_images_turn FOREIGN KEY (workspace_id,chat_id,case_id,turn_number)
    REFERENCES case_discussion_turns(workspace_id,chat_id,case_id,turn_number)
) ENGINE=InnoDB;
