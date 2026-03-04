import type { View } from "@slack/types";

export interface AgentRefineMetadata {
  planId: string;
}

export function agentRefineModal(planId: string): View {
  const metadata: AgentRefineMetadata = { planId };

  return {
    type: "modal",
    callback_id: "agent_refine_submit",
    private_metadata: JSON.stringify(metadata),
    title: { type: "plain_text", text: "Refine task" },
    submit: { type: "plain_text", text: "Re-generate plan" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "refinement",
        label: { type: "plain_text", text: "What would you like to change?" },
        element: {
          type: "plain_text_input",
          action_id: "refinement_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "e.g. Focus only on the security bugs, skip the UI issues",
          },
        },
      },
    ],
  };
}
