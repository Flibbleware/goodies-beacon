import { loadConfigOrExit, SOURCE_IDS } from '@goodies-beacon/core';

const config = loadConfigOrExit();
const sources = config.workerSources.length > 0 ? config.workerSources : SOURCE_IDS;

// P0-06 replaces this with pg-boss wiring, ROLE handling and graceful shutdown.
console.log(`goodies-beacon worker scaffold (role=${config.role}); polling: ${sources.join(', ')}`);
