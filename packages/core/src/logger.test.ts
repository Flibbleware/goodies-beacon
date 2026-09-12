import { describe, expect, it, vi } from 'vitest';
import { createConsoleLogger } from './logger.js';

describe('createConsoleLogger', () => {
  it('writes at or above the configured level and drops the rest', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = createConsoleLogger('info');
    logger.info('started');
    logger.debug('noisy');
    logger.error('broken');

    expect(log).toHaveBeenCalledExactlyOnceWith('info: started');
    expect(error).toHaveBeenCalledExactlyOnceWith('error: broken');

    log.mockRestore();
    error.mockRestore();
  });

  it('says nothing at all when LOG_LEVEL is silent', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    createConsoleLogger('silent').error('broken');

    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('appends structured fields as json', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    createConsoleLogger('debug').info('api listening', { port: 3000 });

    expect(log).toHaveBeenCalledExactlyOnceWith('info: api listening {"port":3000}');
    log.mockRestore();
  });
});
