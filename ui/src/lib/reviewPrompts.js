// Two buttons, not a menu of sections. Choosing sections would mean reading the PR first, which is the
// work the agent is here to save; these only signal how much depth is wanted. Which sections a PR
// actually earns is the agent's call, from the PR - see the system prompt in server/reviewAgent.ts.
export const REVIEW_PROMPTS = [
  { label: "Quick overview", message: "Give me a quick overview of this PR." },
  { label: "In depth", message: "Give me an in-depth review of this PR." },
];
