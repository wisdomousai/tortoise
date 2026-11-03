// Expressive Code options live here, not in astro.config.ts, so the <Code> component that the
// tutorial pages use for excerpts can load them; the prompt plugin is not serializable.
import { defineEcConfig } from '@astrojs/starlight/expressive-code';
import { promptBlocks } from './src/plugins/ec-prompt.ts';

export default defineEcConfig({ plugins: [promptBlocks()] });
