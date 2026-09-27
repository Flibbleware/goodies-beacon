import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { seedCandidates, seedHeartbeats, seedPlanFailure, seedPlanStats } from './seed.js';

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
  searchPlans: Record<string, unknown>[];
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
  /** What a save says when it lands or fails (P1-32), above any open dialog. */
  const toasts = page.getByRole('region', { name: 'Notifications' });
  /** The item page's sections are tabs (P1-28), each showing its panel alone. */
  const tab = (name: string) => page.getByRole('tab', { name, exact: true });
  const openTab = async (name: string) => {
    await tab(name).click();
    await expect(tab(name)).toHaveAttribute('aria-selected', 'true');
    return page.getByRole('tabpanel', { name, exact: true });
  };
  /** The item page's status, chosen from its header and saved as it changes (P1-28). */
  const itemStatus = page.getByLabel('Status', { exact: true });
  const activeOption = itemStatus.locator('option[value="active"]');
  const markedTabs = page.getByRole('tablist', { name: 'Sections' }).locator('[aria-describedby]');
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
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
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

    await page.getByRole('link', { name: 'Wish List' }).click();
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
    await expect(toasts.getByText('Saved the instance settings.')).toBeVisible();

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
    await page.getByLabel('Password', { exact: true }).fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toHaveText('That password is not correct.');
    await expect(page).toHaveURL('/login');
  });

  await test.step('the right password signs you back in', async () => {
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
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
    await expect(toasts.getByText('Saved the email settings.')).toBeVisible();

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
    await expect(toasts.getByText('Saved the email settings.')).toBeVisible();
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
    // The dialog holds its toasts while it is open (P1-32), so its own error is found by its words.
    await expect(
      dialog.getByRole('alert').filter({ hasText: 'There is already a category called vhs.' }),
    ).toBeVisible();
    await expect(toasts.getByRole('alert')).toHaveText('Could not add the category.');
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

    // A new item is a draft, so there is no status to choose: it starts polling from its own page
    // once it can (P1-26, P1-28).
    await expect(dialog.getByLabel('Status')).toHaveCount(0);
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
    // Raised by the dialog, and still showing on the page it led to.
    await expect(toasts.getByText('Created Carmageddon big box.')).toBeVisible();
    const versions = await itemHistory();
    await expect(versions.getByRole('listitem')).toHaveCount(1);
    await expect(versions.getByRole('listitem').first()).toContainText('Created.');
    await closeHistory();
  });

  await test.step('a new draft says what it needs before it can poll', async () => {
    // The mark is on the tab, so it shows whichever section is open.
    await expect(markedTabs).toHaveCount(2);
    await expect(tab('Criteria')).toHaveAccessibleDescription(
      /^Needed before polling\..*criterion/,
    );
    await expect(tab('Search Plans')).toHaveAccessibleDescription(
      /^Needed before polling\..*search plan/,
    );
    // And again at the top of the section, where it is put right.
    const criteria = await openTab('Criteria');
    await expect(criteria.getByText(/^Add a criterion\. A listing is only/)).toBeVisible();
    await openTab('Details');

    await expect(itemStatus).toHaveValue('draft');
    await expect(activeOption).toBeDisabled();
    await expect(page.getByText('Before it can start polling:')).toBeVisible();
    await expect(itemStatus).toHaveAccessibleDescription(/^Before it can start polling:/);
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

    // Two eBay sites in one plan's region is refused before it is saved, not when it polls (P1-29).
    const listed = {
      ...carmageddon,
      searchPlans: [{ ...carmageddon.searchPlans[0], region: 'EBAY_GB, EBAY_US' }],
    };
    await spec.fill(JSON.stringify(listed, null, 2));
    await expect(dialog).toContainText('searchPlans.0.region');
    await expect(dialog).toContainText('add a plan for each');
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

    await expect(markedTabs).toHaveCount(0);
    await expect(page.getByText('Before it can start polling:')).toBeHidden();
    await expect(activeOption).toBeEnabled();
    await itemStatus.selectOption('active');
    await expect(itemStatus).toBeEnabled();
    await page.reload();
    await expect(itemStatus).toHaveValue('active');
  });

  await test.step('the settings editor holds what is typed into it, and Discard writes nothing', async () => {
    // Two groups, each with its own editor holding only its own settings (P1-28).
    await openTab('Settings');
    await page.getByRole('button', { name: 'Edit general settings' }).click();
    const general = page.getByRole('dialog', { name: 'Edit General Settings' });
    await expect(general.getByLabel('Relists')).toHaveCount(0);
    await expect(general.getByRole('checkbox')).toHaveCount(0);

    await general.getByLabel('Price ceiling').fill('95');

    // Hours, not ISO 8601, and the hint says what a schedule can actually run (P1-26).
    await general.getByLabel('Poll every').pressSequentially('5');
    await expect(general.getByLabel('Poll every')).toHaveValue('5');
    await expect(general).toContainText('so this polls every 6 hours');

    // A price with pence must not trip the browser's own validation and block Save.
    await general.getByLabel('Price ceiling').fill('149.99');
    const valid = await general
      .getByLabel('Price ceiling')
      .evaluate((input) => (input as unknown as { checkValidity(): boolean }).checkValidity());
    expect(valid).toBe(true);
    await expect(general.getByRole('button', { name: 'Save as version 3' })).toBeEnabled();

    await general.getByRole('button', { name: 'Cancel' }).click();
    await general.getByRole('button', { name: 'Discard' }).click();
    await expect(general).toBeHidden();

    await page.getByRole('button', { name: 'Edit marketplace settings' }).click();
    const marketplace = page.getByRole('dialog', { name: 'Edit Marketplace Settings' });
    await expect(marketplace.getByLabel('Price ceiling')).toHaveCount(0);
    await expect(marketplace.getByLabel('Poll every')).toHaveCount(0);

    await marketplace.getByLabel('Relists').selectOption('suppress');

    // Only the marketplace there is an adapter for, grading not at all, and words not codes.
    await expect(marketplace.getByRole('checkbox', { name: 'eBay' })).toBeChecked();
    await expect(marketplace.getByRole('checkbox', { name: /vinted/i })).toHaveCount(0);
    await expect(marketplace.getByLabel('Grading scale')).toHaveCount(0);
    await expect(marketplace.getByLabel('Minimum grade')).toHaveCount(0);
    await expect(marketplace.getByLabel('How far back').locator('option')).toHaveText([
      'Newest 50',
      'Newest 200',
      'Last 30 days',
    ]);
    await expect(marketplace.getByRole('button', { name: 'Save as version 3' })).toBeEnabled();

    await marketplace.getByRole('button', { name: 'Cancel' }).click();
    await marketplace.getByRole('button', { name: 'Discard' }).click();
    await expect(marketplace).toBeHidden();

    await page.getByRole('button', { name: 'JSON', exact: true }).click();
    const json = page.getByRole('dialog', { name: 'Edit JSON' });
    await expect(json.getByLabel('Spec')).toHaveValue(/"amount": 120/);
    await expect(json.getByLabel('Spec')).toHaveValue(/"relists": "show"/);
    await json.getByRole('button', { name: 'Cancel' }).click();
    await expect(json).toBeHidden();
  });

  await test.step('a reference image is uploaded, labelled, and saved as a version', async () => {
    await openTab('Images');
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

    await expect(page.getByRole('tabpanel', { name: 'Images' })).toContainText('UK big box, front');
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
    // Its category's icon beside the title, named for a reader without the colour (P1-28).
    await expect(page.getByRole('img', { name: 'Category: Game' })).toBeVisible();

    // A tab for each section, in order, opening on Details with nothing in the URL.
    await expect(page.getByRole('tab')).toHaveText([
      'Details',
      'Search Plans',
      'Criteria',
      'Settings',
      'Images',
    ]);
    await expect(tab('Details')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toHaveCount(1);

    const details = page.getByRole('tabpanel', { name: 'Details' });
    await expect(details).toContainText('Carmageddon, the original 1997 big-box release');
    await expect(details).toContainText('How sellers list this');

    const spec = await openTab('Settings');
    // The settings, as the bounded values they are — not as criteria (§4's split).
    // In two groups: what the marketplaces are asked for, and the rest (P1-28).
    const marketplaceGroup = spec.getByRole('region', { name: 'Marketplace Settings' });
    const generalGroup = spec.getByRole('region', { name: 'General Settings' });
    await expect(generalGroup).toContainText('£120');
    await expect(generalGroup).toContainText('Real-time email');
    await expect(marketplaceGroup).toContainText('Auction and Fixed price');
    await expect(marketplaceGroup).not.toContainText('£120');
    await expect(spec).not.toContainText('Grading');
    await expect(spec).not.toContainText('Carmageddon, the original 1997 big-box release');
    await expect(spec).not.toContainText("Can't settle");
    // Every criterion in plain English with its flags, grouped by what failing it does (P1-30).
    const criteria = await openTab('Criteria');
    const hard = criteria.getByRole('region', { name: 'Hard' });
    const soft = criteria.getByRole('region', { name: 'Soft' });
    await expect(hard).toContainText('Big box release, not the jewel case or budget re-release');
    await expect(soft).toContainText('Box, manual and disc are all present');
    await expect(hard).not.toContainText('Box, manual and disc are all present');
    await expect(criteria).not.toContainText('Failure:');
    await expect(hard).toContainText('Unknown: Reject');
    await expect(criteria).toContainText("Photos: Can't settle");
    // The "?" explains the group on focus as well as on hover, and is described either way.
    const whatHardMeans = hard.getByRole('button', { name: 'What hard means' });
    await expect(whatHardMeans).toHaveAccessibleDescription(/fails any of these is rejected/);
    await expect(hard.getByRole('tooltip')).toBeHidden();
    await whatHardMeans.focus();
    await expect(hard.getByRole('tooltip')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(hard.getByRole('tooltip')).toBeHidden();
    // Only the open tab's panel is on the page.
    await expect(details).toHaveCount(0);
    // And the reference image uploaded earlier, under the label the reviewer is shown.
    const images = await openTab('Images');
    await expect(images).toContainText('UK big box, front');
    await expect(images).toContainText('1 image sent with every review of this item.');
  });

  await test.step('every search plan is listed with its stats, unrun ones included', async () => {
    const plans = await openTab('Search Plans');

    await expect(plans.getByRole('row')).toHaveCount(4);
    await expect(plans).toContainText('ebay · EBAY_GB');
    await expect(plans).toContainText('ebay · EBAY_US');
    await expect(plans).toContainText('carmageddon big box');
    await expect(plans.getByRole('row').nth(1)).toContainText('never');
  });

  await test.step('polling is paused and resumed without writing a spec version', async () => {
    await expect((await itemHistory()).getByRole('listitem')).toHaveCount(3);
    await closeHistory();

    await itemStatus.selectOption('paused');
    await expect(itemStatus).toBeEnabled();
    const paused = toasts.getByRole('status').filter({ hasText: 'Set the status to Paused.' });
    await expect(paused).toBeVisible();
    await paused.getByRole('button', { name: 'Dismiss' }).click();
    await expect(paused).toBeHidden();

    await page.reload();
    await expect(itemStatus).toHaveValue('paused');
    // Still three versions: pausing says nothing about what the item is looking for.
    await expect((await itemHistory()).getByRole('listitem')).toHaveCount(3);
    await closeHistory();

    await itemStatus.selectOption('active');
    await expect(itemStatus).toBeEnabled();
    await page.reload();
    await expect(itemStatus).toHaveValue('active');
  });

  await test.step('Scan current listings is present and disabled until Phase 5', async () => {
    await expect(page.getByRole('button', { name: 'Scan current listings' })).toBeDisabled();
  });

  await test.step('the open tab is in the URL, so a reload and Back keep their place', async () => {
    const plans = await openTab('Search Plans');
    await expect(page).toHaveURL(/\/items\/[0-9a-f-]+\?tab=search-plans$/);
    await page.reload();
    await expect(tab('Search Plans')).toHaveAttribute('aria-selected', 'true');
    await expect(plans.getByRole('table')).toBeVisible();

    await openTab('Criteria');
    await page.goBack();
    await expect(tab('Search Plans')).toHaveAttribute('aria-selected', 'true');

    // The arrow keys, Home and End move along the strip and open what they reach.
    await tab('Search Plans').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(tab('Details')).toBeFocused();
    await expect(tab('Details')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
    await page.keyboard.press('ArrowLeft');
    await expect(tab('Images')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tab('Details')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(page).toHaveURL(/\?tab=images$/);
    // One tab stop for the whole strip.
    await expect(page.getByRole('tab', { selected: false }).first()).toHaveAttribute(
      'tabindex',
      '-1',
    );
  });

  await test.step('Add a Criterion adds one criterion, as a new version', async () => {
    await openTab('Criteria');
    const add = page.getByRole('button', { name: 'Add a criterion' });
    await add.click();

    const dialog = page.getByRole('dialog', { name: 'Add a Criterion' });
    const save = dialog.getByRole('button', { name: 'Save as version 4' });
    // One criterion: the settings, search plans and the other criteria are not here.
    await expect(dialog.getByLabel('Price ceiling')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Add a search plan' })).toHaveCount(0);
    await expect(dialog.getByLabel('Criterion', { exact: true })).toHaveValue('');
    await expect(save).toBeDisabled();

    // A new criterion left blank is no change, so Esc closes without asking.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await add.click();
    await dialog.getByLabel('Criterion', { exact: true }).fill('The manual is the original print');
    await expect(save).toBeEnabled();

    // Esc with an edit in hand asks rather than throwing it away.
    await page.keyboard.press('Escape');
    const ask = dialog.getByRole('alertdialog', { name: 'Unsaved changes' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Keep editing' }).click();

    await save.click();
    await expect(dialog).toBeHidden();
    await expect(
      toasts.getByText(
        'Added the criterion “The manual is the original print”. Saved as version 4.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: 'Criteria' })).toContainText(
      'The manual is the original print',
    );
    const versions = await itemHistory();
    await expect(versions.getByRole('listitem')).toHaveCount(4);
    // Left empty, the note names the criterion added, by its text since its id is random.
    await expect(versions.getByRole('listitem').first()).toContainText(
      'Added the criterion “The manual is the original print”.',
    );
    await closeHistory();
  });

  await test.step('a save that fails keeps its dialog open, and says so there and in a toast', async () => {
    const itemUrl = `**/api/items/${carmageddonId}`;
    await page.route(itemUrl, (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({
            status: 500,
            json: { error: { code: 'internal', message: 'Something went wrong.' } },
          })
        : route.fallback(),
    );

    await page.getByRole('button', { name: 'Add a criterion' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a Criterion' });
    await dialog.getByLabel('Criterion', { exact: true }).fill('The discs are unscratched');
    await dialog.getByRole('button', { name: 'Save as version 5' }).click();

    const failure = toasts.getByRole('alert');
    await expect(failure).toHaveText('Could not save version 5.');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('alert').filter({ hasText: 'Something went wrong.' }),
    ).toBeVisible();
    await expect(dialog.getByLabel('Criterion', { exact: true })).toHaveValue(
      'The discs are unscratched',
    );
    // Drawn over the dialog, and inside it rather than inert behind it: the toast is what is hit
    // at its own centre.
    expect(
      await failure.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = element.ownerDocument.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        return hit !== null && element.contains(hit);
      }),
    ).toBe(true);
    await failure.getByRole('button', { name: 'Dismiss' }).click();
    await expect(failure).toBeHidden();
    await expect(dialog).toBeVisible();

    await page.unroute(itemUrl);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.getByRole('button', { name: 'Discard' }).click();
    await expect(dialog).toBeHidden();
    await expect((await itemHistory()).getByRole('listitem')).toHaveCount(4);
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
    await openTab('Details');
    await page.getByRole('button', { name: 'Edit details' }).click();

    const dialog = page.getByRole('dialog', { name: 'Edit Details' });
    // The status is chosen from the header, not here (P1-28).
    await expect(dialog.getByLabel('Status')).toHaveCount(0);
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
    const images = await openTab('Images');
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
    await expect(images).toContainText('1 image sent with every review of this item.');

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
    await page.getByRole('link', { name: 'Wish List' }).click();
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
    await expect(toasts.getByText('Promoted Tamagotchi to a wanted item.')).toBeVisible();
    await expect(itemStatus).toHaveValue('draft');
    await expect(activeOption).toBeDisabled();
    // The wish's category comes with it.
    await page.getByRole('button', { name: 'Edit details' }).click();
    const details = page.getByRole('dialog', { name: 'Edit Details' });
    await expect(details.getByLabel('Category').locator('option:checked')).toHaveText('Toy');
    await details.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('link', { name: 'Wish List' }).click();
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

    await page.getByRole('link', { name: 'Wish List' }).click();
    await expect(wish('Jurassic Park')).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Category' })
        .getByRole('link', { name: /^Uncategorised · 1/ }),
    ).toBeVisible();
  });

  await test.step('a shared criterion is written once, found by its tag, and kept in step on an item', async () => {
    const CLASSICS = 'original-release-not-classics';
    await sidebar.getByRole('link', { name: 'Criteria', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Shared Criteria', level: 1 })).toBeVisible();
    await expect(page.getByText('No shared criteria yet.')).toBeVisible();

    const create = async (key: string, text: string, tags: string) => {
      await page.getByRole('button', { name: 'Create a shared criterion' }).click();
      const dialog = page.getByRole('dialog', { name: 'Create a Shared Criterion' });
      await dialog.getByLabel('Identifier').fill(key);
      await dialog.getByLabel('Criterion', { exact: true }).fill(text);
      await dialog.getByLabel('Tags').fill(tags);
      return dialog;
    };

    // An identifier is checked before anything is sent.
    let dialog = await create('Not Classics', 'The original release', 'game boy');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog.getByText(/lowercase letters, digits and single hyphens/)).toBeVisible();
    await dialog.getByLabel('Identifier').fill(CLASSICS);
    await dialog.getByLabel('Failure action').selectOption('hard');
    await dialog.getByLabel('Photos can settle').selectOption('yes');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toBeHidden();

    dialog = await create('complete-in-box', 'Box, manual and cartridge all present', 'boxed');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toBeHidden();

    const list = page.getByRole('list', { name: 'Shared criteria' });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByRole('listitem').first()).toContainText('Failure: Item chooses');

    // A tag narrows the list, in the URL; a pill does the same.
    await page.getByLabel('Filter by identifier or tag').fill('game boy');
    await expect(page).toHaveURL(/q=game/);
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText(CLASSICS);
    await page.getByLabel('Filter by identifier or tag').fill('');
    await list.getByRole('button', { name: 'boxed' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText('complete-in-box');

    // Added to an item through the plus beside Criteria, found by the same tag.
    await page.goto(`/items/${carmageddonId}?tab=criteria`);
    const versions = await itemHistory();
    const before = await versions.getByRole('listitem').count();
    await closeHistory();
    const latestNote = async (count: number, note: string) => {
      const history = await itemHistory();
      await expect(history.getByRole('listitem')).toHaveCount(count);
      await expect(history.getByRole('listitem').first()).toContainText(note);
      await closeHistory();
    };

    await page.getByRole('button', { name: 'Add a criterion' }).click();
    const editor = page.getByRole('dialog', { name: 'Add a Criterion' });
    await editor.getByRole('button', { name: 'Use a Shared Criterion' }).click();
    const picker = editor.getByRole('region', { name: 'Add a shared criterion' });
    await picker.getByLabel('Find a shared criterion by identifier or tag').fill('game boy');
    await expect(picker.getByRole('listitem')).toHaveCount(1);
    await picker.getByRole('button', { name: `Add ${CLASSICS}` }).click();
    // What the shared criterion fixes cannot be changed here; what it leaves open can.
    await expect(editor.getByText(`Shared criterion ${CLASSICS}`)).toBeVisible();
    await expect(editor.getByLabel('Failure action')).toBeDisabled();
    await expect(editor.getByLabel('Failure action')).toHaveValue('hard');
    await expect(editor.getByLabel('When unknown')).toBeEnabled();
    await editor.getByLabel('When unknown').selectOption('reject');
    await editor.getByRole('button', { name: `Save as version ${before + 1}` }).click();
    await expect(editor).toBeHidden();
    await latestNote(before + 1, `Added the criterion ${CLASSICS}.`);

    // Once added, the picker says so rather than offering it twice.
    await page.getByRole('button', { name: 'Add a criterion' }).click();
    await editor.getByRole('button', { name: 'Use a Shared Criterion' }).click();
    await picker.getByLabel('Find a shared criterion by identifier or tag').fill(CLASSICS);
    await expect(picker.getByRole('button', { name: `${CLASSICS} is added` })).toBeDisabled();
    // Nothing was added, so Cancel closes without asking. (Esc would only clear the search box.)
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editor).toBeHidden();

    const criteria = page.getByRole('tabpanel', { name: 'Criteria' });
    await expect(criteria).toContainText('The original release');
    await expect(criteria.getByRole('link', { name: CLASSICS })).toBeVisible();
    // It leaves what an unknown does to the item, so it still has a pencil.
    const editClassics = page.getByRole('button', { name: `Edit the criterion ${CLASSICS}` });
    await expect(editClassics).toBeVisible();

    // Rewording it, and now fixing everything, writes a version on the item that uses it.
    await criteria.getByRole('link', { name: CLASSICS }).click();
    await expect(page).toHaveURL(new RegExp(`/criteria\\?q=${CLASSICS}`));
    await expect(list.getByRole('listitem')).toContainText('Used by 1 wanted item');
    await list.getByRole('button', { name: `Edit ${CLASSICS}` }).click();
    dialog = page.getByRole('dialog', { name: `Edit ${CLASSICS}` });
    await expect(dialog.getByLabel('Identifier')).toBeDisabled();
    await dialog
      .getByLabel('Criterion', { exact: true })
      .fill('The original release in the grey-banded box, not the red-bordered Classics one');
    await dialog.getByLabel('When unknown').selectOption('surface');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      toasts.getByText(`Saved ${CLASSICS}, and gave 1 wanted item a new version.`),
    ).toBeVisible();

    await page.goto(`/items/${carmageddonId}?tab=criteria`);
    await expect(criteria).toContainText('grey-banded box');
    await latestNote(before + 2, `Updated the shared criterion ${CLASSICS}.`);
    // Nothing about it is left for the item to choose, so there is nothing to edit here.
    await expect(editClassics).toHaveCount(0);

    // A criterion of the item's own is edited alone, from its own pencil.
    await page.getByRole('button', { name: 'Edit the criterion big-box' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit Criterion' });
    await expect(edit.getByLabel('Criterion', { exact: true })).toHaveValue(
      'Big box release, not the jewel case or budget re-release',
    );
    await expect(edit.getByRole('textbox')).toHaveCount(2);
    await edit.getByLabel('Failure action').selectOption('soft');
    await edit.getByRole('button', { name: `Save as version ${before + 3}` }).click();
    await expect(edit).toBeHidden();
    await latestNote(
      before + 3,
      'Edited the criterion “Big box release, not the jewel case or budget re-release”.',
    );
    // Soft now, so it has moved group, and its pencil still opens it rather than a neighbour.
    await expect(criteria.getByRole('region', { name: 'Soft' })).toContainText('Big box release');
    await expect(criteria.getByRole('region', { name: 'Hard' })).not.toContainText(
      'Big box release',
    );
    await page.getByRole('button', { name: 'Edit the criterion big-box' }).click();
    await expect(edit.getByLabel('Criterion', { exact: true })).toHaveValue(
      'Big box release, not the jewel case or budget re-release',
    );
    await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(edit).toBeHidden();

    // Deleting it says what uses it, and the item keeps its copy as its own.
    await page.goto('/criteria');
    await list.getByRole('button', { name: `Delete ${CLASSICS}` }).click();
    const confirm = list.getByRole('alertdialog', { name: `Delete ${CLASSICS}` });
    await expect(confirm).toContainText('Used by 1 wanted item; each keeps it');
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(1);

    await page.goto(`/items/${carmageddonId}?tab=criteria`);
    await expect(criteria).toContainText('grey-banded box');
    await expect(criteria.getByRole('link', { name: CLASSICS })).toHaveCount(0);
    await latestNote(before + 4, `The shared criterion ${CLASSICS} was deleted`);

    // The bin removes a criterion, after asking, as a version of its own.
    await page.getByRole('button', { name: `Remove the criterion ${CLASSICS}` }).click();
    const removal = page.getByRole('dialog', { name: 'Remove a Criterion' });
    await expect(removal).toContainText(`version ${before + 5}`);
    await removal.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(removal).toBeHidden();
    await expect(criteria).not.toContainText('grey-banded box');
    // The shared criterion is gone, so the copy is the item's own and is named by its text.
    await latestNote(before + 5, 'Removed the criterion “The original release in the grey-banded');
  });

  await test.step('each search plan is added, edited and removed on its own, as a version', async () => {
    await page.goto(`/items/${carmageddonId}?tab=search-plans`);
    const before = await (await itemHistory()).getByRole('listitem').count();
    await closeHistory();
    const latestNote = async (count: number, note: string) => {
      const history = await itemHistory();
      await expect(history.getByRole('listitem')).toHaveCount(count);
      await expect(history.getByRole('listitem').first()).toContainText(note);
      await closeHistory();
    };
    const table = page.getByRole('tabpanel', { name: 'Search Plans' }).getByRole('table');

    await page.getByRole('button', { name: 'Add a search plan' }).click();
    let dialog = page.getByRole('dialog', { name: 'Add a Search Plan' });
    // One plan, starting on the item's marketplace.
    await expect(dialog.getByLabel('Query')).toHaveValue('');
    await expect(dialog.getByLabel('Region')).toHaveValue('EBAY_GB');
    await dialog.getByLabel('Query').fill('carmageddon mac');
    await dialog.getByRole('button', { name: `Save as version ${before + 1}` }).click();
    await expect(dialog).toBeHidden();
    await expect(table).toContainText('carmageddon mac');
    await latestNote(before + 1, 'Added the search plan “carmageddon mac” on EBAY_GB.');

    await page
      .getByRole('button', { name: 'Edit the search plan carmageddon mac on EBAY_GB' })
      .click();
    dialog = page.getByRole('dialog', { name: 'Edit Search Plan' });
    await expect(dialog.getByLabel('Query')).toHaveValue('carmageddon mac');
    // A list of eBay's nine sites rather than free text, which accepted anything (P1-29).
    await expect(dialog.getByLabel('Region').getByRole('option')).toHaveCount(9);
    const planId = async () => {
      const res = await page.request.get(`/api/items/${carmageddonId}`);
      const { item } = (await res.json()) as {
        item: {
          current: { document: { searchPlans: { id: string; query: string }[] } };
        };
      };
      return item.current.document.searchPlans.find((plan) => plan.query === 'carmageddon mac')?.id;
    };
    const idOnGb = (await planId()) ?? '';
    expect(idOnGb).not.toBe('');
    // It has polled, so when the new site replaces it its row stays behind for its stats.
    await seedPlanStats(databaseUrl, carmageddonId, idOnGb);
    // Another site and back again is no change: the plan gets its own id back.
    await dialog.getByLabel('Region').selectOption('EBAY_DE');
    await dialog.getByLabel('Region').selectOption('EBAY_GB');
    await expect(
      dialog.getByRole('button', { name: `Save as version ${before + 2}` }),
    ).toBeDisabled();
    await dialog.getByLabel('Region').selectOption('EBAY_DE');
    await dialog.getByRole('button', { name: `Save as version ${before + 2}` }).click();
    await expect(dialog).toBeHidden();
    // A new site is a new plan, so no watermark or stats carry over from the old one.
    expect(await planId()).not.toBe(idOnGb);
    await expect(table.getByRole('row').filter({ hasText: 'carmageddon mac' })).toContainText(
      'EBAY_DE',
    );
    // The old plan is kept for its stats, but hidden until asked for.
    const showRemoved = page
      .getByRole('tabpanel', { name: 'Search Plans' })
      .getByLabel(/^Show removed plans \(\d+\)$/);
    await expect(table).not.toContainText(idOnGb);
    await showRemoved.check();
    await expect(table.getByRole('row').filter({ hasText: idOnGb })).toContainText(
      'removed from the spec',
    );
    await showRemoved.uncheck();
    await expect(table).not.toContainText(idOnGb);
    await latestNote(before + 2, 'Edited the search plan “carmageddon mac” on EBAY_DE.');

    await page
      .getByRole('button', { name: 'Remove the search plan carmageddon mac on EBAY_DE' })
      .click();
    dialog = page.getByRole('dialog', { name: 'Remove a Search Plan' });
    await expect(dialog).toContainText(`version ${before + 3}`);
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(dialog).toBeHidden();
    // It never ran, so there are no stats to keep and it leaves the table.
    await expect(table).not.toContainText('carmageddon mac');
    await latestNote(before + 3, 'Removed the search plan “carmageddon mac” on EBAY_DE.');
  });

  await test.step('the password can be changed, and the new one is what signs you in', async () => {
    await page.goto('/settings/account');

    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByLabel('New password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).click();

    await expect(toasts.getByText('Password changed.')).toBeVisible();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL('/login');

    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('That password is not correct.');

    await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');
  });
});
