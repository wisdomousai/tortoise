/**
 * A ```text fence with the meta word `prompt` is a prompt for Claude Code or Codex. The frame
 * says so in its title, the lines wrap and the block gets the `prompt` class the stylesheet
 * styles. The code text stays byte-identical, so the copy button and `scripts/tutorial-run.ts`
 * hand the agent what the page shows.
 */
import { addClassName, definePlugin } from '@astrojs/starlight/expressive-code';

export const promptTitle = 'Paste into Claude Code or Codex';

export function promptBlocks() {
  return definePlugin({
    name: 'prompt',
    hooks: {
      preprocessMetadata: ({ codeBlock }) => {
        if (!codeBlock.metaOptions.getBoolean('prompt')) return;
        codeBlock.props.title = promptTitle;
        codeBlock.props.frame = 'terminal';
        codeBlock.props.wrap = true;
      },
      postprocessRenderedBlock: ({ codeBlock, renderData }) => {
        if (codeBlock.metaOptions.getBoolean('prompt')) addClassName(renderData.blockAst, 'prompt');
      },
    },
  });
}
