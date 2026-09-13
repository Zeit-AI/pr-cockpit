// Prompt template buttons for the review chat. Clicking one queues the text as an ordinary message -
// the server has no notion of templates - so editing this list is the whole cost of changing them.
// They do not mention the HTML: the agent's system prompt already establishes that structural answers
// go there, and repeating it in every message would be instruction the agent already has.
export const REVIEW_PROMPTS = [
  {
    label: "Overview",
    message:
      "Give me an overview of this PR: what it changes, how the system behaves differently afterwards, and anything controversial or unexpected.",
  },
  {
    label: "Call traces",
    message:
      "Trace the changed backend code from its entry points, map the component tree and state for the changed frontend code, and find every use site of the changed types.",
  },
  {
    label: "Blast radius",
    message: "Which subsystems and components does this change reach, including ones the diff doesn't touch?",
  },
  {
    label: "Quiz",
    message: "Quiz me on this PR to check I actually understood it, with the answers hidden until I click them.",
  },
];
