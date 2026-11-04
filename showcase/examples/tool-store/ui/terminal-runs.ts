/**
 * What the terminal's agent panel sends to start a run. The deterministic demo harness takes a
 * script of tool calls instead of instructions, so each action has a script for it and a prompt for a
 * provider harness. Browser-safe: the panel and the HTTP test build the same runs.
 */

/** A tool ticked on the Tools tab: its key, its tag and the revision its row shows. */
export interface SelectedTool {
  readonly id: string;
  readonly assetTag: string;
  readonly revision: number;
}

/** The UI resource of a tool, as the session context and the `ui.*` tools name it. */
export const toolResource = (tool: { id: string }) => `tool:${tool.id}`;

/** The review title of a calibration pull. */
export const calibrationPullTitle = (tool: SelectedTool) => `Pull ${tool.assetTag} for calibration`;

/** A deterministic harness call: the harness passes `input` to the tool as its envelope. */
const call = (operation: string, input: Record<string, unknown>) => ({
  operation,
  input: { input },
});

/** The demo script of Start run: read each selected tool with `tool.get`. */
export function readToolsScript(tools: readonly SelectedTool[]) {
  return JSON.stringify({
    commands: tools.map((tool) => call('tool.get', { id: tool.id })),
    text: `Read ${tools.map((tool) => tool.assetTag).join(', ')}.`,
  });
}

/**
 * The demo script of Pull for calibration: open the first selected tool at the counter and ask
 * the attendant to review the bin change. It calls no command, so the run changes nothing.
 */
export function calibrationPullScript(tool: SelectedTool) {
  return JSON.stringify({
    commands: [
      call('ui.open', { resource: toolResource(tool) }),
      call('ui.request-review', {
        title: calibrationPullTitle(tool),
        operations: ['tool.update'],
        resources: [toolResource(tool)],
      }),
    ],
    text: `Asked the attendant to pull ${tool.assetTag} for calibration.`,
  });
}

/**
 * The provider prompt of Pull for calibration: the instructions, then how to hand the change to the
 * attendant. A run without an agent definition holds the terminal's whole grant, so only this
 * instruction keeps a model from calling `tool.update` itself.
 */
export function calibrationPullPrompt(instructions: string, tool: SelectedTool) {
  const resource = toolResource(tool);
  return [
    instructions.trim(),
    `Pull ${tool.assetTag} (${resource}) for calibration. Read it with tool.get, then open it at the counter with ui.open and the resource ${resource}.`,
    `Then call ui.request-review with the title "${calibrationPullTitle(tool)}", the operations ["tool.update"] and the resources ["${resource}"].`,
    'Leave the change to the attendant: call no command, and do not call tool.update. The attendant enters the bin and saves it.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
