// Prompt template buttons for the review chat. Clicking one sends the text as an ordinary message -
// the server has no notion of templates - so editing this list is the whole cost of changing them.
export const REVIEW_PROMPTS = [
  {
    label: "Overview",
    message:
      "Give me an overview of this PR: what it changes, how the system behaves differently afterwards, and anything controversial or unexpected. Visualise it in the HTML.",
  },
  {
    label: "Call traces",
    message:
      "Add call traces for the changed backend code, the component tree and state for the changed frontend code, and every use site for changed types. Visualise them in the HTML.",
  },
  {
    label: "Blast radius",
    message:
      "Which subsystems and components does this change reach, including ones the diff doesn't touch? Visualise it in the HTML.",
  },
  {
    label: "Quiz",
    message: "Quiz me on this PR to check I actually understood it. Answers hidden until clicked, in the HTML.",
  },
];
