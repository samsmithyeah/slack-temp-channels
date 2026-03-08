import type { View } from "@slack/types";
import { LABEL_AGENT_TASK } from "../constants";

export interface AgentTaskMetadata {
  channelId: string;
}

export function agentTaskModal(channelId: string): View {
  const metadata: AgentTaskMetadata = { channelId };

  return {
    type: "modal",
    callback_id: "agent_task_submit",
    private_metadata: JSON.stringify(metadata),
    title: { type: "plain_text", text: LABEL_AGENT_TASK },
    submit: { type: "plain_text", text: "Run task" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "task_description",
        label: { type: "plain_text", text: "Task" },
        element: {
          type: "plain_text_input",
          action_id: "task_description_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "e.g. Reply to each bug report with a summary of the issue and suggested priority",
          },
        },
      },
      {
        type: "input",
        block_id: "options",
        label: { type: "plain_text", text: "Options" },
        optional: true,
        element: {
          type: "checkboxes",
          action_id: "options_input",
          options: [
            {
              text: {
                type: "plain_text",
                text: "Include full channel transcript in the initial prompt",
              },
              value: "include_transcript",
            },
            {
              text: {
                type: "plain_text",
                text: "YOLO mode (skip approval and execute immediately)",
              },
              value: "yolo",
            },
          ],
        },
      },
    ],
  };
}
