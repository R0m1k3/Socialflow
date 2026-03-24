#!/usr/bin/env node
// Pre-bundle Remotion composition during Docker build.
// This warms up the Webpack cache so the first user render is fast.
const { bundle } = require('@remotion/bundler');
const path = require('path');

bundle({ entryPoint: path.resolve(__dirname, '../client/src/remotion/index.ts') })
  .then(loc => console.log('✅ Remotion pre-bundle OK:', loc))
  .catch(e  => { console.warn('⚠️ Remotion pre-bundle skipped:', e.message); process.exit(0); });
