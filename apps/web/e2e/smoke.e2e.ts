import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { seedCandidates } from './seed.js';

/** The same database the app under test is using; P1-15's rows are written straight into it. */
const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? '';

const PASSWORD = 'a-good-enough-password';
const NEW_PASSWORD = 'an-even-better-password';

/** The worked examples P1-02 keeps, entered exactly as they are written (P1-13). */
const example = (name: string): Spec =>
  JSON.parse(
    readFileSync(
      new URL(`../../../packages/core/src/domain/fixtures/${name}.json`, import.meta.url),
      'utf8',
    ),
  );

interface Spec {
  criteria: { id: string; text: string; kind: string }[];
  [key: string]: unknown;
}

const carmageddon = example('carmageddon');
const powerMac = example('power-mac-5500');

/** A 1×1 PNG: enough for sharp to re-encode, small enough to read in a diff. */
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Mailpit's HTTP API, so a "Send test email" click can be checked against a real inbox. */
const MAILPIT = process.env.E2E_MAILPIT_URL;

interface InboxMessage {
  Subject: string;
  To: { Address: string }[];
}

async function inbox(): Promise<InboxMessage[]> {
  const res = await fetch(`${MAILPIT}/api/v1/messages`);
  return ((await res.json()) as { messages: InboxMessage[] }).messages;
}

/**
 * One test rather than several: the instance has a single password and a single user, so these
 * steps are one story and splitting them would only make them depend on each other in secret.
 */
test('first run, settings, a wanted item, and deep links survive a refresh', async ({ page }) => {
  const section = (name: string) => page.getByRole('region', { name });
  const history = section('Version history');
  // The editor has its own back link with the same name, so the sidebar one is named exactly.
  const nav = page.getByRole('link', { name: 'Wanted items', exact: true });
  // Captured when the item is created, so the seeded candidates hang off the real one.
  let carmageddonId = '';
  const verdictFilter = page.getByRole('navigation', { name: 'Verdict' });

  await test.step('an unauthenticated visit lands on the first-run page', async () => {
    await page.goto('/');

    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('heading', { name: 'Goodies Beacon' })).toBeVisible();
    await expect(page.getByText('Choose a password')).toBeVisible();
  });

  await test.step('setting the password signs you in and shows the dashboard', async () => {
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Set password' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Nothing is being watched yet.')).toBeVisible();
  });

  await test.step('the navigation reaches settings, which shows the instance address', async () => {
    await page.getByRole('link', { name: 'Settings' }).click();

    await expect(page).toHaveURL('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByLabel('Time zone')).toHaveValue('Europe/London');
    await expect(page.getByLabel('Digest time')).toHaveValue('08:00');
  });

  await test.step('a deep link still works after a refresh, not a 404', async () => {
    await page.reload();

    await expect(page).toHaveURL('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  await test.step('a setting can be saved and survives a reload', async () => {
    await page.getByLabel('Time zone').fill('Asia/Tokyo');
    await section('Instance').getByRole('button', { name: 'Save' }).click();
    await expect(section('Instance').getByRole('status')).toHaveText('Saved.');

    await page.reload();
    await expect(page.getByLabel('Time zone')).toHaveValue('Asia/Tokyo');
  });

  await test.step('signing out returns you to login and locks the pages again', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveURL('/login');
    await expect(page.getByText('Sign in to your instance.')).toBeVisible();

    await page.goto('/settings');
    await expect(page).toHaveURL('/login');
  });

  await test.step('a wrong password is refused with a message', async () => {
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toHaveText('That password is not correct.');
    await expect(page).toHaveURL('/login');
  });

  await test.step('the right password signs you back in', async () => {
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  await test.step('visiting login while signed in goes to the dashboard', async () => {
    await page.goto('/login');

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  await test.step('the SMTP settings save, and the password is stored but never shown', async () => {
    await page.goto('/settings');

    await page.getByLabel('SMTP host').fill('localhost');
    await page.getByLabel('Port').fill('1025');
    await page.getByLabel('Security').selectOption('none');
    await page.getByLabel('From address').fill('beacon@example.com');
    await page.getByLabel('Notification address').fill('owner@example.com');
    await page.getByLabel('Password', { exact: true }).fill('hunter2');
    await section('Email').getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Stored encrypted. Leave it alone')).toBeVisible();

    await page.reload();
    const password = page.getByLabel('Password', { exact: true });
    await expect(password).toHaveValue('');
    await expect(password).toHaveAttribute('placeholder', '••••••••');
    // The page never received it, so it cannot be read back out of the form either.
    await expect(page.locator('body')).not.toContainText('hunter2');
  });

  await test.step('saving the section again keeps the password that was not re-typed', async () => {
    await page.getByLabel('SMTP host').fill('127.0.0.1');
    await section('Email').getByRole('button', { name: 'Save' }).click();
    await expect(section('Email').getByRole('status')).toHaveText('Saved.');

    await page.reload();
    await expect(page.getByLabel('SMTP host')).toHaveValue('127.0.0.1');
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
      'placeholder',
      '••••••••',
    );
  });

  await test.step('Send test email reports where it went', async () => {
    if (MAILPIT) await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });

    await page.getByRole('button', { name: 'Send test email' }).click();

    await expect(page.getByText('Test email sent to owner@example.com.')).toBeVisible();

    if (MAILPIT) {
      const messages = await inbox();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.Subject).toBe('Goodies Beacon test email');
      expect(messages[0]?.To[0]?.Address).toBe('owner@example.com');
    }
  });

  await test.step('a bad SMTP host is reported in the mail server’s own words', async () => {
    await page.getByLabel('Port').fill('1');
    await page.getByRole('button', { name: 'Send test email' }).click();

    await expect(section('Email').getByRole('alert')).toContainText('The mail server said:');
    await expect(section('Email').getByRole('alert')).toContainText(/ECONNREFUSED|connect/i);

    await page.getByLabel('Port').fill('1025');
    await section('Email').getByRole('button', { name: 'Save' }).click();
    await expect(section('Email').getByRole('status').last()).toHaveText('Saved.');
  });

  await test.step('the Carmageddon example is entered as a wanted item', async () => {
    await nav.click();

    await expect(page).toHaveURL('/items');
    await expect(page.getByText('No wanted items yet.')).toBeVisible();

    await page.getByRole('link', { name: 'New wanted item' }).click();
    await page.getByLabel('Title').fill('Carmageddon big box');
    await page.getByLabel('Status').selectOption('active');
    await page.getByLabel('Spec').fill(JSON.stringify(carmageddon, null, 2));
    await page.getByRole('button', { name: 'Create item' }).click();

    // Creating navigates to the item's own editor, which is where the version history lives.
    await expect(page).toHaveURL(/\/items\/[0-9a-f-]+\/edit$/);
    carmageddonId = new URL(page.url()).pathname.split('/')[2] as string;
    await expect(page.getByText('Version 1 is the one polling uses.')).toBeVisible();
    await expect(history.getByText('Version 1', { exact: true })).toBeVisible();
    await expect(history.getByText('First version, entered by hand.')).toBeVisible();
  });

  await test.step('a spec the schema rejects cannot be saved, and the error names the path', async () => {
    const broken = { ...carmageddon, criteria: [{ ...carmageddon.criteria[0], text: '' }] };
    await page.getByLabel('Spec').fill(JSON.stringify(broken, null, 2));

    // The first alert is the editor's own; the upload panel adds a second when it cannot insert.
    const problems = page.getByRole('alert').first();
    await expect(problems).toContainText('criteria.0.text');
    await expect(problems).toContainText('a criterion needs text');
    await expect(page.getByRole('button', { name: 'Save new version' })).toBeDisabled();

    // And a document that is not JSON at all says so rather than pretending it is a schema fault.
    await page.getByLabel('Spec').fill('{ "summary": }');
    await expect(problems).toContainText('JSON');
  });

  await test.step('a hard criterion the photos cannot settle is a warning, not a refusal', async () => {
    const hardened = {
      ...carmageddon,
      criteria: carmageddon.criteria.map((criterion) =>
        criterion.id === 'disc-readable' ? { ...criterion, kind: 'hard' } : criterion,
      ),
    };
    await page.getByLabel('Spec').fill(JSON.stringify(hardened, null, 2));

    await expect(page.getByRole('status').filter({ hasText: 'disc-readable' })).toContainText(
      'hard but not quantifiable',
    );
    await expect(page.getByRole('button', { name: 'Save new version' })).toBeEnabled();
  });

  await test.step('a reference image is uploaded, labelled, and added to the spec', async () => {
    await page.getByLabel('Label').fill('UK big box, front');
    await page.getByLabel('Image').setInputFiles({
      name: 'box.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_1PX, 'base64'),
    });
    await page.getByRole('button', { name: 'Upload and add' }).click();

    await expect(page.getByText('Added to the spec: UK big box, front.')).toBeVisible();
    await expect(page.getByLabel('Spec')).toHaveValue(/UK big box, front/);
  });

  await test.step('saving again writes version 2 and leaves version 1 in the history', async () => {
    await page.getByLabel('Change note').fill('Hardened the disc criterion; added a photo.');
    await page.getByRole('button', { name: 'Save new version' }).click();

    await expect(page.getByText('Saved as version 2.')).toBeVisible();

    await page.reload();
    await expect(page.getByText('Version 2 is the one polling uses.')).toBeVisible();
    await expect(history.getByText('Hardened the disc criterion; added a photo.')).toBeVisible();
    await expect(history.getByText('First version, entered by hand.')).toBeVisible();
    // The editor reopens on the stored document, image and all.
    await expect(page.getByLabel('Spec')).toHaveValue(/UK big box, front/);
  });

  await test.step('the Power Mac 5500 example goes in as a second item', async () => {
    await nav.click();
    await page.getByRole('link', { name: 'New wanted item' }).click();

    await page.getByLabel('Title').fill('Power Macintosh 5500');
    await page.getByLabel('Spec').fill(JSON.stringify(powerMac, null, 2));
    await page.getByRole('button', { name: 'Create item' }).click();

    await expect(page.getByText('Version 1 is the one polling uses.')).toBeVisible();

    await nav.click();
    await expect(page.getByRole('link', { name: 'Carmageddon big box' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Power Macintosh 5500' })).toBeVisible();
  });

  await test.step('the list says what each item is doing', async () => {
    const row = page.getByRole('listitem').filter({ hasText: 'Carmageddon big box' });

    await expect(row).toContainText('active');
    await expect(row).toContainText('Real-time email');
    await expect(row).toContainText('version 2');
    await expect(row).toContainText('Never polled');
    await expect(row).toContainText('0 candidates');
  });

  await test.step('the item page renders the spec as a card rather than as JSON', async () => {
    await page.getByRole('link', { name: 'Carmageddon big box' }).click();

    await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: 'Carmageddon big box' })).toBeVisible();

    const spec = section('Current spec');
    // The settings, as the bounded values they are — not as criteria (§4's split).
    await expect(spec).toContainText('£120');
    await expect(spec).toContainText('real-time email');
    await expect(spec).toContainText('auction and fixed');
    // Every criterion in plain English with its flags.
    await expect(spec).toContainText('Big box release, not the jewel case or budget re-release');
    await expect(spec).toContainText('hard — rejects');
    await expect(spec).toContainText('the photos may not settle it');
    // And the reference image uploaded earlier, under the label the reviewer is shown.
    await expect(spec).toContainText('UK big box, front');
    await expect(spec).toContainText('1 image sent with every review of this item.');
  });

  await test.step('every search plan is listed with its stats, unrun ones included', async () => {
    const plans = section('Search plans');

    await expect(plans.getByRole('row')).toHaveCount(4);
    await expect(plans).toContainText('ebay · EBAY_GB');
    await expect(plans).toContainText('ebay · EBAY_US');
    await expect(plans).toContainText('carmageddon big box');
    await expect(plans.getByRole('row').nth(1)).toContainText('never');
  });

  await test.step('polling is paused and resumed without writing a spec version', async () => {
    const history = section('Version history');
    await expect(history.getByRole('listitem')).toHaveCount(2);

    await page.getByRole('button', { name: 'Pause polling' }).click();
    await expect(page.getByText('paused', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Start polling' })).toBeVisible();
    // Still two versions: pausing says nothing about what the item is looking for.
    await expect(history.getByRole('listitem')).toHaveCount(2);

    await page.getByRole('button', { name: 'Start polling' }).click();
    await expect(page.getByRole('button', { name: 'Pause polling' })).toBeVisible();
  });

  await test.step('Scan current listings is present and disabled until Phase 5', async () => {
    await expect(page.getByRole('button', { name: 'Scan current listings' })).toBeDisabled();
  });

  await test.step('judged candidates appear in the audit view, rejections included', async () => {
    await seedCandidates(databaseUrl, carmageddonId, [
      {
        title: 'Carmageddon PC CD-ROM big box, complete',
        externalId: 'e2e-match',
        decision: 'match',
        englishSummary: 'A complete big box copy with the manual and disc pictured.',
        description: 'Boxed & complete — no water damage.',
        promptText: 'SYSTEM\n\n# The wanted item\nCarmageddon\n\n# The listing\nBig box, complete',
        criteriaResults: [
          {
            criterionId: 'big-box',
            result: 'pass',
            evidence: 'the big box is pictured front and back',
          },
          {
            criterionId: 'contents-complete',
            result: 'pass',
            evidence: 'manual and disc are shown',
          },
        ],
      },
      {
        title: 'Carmageddon, box only, no disc',
        externalId: 'e2e-uncertain',
        decision: 'uncertain',
        englishSummary: 'The box is shown but nothing inside it is.',
        criteriaResults: [
          { criterionId: 'big-box', result: 'pass', evidence: 'the big box is pictured' },
          {
            criterionId: 'contents-complete',
            result: 'unknown',
            evidence: 'contents not shown or mentioned',
          },
        ],
      },
      {
        title: 'Carmageddon t-shirt, size L',
        externalId: 'e2e-reject',
        decision: 'reject',
        reason: 'prefilter',
        englishSummary: 'This is a t-shirt, not the game.',
      },
    ]);

    await page.getByRole('link', { name: 'Candidates', exact: true }).click();

    await expect(page).toHaveURL('/candidates');
    await expect(page.getByText('3 candidates')).toBeVisible();
    await expect(page.getByText('Carmageddon PC CD-ROM big box, complete')).toBeVisible();
    // The audit view: a rejection is listed beside the matches, not behind a toggle.
    await expect(page.getByText('Carmageddon t-shirt, size L')).toBeVisible();
    await expect(page.getByText('discarded by the pre-filter')).toBeVisible();
  });

  await test.step('the filters narrow it and survive a reload, so a view can be linked to', async () => {
    await verdictFilter.getByRole('link', { name: 'Rejected' }).click();

    await expect(page).toHaveURL('/candidates?decision=reject');
    await expect(page.getByText('1 candidate', { exact: true })).toBeVisible();
    await expect(page.getByText('Carmageddon t-shirt, size L')).toBeVisible();
    await expect(page.getByText('Carmageddon PC CD-ROM big box, complete')).toBeHidden();

    await page.reload();
    await expect(page.getByText('Carmageddon t-shirt, size L')).toBeVisible();

    await verdictFilter.getByRole('link', { name: 'Uncertain' }).click();
    await expect(page.getByText('Carmageddon, box only, no disc')).toBeVisible();
  });

  await test.step('the item page counts link straight into the filtered view', async () => {
    await nav.click();
    await page.getByRole('link', { name: 'Carmageddon big box' }).click();
    await page.getByRole('link', { name: /Matched/ }).click();

    await expect(page).toHaveURL(/\/candidates\?item=[0-9a-f-]+&decision=match$/);
    await expect(page.getByText('Carmageddon PC CD-ROM big box, complete')).toBeVisible();
    await expect(page.getByText('Carmageddon t-shirt, size L')).toBeHidden();
  });

  await test.step('a candidate shows its verdict, its evidence and the exact prompt sent', async () => {
    await page.getByText('Carmageddon PC CD-ROM big box, complete').click();

    await expect(page).toHaveURL(/\/candidates\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Carmageddon PC CD-ROM big box, complete',
    );
    // Price in GBP with the original beside it, and the ships-to-UK flag §1 asks for.
    await expect(page.getByText('£95.00 (USD 120.00)')).toBeVisible();
    await expect(page.getByText('ships to the UK')).toBeVisible();

    const verdict = section('Verdict');
    await expect(verdict).toContainText('the big box is pictured front and back');
    await expect(verdict).toContainText('manual and disc are shown');
    // The description was stored as text: the entity is decoded and no markup survives.
    await expect(page.getByText('Boxed & complete — no water damage.')).toBeVisible();

    await page.getByRole('button', { name: 'Show prompt' }).click();
    await expect(page.getByText('# The wanted item')).toBeVisible();
    await expect(page.getByText('1 image were sent with it')).toBeVisible();
    await expect(page.getByText('reference: UK big box, front')).toBeVisible();

    await page.getByRole('button', { name: 'Hide prompt' }).click();
    await expect(page.getByText('# The wanted item')).toBeHidden();
  });

  await test.step('an uncertain verdict says exactly what could not be established', async () => {
    await page.goBack();
    await verdictFilter.getByRole('link', { name: 'Uncertain' }).click();
    await page.getByText('Carmageddon, box only, no disc').click();

    await expect(page.getByText('contents not shown or mentioned')).toBeVisible();
    await expect(page.getByText('UK shipping unknown')).toBeVisible();
  });

  await test.step('Retain keeps a candidate, and the feedback loop waits for Phase 5', async () => {
    await page.getByRole('button', { name: 'Retain' }).click();
    await expect(page.getByRole('button', { name: 'Stop retaining' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Stop retaining' })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Not a match' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Challenge' })).toBeDisabled();
  });

  await test.step('the candidate page works on a phone, which is where digest links open', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the listing' })).toBeVisible();

    /**
     * Nothing may push the page wider than the screen: the gallery scrolls, it does not stretch.
     * Written as a string because the expression runs in the browser, and the tests are
     * typechecked without the DOM library — which is right for every other file here.
     */
    const overflow = await page.evaluate<number>(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  await test.step('the password can be changed, and the new one is what signs you in', async () => {
    await page.goto('/settings');

    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByLabel('New password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();

    await expect(section('Account').getByText('Password changed.')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL('/login');

    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('That password is not correct.');

    await page.getByLabel('Password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');
  });
});
