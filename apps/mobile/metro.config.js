// Expo detects the Bun workspace and watches the repository root, so workspace packages resolve
// through their `exports` maps like any dependency.
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

const config = getDefaultConfig(__dirname);

// The configured application, written by `bun run mobile:prepare`. The starter imports it by this
// name so its source never names content, as the web frame does with its screens.
const ENTRY = 'virtual:agent-native/mobile-entry';
const entryFile = join(__dirname, 'generated', 'entry.ts');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === ENTRY) {
    if (!existsSync(entryFile))
      throw new Error('No mobile entry: run `bun run mobile:prepare` first');
    return { type: 'sourceFile', filePath: entryFile };
  }
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    // Workspace sources import TypeScript siblings as `./name.js`, as Node's ESM resolution and
    // TypeScript expect; Metro looks for a `.js` file, so retry with the extension left to it.
    if (!/^\.\.?\/.*\.js$/.test(moduleName)) throw error;
    return context.resolveRequest(context, moduleName.slice(0, -3), platform);
  }
};

// Uniwind compiles `className` at build time; it must be the outermost wrapper.
module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './generated/uniwind-types.d.ts',
});
