import { SOURCE_IDS } from '@goodies-beacon/core';

// P0-06 replaces this with pg-boss wiring, ROLE handling and graceful shutdown.
console.log(`goodies-beacon worker scaffold; known sources: ${SOURCE_IDS.join(', ')}`);
