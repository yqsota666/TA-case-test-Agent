export {
  FIRST_DISCUSSION_PROMPT,
  FIRST_DISCUSSION_PROMPT_VERSION,
  checkFirstDiscussionReply,
  createFirstDiscussionGraph,
  discussFirstTurn,
} from './first-discussion.js';
export { createSophnetCompletion } from './sophnet.js';
export {
  FOLLOWUP_DISCUSSION_PROMPT,
  FOLLOWUP_DISCUSSION_PROMPT_VERSION,
  checkFollowupDiscussionReply,
  createDiscussionGraph,
  discussTurn,
} from './discussion-graph.js';
