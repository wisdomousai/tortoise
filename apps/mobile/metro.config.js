// Expo detects the Bun workspace and watches the repository root, so workspace packages resolve
// through their `exports` maps like any dependency.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
