// Unified workbench replaces the retired agent-scoped acceptance entry.
if (process.argv.includes('--ui-polish')) await import('./ui-polish-smoke.mjs');
else if (process.argv.includes('--real-model-intelligence')) await import('./intelligence-real-model.mjs');
else await import('./unified-workbench-smoke.mjs');
