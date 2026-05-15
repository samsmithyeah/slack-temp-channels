import { describe, expect, it } from "vitest";
import { exportModal, exportWithFilesModal } from "../../src/modals/export";

describe("exportModal", () => {
  it("returns a modal with callback_id export_submit", () => {
    const view = exportModal("C123", "test-channel");

    expect(view.type).toBe("modal");
    expect(view.callback_id).toBe("export_submit");
  });

  it("encodes channelId:channelName in private_metadata", () => {
    const view = exportModal("C123", "my-channel");

    expect(view.private_metadata).toBe("C123:my-channel");
  });

  it("handles channel names containing colons", () => {
    const view = exportModal("C123", "name:with:colons");

    expect(view.private_metadata).toBe("C123:name:with:colons");
  });

  it("includes radio buttons with text and json options", () => {
    const view = exportModal("C123", "test-channel");
    const blocks = view.blocks as Array<{
      type: string;
      block_id?: string;
      element?: {
        type: string;
        action_id: string;
        options: Array<{ value: string; text: { text: string } }>;
        initial_option: { value: string };
      };
    }>;

    const formatBlock = blocks.find((b) => b.block_id === "export_format");
    expect(formatBlock).toBeDefined();
    expect(formatBlock!.element!.type).toBe("radio_buttons");
    expect(formatBlock!.element!.action_id).toBe("export_format_input");

    const values = formatBlock!.element!.options.map((o) => o.value);
    expect(values).toContain("text");
    expect(values).toContain("json");
  });

  it("defaults to plain text format", () => {
    const view = exportModal("C123", "test-channel");
    const blocks = view.blocks as Array<{
      type: string;
      block_id?: string;
      element?: { initial_option: { value: string } };
    }>;

    const formatBlock = blocks.find((b) => b.block_id === "export_format");
    expect(formatBlock!.element!.initial_option.value).toBe("text");
  });

  it("includes the channel name in the info section", () => {
    const view = exportModal("C123", "my-project");
    const blocks = view.blocks as Array<{
      type: string;
      block_id?: string;
      text?: { text: string };
    }>;

    const infoBlock = blocks.find((b) => b.block_id === "export_info");
    expect(infoBlock!.text!.text).toContain("my-project");
  });
});

describe("exportWithFilesModal", () => {
  it("returns a modal with callback_id export_with_files_submit", () => {
    const view = exportWithFilesModal("C123", "test-channel");

    expect(view.type).toBe("modal");
    expect(view.callback_id).toBe("export_with_files_submit");
  });

  it("encodes channelId:channelName in private_metadata", () => {
    const view = exportWithFilesModal("C123", "my-channel");

    expect(view.private_metadata).toBe("C123:my-channel");
  });

  it("mentions files in the info text", () => {
    const view = exportWithFilesModal("C123", "my-channel");
    const blocks = view.blocks as Array<{
      type: string;
      block_id?: string;
      text?: { text: string };
    }>;

    const infoBlock = blocks.find((b) => b.block_id === "export_info");
    expect(infoBlock!.text!.text).toContain("files");
    expect(infoBlock!.text!.text).toContain("zip");
  });

  it("includes transcript format radio buttons", () => {
    const view = exportWithFilesModal("C123", "test-channel");
    const blocks = view.blocks as Array<{
      type: string;
      block_id?: string;
      element?: {
        type: string;
        options: Array<{ value: string }>;
      };
    }>;

    const formatBlock = blocks.find((b) => b.block_id === "export_format");
    expect(formatBlock).toBeDefined();
    expect(formatBlock!.element!.type).toBe("radio_buttons");

    const values = formatBlock!.element!.options.map((o) => o.value);
    expect(values).toContain("text");
    expect(values).toContain("json");
  });
});
