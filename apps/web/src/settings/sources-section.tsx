import type { PublicSettings, SettingsPatch } from '@goodies-beacon/core/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { type EbayTestResponse, saveSettings, settingsQuery, testEbay } from '../api/settings.js';
import { Alert, Button, CONTROL, Field, Section } from '../components/form.js';

type Ebay = PublicSettings['sources']['ebay'];

/** Stands in for a stored secret, which the server never sends back. */
const MASK = '••••••••';

export function SourcesSection({ ebay }: { ebay: Ebay }) {
  const queryClient = useQueryClient();
  const ids = { clientId: useId(), clientSecret: useId(), proxy: useId() };

  const [clientId, setClientId] = useState(ebay.clientId);
  // Empty means "leave the stored secret alone"; anything typed replaces it.
  const [clientSecret, setClientSecret] = useState('');
  const [proxyUrl, setProxyUrl] = useState('');

  useEffect(() => {
    setClientId(ebay.clientId);
    setClientSecret('');
    setProxyUrl('');
  }, [ebay]);

  const save = useMutation({
    mutationFn: (patch: SettingsPatch) => saveSettings(patch),
    onSuccess: (data) => queryClient.setQueryData(settingsQuery.queryKey, data),
  });

  const test = useMutation<EbayTestResponse, Error>({ mutationFn: testEbay });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    test.reset();
    save.mutate({
      sources: {
        ebay: {
          clientId,
          // Absent rather than empty, so an untouched field keeps what is stored.
          ...(clientSecret === '' ? {} : { clientSecret }),
          ...(proxyUrl === '' ? {} : { proxyUrl }),
        },
      },
    });
  };

  const configured = ebay.clientId !== '' && ebay.clientSecretSet;

  return (
    <Section title="Sources">
      <form onSubmit={onSubmit}>
        <p className="mt-2 text-sm text-ink-dim dark:text-ink-dim-dark">
          A production keyset from developer.ebay.com. Browse allows 5,000 calls a day, far more
          than polling needs.
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field id={ids.clientId} label="eBay App ID (Client ID)">
            <input
              id={ids.clientId}
              className={CONTROL}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <Field
            id={ids.clientSecret}
            label="eBay Cert ID (Client Secret)"
            {...(ebay.clientSecretSet ? { hint: 'Stored. Type to replace it.' } : {})}
          >
            <input
              id={ids.clientSecret}
              className={CONTROL}
              type="password"
              value={clientSecret}
              placeholder={ebay.clientSecretSet ? MASK : ''}
              onChange={(event) => setClientSecret(event.target.value)}
              autoComplete="off"
            />
          </Field>

          <Field
            id={ids.proxy}
            label="Proxy URL"
            hint={
              ebay.proxySet
                ? 'Stored. Type to replace it.'
                : 'Optional. eBay needs none; a scraped source may.'
            }
          >
            <input
              id={ids.proxy}
              className={CONTROL}
              type="password"
              value={proxyUrl}
              placeholder={ebay.proxySet ? MASK : 'http://user:pass@host:port'}
              onChange={(event) => setProxyUrl(event.target.value)}
              autoComplete="off"
            />
          </Field>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={!configured || test.isPending}
            onClick={() => test.mutate()}
          >
            {test.isPending ? 'Testing…' : 'Test'}
          </Button>
          {save.isSuccess && !save.isPending ? (
            <span className="text-sm text-ink-dim dark:text-ink-dim-dark">Saved.</span>
          ) : null}
        </div>

        {!configured ? (
          <p className="mt-3 text-sm text-ink-dim dark:text-ink-dim-dark">
            Enter both halves of the keyset to enable the test.
          </p>
        ) : null}

        {save.error ? (
          <div className="mt-4">
            <Alert tone="error">{save.error.message}</Alert>
          </div>
        ) : null}

        {test.data ? (
          <div className="mt-4">
            {/* eBay's own words, exactly as the SMTP error is shown verbatim. */}
            <Alert tone={test.data.health.status === 'ok' ? 'ok' : 'error'}>
              {test.data.health.message}
              {test.data.exit
                ? ` Requests leave from ${test.data.exit.ip}${
                    test.data.exit.country ? ` (${test.data.exit.country})` : ''
                  }.`
                : ''}
            </Alert>
          </div>
        ) : null}

        {test.error ? (
          <div className="mt-4">
            <Alert tone="error">{test.error.message}</Alert>
          </div>
        ) : null}
      </form>
    </Section>
  );
}
