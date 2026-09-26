import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { seedCandidates, seedHeartbeats, seedPlanFailure } from './seed.js';

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
/** A different picture, because an upload of the same bytes is the same stored image. */
const PNG_2PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQImWM4oaFxQkMDAAjvAjEWcPVqAAAAAElFTkSuQmCC';

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
  /** On the item page the history is a modal behind a clock button (P1-24). */
  const itemHistory = async () => {
    await page.getByRole('button', { name: 'Version History', exact: true }).click();
    return page.getByRole('dialog', { name: 'Version History' });
  };
  const closeHistory = async () => {
    const dialog = page.getByRole('dialog', { name: 'Version History' });
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  };
  // The editor has its own back link with the same name, so the sidebar one is named exactly.
  const nav = page.getByRole('link', { name: 'Wanted Items', exact: true });
  // Captured when the item is created, so the seeded candidates hang off the real one.
  let carmageddonId = '';
  const verdictFilter = page.getByRole('navigation', { name: 'Verdict' });
  const fromFilter = page.getByRole('navigation', { name: 'From' });
  const sidebar = page.getByRole('navigation', { name: 'Main' });
  const settingsLink = (name: string) => sidebar.getByRole('link', { name, exact: true });

  await test.step('the favicons are served as images, not as the app shell', async () => {
    for (const path of ['/favicon-32.png', '/icon-192.png', '/apple-touch-icon.png']) {
      const res = await page.request.get(path);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toBe('image/png');
    }
  });

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

  await test.step('settings is a heading over its pages, not a page of its own', async () => {
    await expect(sidebar.getByText('Settings', { exact: true })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await expect(sidebar.getByRole('list', { name: 'Settings' }).getByRole('link')).toHaveText([
      'Categories',
      'Sources',
      'Models',
      'Email',
      'Instance',
      'Account',
    ]);

    // A bookmark from when Settings was one page lands on the first of them.
    await page.goto('/settings');
    await expect(page).toHaveURL('/settings/categories');
    await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Wish list' }).click();
    await page.getByRole('link', { name: 'Add categories in Settings' }).click();
    await expect(page).toHaveURL('/settings/categories');
  });

  await test.step('the navigation reaches the instance settings, which show the address', async () => {
    await settingsLink('Instance').click();

    await expect(page).toHaveURL('/settings/instance');
    await expect(page.getByRole('heading', { name: 'Instance' })).toBeVisible();
    await expect(settingsLink('Instance')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByLabel('Time zone')).toHaveValue('Europe/London');
    await expect(page.getByLabel('Digest time')).toHaveValue('08:00');
  });

  await test.step('a deep link still works after a refresh, not a 404', async () => {
    await page.reload();

    await expect(page).toHaveURL('/settings/instance');
    await expect(page.getByRole('heading', { name: 'Instance' })).toBeVisible();
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
    await page.goto('/settings/email');

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

  await test.step('categories are made in Settings, each with an icon and a colour', async () => {
    await settingsLink('Categories').click();
    await expect(page).toHaveURL('/settings/categories');
    const categories = section('Categories');
    const dialog = page.getByRole('dialog', { name: 'Add a category' });
    await expect(categories.getByText('No categories yet.')).toBeVisible();

    for (const [name, icon, colour] of [
      ['Game', 'Gamepad', 'Violet'],
      ['VHS', 'Cassette', 'Blue'],
      ['Toys', 'Robot', 'Pink'],
    ] as const) {
      await categories.getByRole('button', { name: 'Add a category' }).click();
      await dialog.getByLabel('Name').fill(name);
      // The radios are visually hidden inside their labels, and a person clicks the label.
      await dialog.getByTitle(icon, { exact: true }).click();
      await dialog.getByTitle(colour, { exact: true }).click();
      await expect(dialog.getByRole('radio', { name: icon })).toBeChecked();
      await dialog.getByRole('button', { name: 'Add category' }).click();
      await expect(dialog).toBeHidden();
    }

    // A–Z, ignoring case, and a name is unique the same way.
    const rows = categories.getByRole('list', { name: 'Categories' }).getByRole('listitem');
    await expect(rows).toHaveText([/^Game/, /^Toys/, /^VHS/]);
    await categories.getByRole('button', { name: 'Add a category' }).click();
    await dialog.getByLabel('Name').fill('vhs');
    await dialog.getByRole('button', { name: 'Add category' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('There is already a category called vhs.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await categories.getByRole('button', { name: 'Edit Toys' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit Toys' });
    await expect(edit.getByRole('radio', { name: 'Robot' })).toBeChecked();
    await edit.getByLabel('Name').fill('Toy');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(rows).toHaveText([/^Game/, /^Toy/, /^VHS/]);
  });

  await test.step("Create opens a dialog, and lands on the new draft's own page", async () => {
    await nav.click();

    await expect(page).toHaveURL('/items');
    await expect(page.getByText('No wanted items yet.')).toBeVisible();

    await page.getByRole('link', { name: 'Create a wanted item' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create a Wanted Item' });
    const create = dialog.getByRole('button', { name: 'Create', exact: true });

    // A new item is a draft: it starts polling from its own page once it can (P1-26).
    await expect(dialog.getByLabel('Status')).toBeDisabled();
    await expect(dialog.getByLabel('Status')).toHaveValue('draft');
    // An item's title is not a person's, so password managers are told to leave it alone.
    await expect(dialog.getByLabel('Title')).toHaveAttribute('data-bwignore', 'true');
    await expect(dialog.getByLabel('Title')).toHaveAttribute('autocomplete', 'off');
    await dialog.getByLabel('Title').fill('Carmageddon big box');
    await dialog.getByLabel('Category').selectOption({ label: 'Game' });
    // A summary is what the item is, so it is asked for up front.
    await expect(create).toBeDisabled();
    await dialog.getByLabel('Summary').fill(carmageddon.summary as string);
    await create.click();

    await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
    carmageddonId = new URL(page.url()).pathname.split('/')[2] as string;
    await expect(
      page.getByRole('heading', { name: 'Carmageddon big box', level: 1 }),
    ).toBeVisible();
    const versions = await itemHistory();
    await expect(versions.getByRole('listitem')).toHaveCount(1);
    await expect(versions.getByRole('listitem').first()).toContainText('Created.');
    await closeHistory();
  });

  await test.step('a new draft says what it needs before it can poll', async () => {
    const marks = page.getByRole('img', { name: /^Needed before polling/ });
    await expect(marks).toHaveCount(2);
    await expect(section('Criteria').getByRole('img', { name: /criterion/ })).toBeVisible();
    await expect(section('Search Plans').getByRole('img', { name: /search plan/ })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Start polling' })).toBeDisabled();
    await expect(page.getByText('Before it can start polling:')).toBeVisible();
  });

  await test.step('a spec the schema rejects cannot be saved, and the error names the path', async () => {
    await page.getByRole('button', { name: 'JSON', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit JSON' });
    const spec = dialog.getByLabel('Spec');

    const broken = { ...carmageddon, criteria: [{ ...carmageddon.criteria[0], text: '' }] };
    await spec.fill(JSON.stringify(broken, null, 2));
    await expect(dialog).toContainText('criteria.0.text');
    await expect(dialog).toContainText('a criterion needs text');
    await expect(dialog.getByRole('button', { name: 'Save as version 2' })).toBeDisabled();

    // And a document that is not JSON at all says so rather than pretending it is a schema fault.
    await spec.fill('{ "summary": }');
    await expect(dialog).toContainText('JSON');
  });

  await test.step('a hard criterion the photos cannot settle is a warning, not a refusal', async () => {
    const dialog = page.getByRole('dialog', { name: 'Edit JSON' });
    const hardened = {
      ...carmageddon,
      criteria: carmageddon.criteria.map((criterion) =>
        criterion.id === 'disc-readable' ? { ...criterion, kind: 'hard' } : criterion,
      ),
    };
    await dialog.getByLabel('Spec').fill(JSON.stringify(hardened, null, 2));

    await expect(dialog.getByRole('status').filter({ hasText: 'disc-readable' })).toContainText(
      'hard but not quantifiable',
    );
    await expect(dialog.getByRole('button', { name: 'Save as version 2' })).toBeEnabled();
  });

  await test.step('the whole example goes in, and the item can then start polling', async () => {
    const dialog = page.getByRole('dialog', { name: 'Edit JSON' });
    await dialog.getByLabel('Spec').fill(JSON.stringify(carmageddon, null, 2));
    await dialog.getByRole('button', { name: 'Save as version 2' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByRole('img', { name: /^Needed before polling/ })).toHaveCount(0);
    await expect(page.getByText('Before it can start polling:')).toBeHidden();
    await page.getByRole('button', { name: 'Start polling' }).click();
    await expect(page.getByRole('button', { name: 'Pause polling' })).toBeVisible();
  });

  await test.step('the settings editor holds what is typed into it, and Discard writes nothing', async () => {
    await page.getByRole('button', { name: 'Edit settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Settings' });

    await dialog.getByLabel('Price ceiling').fill('95');
    await dialog.getByLabel('Relists').selectOption('suppress');

    // Hours, not ISO 8601, and the hint says what a schedule can actually run (P1-26).
    await dialog.getByLabel('Poll every').pressSequentially('5');
    await expect(dialog.getByLabel('Poll every')).toHaveValue('5');
    await expect(dialog).toContainText('so this polls every 6 hours');

    // Only the marketplace there is an adapter for, grading not at all, and words not codes.
    await expect(dialog.getByRole('checkbox', { name: 'eBay' })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /vinted/i })).toHaveCount(0);
    await expect(dialog.getByLabel('Grading scale')).toHaveCount(0);
    await expect(dialog.getByLabel('Minimum grade')).toHaveCount(0);
    await expect(dialog.getByLabel('How far back').locator('option')).toHaveText([
      'Newest 50',
      'Newest 200',
      'Last 30 days',
    ]);

    // A price with pence must not trip the browser's own validation and block Save.
    await dialog.getByLabel('Price ceiling').fill('149.99');
    const valid = await dialog
      .getByLabel('Price ceiling')
      .evaluate((input) => (input as unknown as { checkValidity(): boolean }).checkValidity());
    expect(valid).toBe(true);
    await expect(dialog.getByRole('button', { name: 'Save as version 3' })).toBeEnabled();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.getByRole('button', { name: 'Discard' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'JSON', exact: true }).click();
    const json = page.getByRole('dialog', { name: 'Edit JSON' });
    await expect(json.getByLabel('Spec')).toHaveValue(/"amount": 120/);
    await expect(json.getByLabel('Spec')).toHaveValue(/"relists": "show"/);
    await json.getByRole('button', { name: 'Cancel' }).click();
    await expect(json).toBeHidden();
  });

  await test.step('a reference image is uploaded, labelled, and saved as a version', async () => {
    await page.getByRole('button', { name: 'Edit reference images' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Reference Images' });

    await dialog.getByLabel('Label').fill('UK big box, front');
    await dialog.getByLabel('Image').setInputFiles({
      name: 'box.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_1PX, 'base64'),
    });
    await dialog.getByRole('button', { name: 'Upload and add' }).click();

    // The panel shows what it stored and says it is not saved yet.
    await expect(dialog.getByRole('img', { name: 'UK big box, front' })).toBeVisible();
    await expect(dialog.getByText('not saved yet')).toBeVisible();

    // Leaving now would strand the file, and the question says so.
    await page.keyboard.press('Escape');
    const ask = dialog.getByRole('alertdialog', { name: 'Unsaved changes' });
    await expect(ask).toContainText('The uploaded image stays on the server');
    await ask.getByRole('button', { name: 'Keep editing' }).click();

    await dialog.getByLabel('Change note').fill('Added a photo of the box.');
    await dialog.getByRole('button', { name: 'Save as version 3' }).click();
    await expect(dialog).toBeHidden();

    await expect(section('Reference Images')).toContainText('UK big box, front');
    const versions = await itemHistory();
    await expect(versions.getByRole('listitem')).toHaveCount(3);
    await expect(versions.getByRole('listitem').first()).toContainText('Added a photo of the box.');
    await closeHistory();
  });

  await test.step('the Power Mac 5500 example goes in as a second item', async () => {
    await nav.click();
    await page.getByRole('link', { name: 'Create a wanted item' }).click();

    const dialog = page.getByRole('dialog', { name: 'Create a Wanted Item' });
    await dialog.getByLabel('Title').fill('Power Macintosh 5500');
    await dialog.getByLabel('Summary').fill(powerMac.summary as string);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Power Macintosh 5500', level: 1 }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'JSON', exact: true }).click();
    const json = page.getByRole('dialog', { name: 'Edit JSON' });
    await json.getByLabel('Spec').fill(JSON.stringify(powerMac, null, 2));
    await json.getByRole('button', { name: 'Save as version 2' }).click();
    await expect(json).toBeHidden();

    await nav.click();
    await expect(page.getByRole('link', { name: 'Carmageddon big box' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Power Macintosh 5500' })).toBeVisible();
  });

  await test.step('the list says what each item is doing', async () => {
    const row = page.getByRole('listitem').filter({ hasText: 'Carmageddon big box' });

    await expect(row).toContainText('active');
    await expect(row).toContainText('Real-time email');
    await expect(row).toContainText('Never polled');
    await expect(row).toContainText('0 matched');
    await expect(row).toContainText('0 uncertain');
    // No display image yet, so the card is headed by its category rather than a photograph.
    await expect(row.locator('img')).toHaveCount(0);
  });

  await test.step('the list filters by category, and an item saved without one is uncategorised', async () => {
    const list = page.getByRole('list', { name: 'Wanted items' });
    const category = page.getByRole('navigation', { name: 'Category' });

    await category.getByRole('link', { name: /^Game/ }).click();
    await expect(page).toHaveURL(/\/items\?category=[0-9a-f-]+$/);
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText('Carmageddon big box');

    // The Power Mac was saved without choosing one.
    await category.getByRole('link', { name: /^Uncategorised/ }).click();
    await expect(page).toHaveURL('/items?category=none');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText('Power Macintosh 5500');

    await category.getByRole('link', { name: /^All/ }).click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
  });

  await test.step('the item page renders the spec as a card rather than as JSON', async () => {
    await page.getByRole('link', { name: 'Carmageddon big box' }).click();

    await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: 'Carmageddon big box' })).toBeVisible();

    // Only Details starts open; every other section is one click away.
    const toggle = (name: string) => page.getByRole('button', { name, exact: true });
    await expect(toggle('Details')).toHaveAttribute('aria-expanded', 'true');
    for (const name of ['Settings', 'Criteria', 'Reference Images', 'Search Plans']) {
      await expect(toggle(name)).toHaveAttribute('aria-expanded', 'false');
      await toggle(name).click();
    }

    const details = section('Details');
    await expect(details).toContainText('Carmageddon, the original 1997 big-box release');
    await expect(details).toContainText('How sellers list this');

    const spec = section('Settings');
    // The settings, as the bounded values they are — not as criteria (§4's split).
    await expect(spec).toContainText('£120');
    await expect(spec).toContainText('Real-time email');
    await expect(spec).toContainText('Auction and Fixed price');
    await expect(spec).not.toContainText('Grading');
    await expect(spec).not.toContainText('Carmageddon, the original 1997 big-box release');
    // Every criterion in plain English with its flags, in a section of its own.
    const criteria = section('Criteria');
    await expect(criteria).toContainText(
      'Big box release, not the jewel case or budget re-release',
    );
    await expect(criteria).toContainText('hard — rejects');
    await expect(criteria).toContainText('the photos may not settle it');
    await expect(spec).not.toContainText('hard — rejects');
    // And the reference image uploaded earlier, under the label the reviewer is shown.
    const images = section('Reference Images');
    await expect(images).toContainText('UK big box, front');
    await expect(images).toContainText('1 image sent with every review of this item.');
  });

  await test.step('every search plan is listed with its stats, unrun ones included', async () => {
    const plans = section('Search Plans');

    await expect(plans.getByRole('row')).toHaveCount(4);
    await expect(plans).toContainText('ebay · EBAY_GB');
    await expect(plans).toContainText('ebay · EBAY_US');
    await expect(plans).toContainText('carmageddon big box');
    await expect(plans.getByRole('row').nth(1)).toContainText('never');
  });

  await test.step('polling is paused and resumed without writing a spec version', async () => {
    await expect((await itemHistory()).getByRole('listitem')).toHaveCount(3);
    await closeHistory();

    await page.getByRole('button', { name: 'Pause polling' }).click();
    await expect(page.getByText('paused', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Start polling' })).toBeVisible();
    // Still three versions: pausing says nothing about what the item is looking for.
    await expect((await itemHistory()).getByRole('listitem')).toHaveCount(3);
    await closeHistory();

    await page.getByRole('button', { name: 'Start polling' }).click();
    await expect(page.getByRole('button', { name: 'Pause polling' })).toBeVisible();
  });

  await test.step('Scan current listings is present and disabled until Phase 5', async () => {
    await expect(page.getByRole('button', { name: 'Scan current listings' })).toBeDisabled();
  });

  await test.step('a section folds away, and stays folded after a reload', async () => {
    const toggle = page.getByRole('button', { name: 'Search Plans', exact: true });
    const table = section('Search Plans').getByRole('table');

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(table).toBeHidden();

    await page.reload();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(table).toBeHidden();

    await toggle.click();
    await expect(table).toBeVisible();
  });

  await test.step('the pencil beside a section edits that section alone, as a new version', async () => {
    await page.getByRole('button', { name: 'Edit criteria' }).click();

    const dialog = page.getByRole('dialog', { name: 'Edit Criteria' });
    const save = dialog.getByRole('button', { name: 'Save as version 4' });
    // Only the criteria: the settings and search plans are other sections' editors.
    await expect(dialog.getByLabel('Price ceiling')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Add a search plan' })).toHaveCount(0);
    await expect(save).toBeDisabled();

    await dialog.getByRole('button', { name: 'Add a criterion' }).click();
    await dialog
      .getByLabel(/^Criterion \d+$/)
      .last()
      .fill('The manual is the original print');

    // Esc with an edit in hand asks rather than throwing it away.
    await page.keyboard.press('Escape');
    const ask = dialog.getByRole('alertdialog', { name: 'Unsaved changes' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Keep editing' }).click();

    await save.click();
    await expect(dialog).toBeHidden();
    await expect(section('Criteria')).toContainText('The manual is the original print');
    const versions = await itemHistory();
    await expect(versions.getByRole('listitem')).toHaveCount(4);
    // Left empty, the note says which section changed rather than repeating the last one.
    await expect(versions.getByRole('listitem').first()).toContainText('Edited the criteria.');
    await closeHistory();
  });

  await test.step('the JSON button edits the whole document, and a broken one cannot be saved', async () => {
    await expect(page.getByRole('link', { name: 'Edit the spec' })).toHaveCount(0);
    await page.getByRole('button', { name: 'JSON', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Edit JSON' });
    const spec = dialog.getByLabel('Spec');
    await expect(spec).toHaveValue(/The manual is the original print/);
    await expect(dialog.getByText('No problems found')).toBeVisible();

    await spec.fill('{ "summary": ');
    await expect(dialog.getByText('One problem stops this saving:')).toBeVisible();
    await expect(dialog.getByText('No problems found')).toBeHidden();
    await expect(dialog.getByRole('button', { name: 'Save as version 5' })).toBeDisabled();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.getByRole('button', { name: 'Discard' }).click();
    await expect(dialog).toBeHidden();
    await expect((await itemHistory()).getByRole('listitem')).toHaveCount(4);
    await closeHistory();
  });

  await test.step('Details renames the item without writing a version', async () => {
    await page.getByRole('button', { name: 'Edit details' }).click();

    const dialog = page.getByRole('dialog', { name: 'Edit Details' });
    await expect(dialog.getByLabel('Status')).toHaveValue('active');
    await dialog.getByLabel('Title').fill('Carmageddon big box, Mac or PC');
    // The title is the item's, not the spec's (P1-25): no version, so no note to ask for.
    await expect(dialog.getByLabel('Change note')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('heading', { name: 'Carmageddon big box, Mac or PC', level: 1 }),
    ).toBeVisible();
    await expect((await itemHistory()).getByRole('listitem')).toHaveCount(4);
    await closeHistory();
  });

  await test.step('a display image heads the card in the list, and is no version either', async () => {
    const display = section('Display image');
    await expect(display).toContainText('None');

    await display.getByRole('button', { name: 'Choose' }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose a Display Image' });
    await dialog.getByRole('button', { name: 'Use UK big box, front' }).click();
    await expect(dialog).toBeHidden();
    await expect(display.getByRole('img')).toBeVisible();
    await expect((await itemHistory()).getByRole('listitem')).toHaveCount(4);
    await closeHistory();

    // One used for nothing else: uploaded here, it never enters the spec.
    await display.getByRole('button', { name: 'Change' }).click();
    await dialog.getByLabel('Image').setInputFiles({
      name: 'shelf.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_2PX, 'base64'),
    });
    await dialog.getByRole('button', { name: 'Upload and use' }).click();
    await expect(dialog).toBeHidden();
    await expect(section('Reference Images')).toContainText(
      '1 image sent with every review of this item.',
    );

    await nav.click();
    const card = page.getByRole('listitem').filter({ hasText: 'Carmageddon big box, Mac or PC' });
    // The picture and its blurred backdrop, both the one stored image.
    await expect(card.locator('img')).toHaveCount(2);
    await expect(card.locator('img').last()).toHaveAttribute('src', /^\/api\/media\/[0-9a-f-]+$/);
    await card.getByRole('link', { name: 'Carmageddon big box, Mac or PC' }).click();
    await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
  });

  await test.step('judged candidates appear in the audit view, matches first', async () => {
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
    // It opens on the matches; there is no "everything" to choose instead.
    await expect(verdictFilter.getByRole('link', { name: 'Matches' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(verdictFilter.getByRole('link')).toHaveText([
      'Matches',
      'Uncertain',
      'Rejected',
      'Queued',
    ]);
    // And on today's: the plain URL is today, as the dashboard's tiles count it (P1-25).
    await expect(fromFilter.getByRole('link')).toHaveText(['Today', 'All']);
    // "page" when the chip's link is this very URL, which the router marks itself.
    await expect(fromFilter.getByRole('link', { name: 'Today' })).toHaveAttribute(
      'aria-current',
      /^(true|page)$/,
    );
    await expect(page.getByText('1 candidate', { exact: true })).toBeVisible();
    await expect(page.getByText('Carmageddon PC CD-ROM big box, complete')).toBeVisible();
    await expect(page.getByText('Carmageddon t-shirt, size L')).toBeHidden();
  });

  await test.step('the filters narrow it and survive a reload, so a view can be linked to', async () => {
    await verdictFilter.getByRole('link', { name: 'Rejected' }).click();

    await expect(page).toHaveURL('/candidates?decision=reject');
    await expect(page.getByText('1 candidate', { exact: true })).toBeVisible();
    // The audit view: a rejection is one chip from the matches, with what rejected it.
    await expect(page.getByText('Carmageddon t-shirt, size L')).toBeVisible();
    await expect(page.getByText('discarded by the pre-filter')).toBeVisible();
    await expect(page.getByText('Carmageddon PC CD-ROM big box, complete')).toBeHidden();

    await page.reload();
    await expect(page.getByText('Carmageddon t-shirt, size L')).toBeVisible();

    await verdictFilter.getByRole('link', { name: 'Uncertain' }).click();
    await expect(page.getByText('Carmageddon, box only, no disc')).toBeVisible();

    // Everything seeded is today's, so All shows the same, and says so in the URL.
    await fromFilter.getByRole('link', { name: 'All' }).click();
    await expect(page).toHaveURL('/candidates?decision=uncertain&from=all');
    await expect(page.getByText('Carmageddon, box only, no disc')).toBeVisible();
  });

  await test.step('the item page counts link straight into the filtered view', async () => {
    await nav.click();
    await page.getByRole('link', { name: 'Carmageddon big box' }).click();
    // The total has no "everything" view to open, so it is a figure rather than a link.
    await expect(page.getByRole('link', { name: /^Total\s*\d/ })).toHaveCount(0);
    await expect(page.getByText('Total', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: /Matched/ }).click();

    // The item's counts are for all time, so they open the all-time list rather than today's.
    await expect(page).toHaveURL(/\/candidates\?item=[0-9a-f-]+&decision=match&from=all$/);
    // "page" when the chip's link is this very URL, which the router marks itself.
    await expect(fromFilter.getByRole('link', { name: 'All' })).toHaveAttribute(
      'aria-current',
      /^(true|page)$/,
    );
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

  await test.step('the dashboard fills in, and a failing source is on it rather than in a log', async () => {
    await seedPlanFailure(databaseUrl, carmageddonId, 'eBay said 503 Service Unavailable');
    await seedHeartbeats(databaseUrl);

    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page).toHaveURL('/');

    // The zone an earlier step saved in Settings, which is what "today" is read in (§14).
    const today = section('Today');
    await expect(today).toContainText('Asia/Tokyo');
    await expect(today.getByRole('link', { name: /Matched/ })).toContainText('1');
    await expect(today.getByRole('link', { name: /Uncertain/ })).toContainText('1');
    await expect(today.getByRole('link', { name: /Rejected/ })).toContainText('1');

    await expect(section('Wanted items').getByRole('link', { name: /Active/ })).toContainText('1');

    // The acceptance line: the adapter's own words, with the item it belongs to, on the page.
    const sources = section('Sources');
    await expect(sources).toContainText('ebay');
    await expect(sources).toContainText('eBay said 503 Service Unavailable');
    await expect(sources.getByRole('link', { name: 'Carmageddon big box' })).toBeVisible();

    await expect(section('API Spend')).toContainText('no cap set');
    // A process that has stopped answering says so, in the words §6 asks for.
    const processes = section('Processes');
    await expect(processes).toContainText('api last seen');
    await expect(processes).toContainText('worker not responding since');
  });

  await test.step('every figure links to the page that explains it', async () => {
    await section('Today')
      .getByRole('link', { name: /Uncertain/ })
      .click();

    await expect(page).toHaveURL('/candidates?decision=uncertain');
    await expect(page.getByText('Carmageddon, box only, no disc')).toBeVisible();

    await page.getByRole('link', { name: 'Dashboard' }).click();
    await section('Sources').getByRole('link', { name: 'Carmageddon big box' }).click();
    await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);

    await page.getByRole('link', { name: 'Dashboard' }).click();
    await section('API Spend').getByRole('link').click();
    await expect(page).toHaveURL('/settings/models');
    await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  });

  const wishes = page.getByRole('list', { name: 'Wishes' });
  const wish = (label: string) => wishes.getByRole('listitem').filter({ hasText: label });
  const JURASSIC_SEARCH = 'https://www.ebay.co.uk/sch/i.html?_nkw=jurassic+park+vhs';

  await test.step('a wish is added with a category and a search link, and a bad link is refused', async () => {
    await page.getByRole('link', { name: 'Wish list' }).click();
    await expect(page).toHaveURL('/wishes');
    await expect(page.getByText('Nothing on the wish list yet.')).toBeVisible();

    const dialog = page.getByRole('dialog', { name: 'Add a wish' });
    const open = page.getByRole('button', { name: 'Create a wish' });

    // Cancel closes it with nothing added.
    await open.click();
    await dialog.getByLabel('Label').fill('Never mind');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Nothing on the wish list yet.')).toBeVisible();

    await open.click();
    await expect(dialog.getByLabel('Label')).toHaveValue('');
    await dialog.getByLabel('Label').fill('Jurasic Park');
    await dialog.getByLabel('Category').selectOption({ label: 'VHS' });
    // Rendered as an href the owner clicks, so a script URL must never get that far.
    await dialog.getByLabel('Search link').fill('javascript:alert(1)');
    await dialog.getByRole('button', { name: 'Add to wish list' }).click();
    await expect(dialog.getByText('must be an http or https link')).toBeVisible();

    await dialog.getByLabel('Search link').fill(JURASSIC_SEARCH);
    await dialog.getByLabel('Tags').fill('big box, Spielberg, Big Box');
    await dialog.getByRole('button', { name: 'Add to wish list' }).click();
    await expect(dialog).toBeHidden();
    // Pills beside the label, in the order typed, the repeat dropped.
    await expect(
      wish('Jurasic Park').getByRole('button', { name: /^big box$|^Spielberg$/ }),
    ).toHaveText(['big box', 'Spielberg']);

    const search = wish('Jurasic Park').getByRole('link', { name: /^Search/ });
    await expect(search).toHaveAttribute('href', JURASSIC_SEARCH);
    await expect(search).toHaveAttribute('target', '_blank');

    await open.click();
    await dialog.getByLabel('Label').fill('Tamagotchi');
    await dialog.getByLabel('Category').selectOption({ label: 'Toy' });
    await dialog.getByLabel('Tags').fill('90s');
    await dialog.getByRole('button', { name: 'Add to wish list' }).click();
    await expect(dialog).toBeHidden();
    await expect(wish('Tamagotchi')).toBeVisible();
    // No link, so Search is there but disabled rather than missing.
    await expect(wish('Tamagotchi').getByRole('link', { name: /^Search/ })).toHaveCount(0);
    await expect(wish('Tamagotchi').getByRole('button', { name: /^Search for/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  await test.step('the list filters by category, and the filter survives a reload', async () => {
    await page
      .getByRole('navigation', { name: 'Category' })
      .getByRole('link', { name: /^VHS/ })
      .click();
    await expect(page).toHaveURL(/\/wishes\?category=[0-9a-f-]+$/);
    await expect(wishes.getByRole('listitem')).toHaveCount(1);
    await expect(wish('Jurasic Park')).toBeVisible();

    await page.reload();
    await expect(wishes.getByRole('listitem')).toHaveCount(1);

    await page
      .getByRole('navigation', { name: 'Category' })
      .getByRole('link', { name: /^All/ })
      .click();
    await expect(wishes.getByRole('listitem')).toHaveCount(2);
  });

  await test.step('the list filters by tag, and the filter survives a reload', async () => {
    const filter = page.getByRole('searchbox', { name: 'Filter by tag' });

    // One key at a time, since every keystroke also rewrites the URL.
    await filter.pressSequentially('SPIEL');
    await expect(page).toHaveURL('/wishes?tag=SPIEL');
    await expect(wishes.getByRole('listitem')).toHaveCount(1);
    await expect(wish('Jurasic Park')).toBeVisible();

    await page.reload();
    await expect(filter).toHaveValue('SPIEL');
    await expect(wishes.getByRole('listitem')).toHaveCount(1);

    await filter.fill('vinyl');
    await expect(page.getByText('No wishes tagged “vinyl”.')).toBeVisible();

    await filter.fill('');
    await expect(page).toHaveURL('/wishes');
    await expect(wishes.getByRole('listitem')).toHaveCount(2);

    // A pill is a shortcut to filtering by its tag.
    await wish('Tamagotchi').getByRole('button', { name: '90s' }).click();
    await expect(filter).toHaveValue('90s');
    await expect(wishes.getByRole('listitem')).toHaveCount(1);
    await expect(wish('Tamagotchi')).toBeVisible();

    await filter.fill('');
    await expect(wishes.getByRole('listitem')).toHaveCount(2);
  });

  await test.step('a wish is edited where it is listed', async () => {
    const openEdit = page.getByRole('button', { name: 'Edit Jurasic Park' });
    const edit = page.getByRole('dialog', { name: 'Edit Jurasic Park' });

    // The same modal as adding, filled in; Cancel leaves the wish as it was.
    await openEdit.click();
    await expect(edit.getByLabel('Tags')).toHaveValue('big box, Spielberg');
    await edit.getByLabel('Label').fill('Never mind');
    await edit.getByRole('button', { name: 'Cancel' }).click();
    await expect(edit).toBeHidden();
    await expect(wish('Jurasic Park')).toBeVisible();

    await openEdit.click();
    await expect(edit.getByLabel('Label')).toHaveValue('Jurasic Park');
    await edit.getByLabel('Label').fill('Jurassic Park');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await expect(wish('Jurassic Park')).toBeVisible();
    await expect(wish('Jurassic Park').getByRole('link', { name: /^Search/ })).toHaveAttribute(
      'href',
      JURASSIC_SEARCH,
    );
  });

  await test.step('the list is A–Z by default, newest first on request, and keeps the filter', async () => {
    const rows = wishes.getByRole('listitem');
    const sort = page.getByRole('navigation', { name: 'Sort' });

    await expect(rows.nth(0)).toContainText('Jurassic Park');
    await expect(rows.nth(1)).toContainText('Tamagotchi');

    await sort.getByRole('link', { name: 'Newest' }).click();
    await expect(page).toHaveURL('/wishes?sort=newest');
    await expect(rows.nth(0)).toContainText('Tamagotchi');
    await expect(rows.nth(1)).toContainText('Jurassic Park');

    // Choosing a category keeps the sort, and choosing a sort keeps the category.
    const category = page.getByRole('navigation', { name: 'Category' });
    await category.getByRole('link', { name: /^VHS/ }).click();
    await expect(page).toHaveURL(/category=[0-9a-f-]+/);
    await expect(page).toHaveURL(/sort=newest/);
    await sort.getByRole('link', { name: 'A–Z' }).click();
    await expect(page).toHaveURL(/\/wishes\?category=[0-9a-f-]+$/);

    await category.getByRole('link', { name: /^All/ }).click();
    await expect(rows.nth(0)).toContainText('Jurassic Park');
  });

  await test.step('promoting a wish makes it a draft wanted item and takes it off the list', async () => {
    await page.getByRole('button', { name: 'Promote Tamagotchi' }).click();
    await page
      .getByRole('alertdialog', { name: 'Promote to a wanted item' })
      .getByRole('button', { name: 'Promote' })
      .click();

    // It opens on the new item's own page, a draft, to be filled in there (P1-26).
    await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: 'Tamagotchi', level: 1 })).toBeVisible();
    await expect(page.getByText('draft', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start polling' })).toBeDisabled();
    // The wish's category comes with it.
    await page.getByRole('button', { name: 'Edit details' }).click();
    const details = page.getByRole('dialog', { name: 'Edit Details' });
    await expect(details.getByLabel('Category').locator('option:checked')).toHaveText('Toy');
    await details.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('link', { name: 'Wish list' }).click();
    await expect(wishes.getByRole('listitem')).toHaveCount(1);
    await expect(wish('Tamagotchi')).toHaveCount(0);
  });

  await test.step('deleting a category says what uses it, and leaves that uncategorised', async () => {
    await settingsLink('Categories').click();
    const categories = section('Categories');
    await categories.getByRole('button', { name: 'Delete VHS' }).click();
    const confirm = categories.getByRole('alertdialog', { name: 'Delete VHS' });
    await expect(confirm).toContainText('1 wish will be left without a category.');
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(categories.getByRole('listitem')).toHaveText([/^Game/, /^Toy/]);

    await page.getByRole('link', { name: 'Wish list' }).click();
    await expect(wish('Jurassic Park')).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Category' })
        .getByRole('link', { name: /^Uncategorised · 1/ }),
    ).toBeVisible();
  });

  await test.step('the password can be changed, and the new one is what signs you in', async () => {
    await page.goto('/settings/account');

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
