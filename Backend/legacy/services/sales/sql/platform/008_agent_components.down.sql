-- Stop all Agent workers first. Export component histories before rolling back.
DROP TABLE agent_component_transitions;
DROP TABLE agent_components;
ALTER TABLE agent_runs DROP COLUMN execution_version;
