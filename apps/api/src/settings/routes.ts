import { testProvider } from '@goodies-beacon/ai';
import {
  AI_PROVIDERS,
  type AiProvider,
  aiProvidersFromEnv,
  type Config,
  createHttpClient,
  createMemoryCookieJar,
  type Database,
  isEmailConfigured,
  type Logger,
  readSettings,
  resolveEbay,
  resolveSmtp,
  settingsPatchSchema,
  toPublicSettings,
  writeSettings,
} from '@goodies-beacon/core';
import { SmtpError, sendMail, testMessage } from '@goodies-beacon/email';
import { ebayAdapter } from '@goodies-beacon/source-ebay';
import { Hono } from 'hono';
import { errorResponse } from '../errors.js';
import { parseBody } from '../parse.js';

export interface SettingsRouteDeps {
  readonly db: Database;
  readonly config: Pick<Config, 'host' | 'secretKey' | 'ai'>;
  readonly logger: Logger;
}

/**
 * `/api/settings`, behind the session guard. The SMTP password only ever travels inwards: it is
 * stored encrypted and answered for with `passwordSet`, so a save that leaves it out keeps it.
 */
export function createSettingsRoutes({ db, config, logger }: SettingsRouteDeps) {
  const routes = new Hono();

  // `.env` keys count as configured even though Settings holds none, so the UI does not show an
  // empty box beside a provider that is, in fact, working (§12 allows either source).
  const publicSettings = async () =>
    toPublicSettings(await readSettings(db), aiProvidersFromEnv(config.ai));

  routes.get('/', async (c) =>
    c.json({ settings: await publicSettings(), instanceHost: config.host }),
  );

  routes.put('/', async (c) => {
    const body = await parseBody(c, settingsPatchSchema);
    if (!body.ok) return errorResponse(c, 400, 'validation_failed', body.message);

    const saved = await writeSettings(db, body.value, config.secretKey);
    return c.json({
      settings: toPublicSettings(saved, aiProvidersFromEnv(config.ai)),
      instanceHost: config.host,
    });
  });

  /**
   * The Test button beside each AI provider (§9). It makes the smallest real call the provider
   * will take, with the model a role is actually configured to use — a key can be valid and still
   * have no access to the model someone typed, and that is the failure worth catching here rather
   * than in the first review.
   */
  routes.post('/ai/:provider/test', async (c) => {
    const provider = c.req.param('provider');
    if (!(AI_PROVIDERS as readonly string[]).includes(provider)) {
      return errorResponse(c, 404, 'unknown_provider', `No such AI provider: ${provider}.`);
    }

    const health = await testProvider(provider as AiProvider, {
      settings: await readSettings(db),
      secretKey: config.secretKey,
      env: config.ai,
    });

    return c.json({ health });
  });

  /**
   * Sends to the configured notification address and nowhere else. The address is deliberately
   * not a parameter: an endpoint that mails wherever it is told is an open relay wearing a
   * different hat, and this one is reachable by anyone holding a session.
   */
  routes.post('/email/test', async (c) => {
    const settings = await readSettings(db);
    if (!isEmailConfigured(settings.email)) {
      const message = 'Set the SMTP host, from address and notification address first.';
      return errorResponse(c, 409, 'email_not_configured', message);
    }

    const smtp = resolveSmtp(settings, config.secretKey);
    if (!smtp) return errorResponse(c, 409, 'email_not_configured', 'Email is not configured.');

    try {
      await sendMail(smtp, { ...testMessage(config.host), to: smtp.notificationAddress });
      return c.json({ sentTo: smtp.notificationAddress });
    } catch (error) {
      if (error instanceof SmtpError) {
        // Verbatim: what the server said is the only useful thing to show.
        return errorResponse(c, 502, 'smtp_failed', error.detail);
      }
      throw error;
    }
  });

  /**
   * The eBay Test button (§5). Runs the adapter's own `healthCheck`, so what Settings reports is
   * exactly what a poll would hit — including the daily quota, which is the number worth seeing.
   */
  routes.post('/sources/ebay/test', async (c) => {
    const stored = await readSettings(db);
    const credentials = resolveEbay(stored, config.secretKey);
    if (!credentials) {
      const message = 'Set the eBay App ID and Cert ID first.';
      return errorResponse(c, 409, 'ebay_not_configured', message);
    }

    const http = createHttpClient({
      concurrency: 1,
      userAgent: 'goodies-beacon (settings test)',
      ...(credentials.proxyUrl ? { proxyUrl: credentials.proxyUrl } : {}),
    });

    try {
      const health = await ebayAdapter.healthCheck({
        source: 'ebay',
        http,
        cookies: createMemoryCookieJar(),
        browser: null,
        logger,
        credentials: {
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          sellerSalt: 'settings-test',
        },
      });

      const exit = credentials.proxyUrl
        ? await http.exitAddress().catch(() => undefined)
        : undefined;

      return c.json({ health, ...(exit ? { exit } : {}) });
    } finally {
      await http.close();
    }
  });

  return routes;
}
