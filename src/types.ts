/** Shared shape for Bolt action handler `body` with trigger_id and actions. */
export interface ActionBody {
  trigger_id: string;
  channel?: { id: string };
  actions?: Array<{ type?: string; value?: string }>;
}

/** Shape of `body.view` when an action fires inside a modal. */
export interface ModalViewState {
  id: string;
  private_metadata: string;
  state: {
    values: Record<string, Record<string, { selected_conversation?: string }>>;
  };
}
