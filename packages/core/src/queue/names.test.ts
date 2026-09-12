import { describe, expect, it } from 'vitest';
import { SOURCE_IDS } from '../sources.js';
import {
  HEARTBEAT_ROLES,
  heartbeatQueueName,
  heartbeatRolesFor,
  pollQueueName,
  pollSourcesFor,
} from './names.js';

describe('queue names', () => {
  it('puts the source in the poll queue name, so a worker can subscribe to a subset', () => {
    expect(pollQueueName('yahoo_auctions_jp')).toBe('poll.yahoo_auctions_jp');
  });

  it('gives every role its own heartbeat queue', () => {
    expect(HEARTBEAT_ROLES.map(heartbeatQueueName)).toEqual(['heartbeat.api', 'heartbeat.worker']);
  });
});

describe('heartbeatRolesFor', () => {
  it('reports both roles for ROLE=all and one for a single role', () => {
    expect(heartbeatRolesFor('all')).toEqual(['api', 'worker']);
    expect(heartbeatRolesFor('api')).toEqual(['api']);
    expect(heartbeatRolesFor('worker')).toEqual(['worker']);
  });
});

describe('pollSourcesFor', () => {
  it('treats an empty WORKER_SOURCES as every source', () => {
    expect(pollSourcesFor([])).toEqual(SOURCE_IDS);
    expect(pollSourcesFor(['ebay'])).toEqual(['ebay']);
  });
});
