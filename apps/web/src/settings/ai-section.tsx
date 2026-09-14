import {
  AI_PROVIDERS,
  type AiProvider,
  type PublicSettings,
  type SettingsPatch,
} from '@goodies-beacon/core/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useId, useState } from 'react';
import {
  type AiTestResponse,
  saveSettings,
  settingsQuery,
  testAiProvider,
} from '../api/settings.js';
import { Alert, Button, CONTROL, Field, Section } from '../components/form.js';

type Ai = PublicSettings['ai'];

/** Stands in for a stored secret, which the server never sends back. */
const MASK = '••••••••';

const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  google: 'Google (Gemini)',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
};

const ROLE_HINTS = {
  interviewer: 'Builds and amends specs in chat. Worth a strong model.',
  prefilter: 'Reads every new listing. Should be the cheapest model that can read.',
  reviewer: 'Looks at the photos and judges. Needs vision.',
} as const;

type RoleName = keyof typeof ROLE_HINTS;
const ROLES: RoleName[] = ['interviewer', 'prefilter', 'reviewer'];

export function AiSection({ ai }: { ai: Ai }) {
  const queryClient = useQueryClient();
  const budgetId = useId();
  const roleIds: Record<RoleName, string> = {
    interviewer: useId(),
    prefilter: useId(),
    reviewer: useId(),
  };
  const keyIds: Record<AiProvider, string> = {
    anthropic: useId(),
    openai: useId(),
    google: useId(),
    openrouter: useId(),
    ollama: useId(),
  };

  const [roles, setRoles] = useState(ai.roles);
  // Empty means "leave the stored secret alone"; anything typed replaces it.
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [budget, setBudget] = useState(ai.monthlyBudget ? String(ai.monthlyBudget.amount) : '');

  useEffect(() => {
    setRoles(ai.roles);
    setKeys({});
    setOllamaUrl('');
    setBudget(ai.monthlyBudget ? String(ai.monthlyBudget.amount) : '');
  }, [ai]);

  const save = useMutation({
    mutationFn: (patch: SettingsPatch) => saveSettings(patch),
    onSuccess: (data) => queryClient.setQueryData(settingsQuery.queryKey, data),
  });

  const test = useMutation<AiTestResponse, Error, AiProvider>({
    mutationFn: (provider) => testAiProvider(provider),
  });
  const [tested, setTested] = useState<AiProvider | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    test.reset();
    setTested(null);

    const trimmed = budget.trim();
    save.mutate({
      ai: {
        roles,
        // Absent rather than empty, so an untouched field keeps what is stored.
        ...(keys.anthropic ? { anthropic: { apiKey: keys.anthropic } } : {}),
        ...(keys.openai ? { openai: { apiKey: keys.openai } } : {}),
        ...(keys.google ? { google: { apiKey: keys.google } } : {}),
        ...(keys.openrouter ? { openrouter: { apiKey: keys.openrouter } } : {}),
        ...(ollamaUrl ? { ollama: { baseUrl: ollamaUrl } } : {}),
        // An empty box means no cap, which is different from a cap of zero.
        monthlyBudget: trimmed === '' ? null : { amount: Number(trimmed), currency: 'GBP' },
      },
    });
  };

  return (
    <Section title="AI">
      <form onSubmit={onSubmit}>
        <p className="mt-2 text-sm text-ink-dim dark:text-ink-dim-dark">
          Each role is <code>provider:model</code>, so changing which model judges your listings is
          a setting rather than a deploy. A key entered here is stored encrypted and never sent back
          to the browser; one set in <code>.env</code> is used when this is empty.
        </p>

        <div className="mt-6 grid gap-5">
          {ROLES.map((role) => (
            <Field key={role} id={roleIds[role]} label={roleLabel(role)} hint={ROLE_HINTS[role]}>
              <input
                id={roleIds[role]}
                className={CONTROL}
                value={roles[role]}
                onChange={(event) => setRoles({ ...roles, [role]: event.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          ))}
        </div>

        <h3 className="mt-8 text-sm font-medium">Provider keys</h3>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {AI_PROVIDERS.map((provider: AiProvider) => {
            const configured = ai.providers[provider].configured;
            const isOllama = provider === 'ollama';

            return (
              <Field
                key={provider}
                id={keyIds[provider]}
                label={PROVIDER_LABELS[provider]}
                hint={
                  isOllama
                    ? 'Base URL of a local Ollama server.'
                    : configured
                      ? 'Stored. Type to replace it.'
                      : 'Not set.'
                }
              >
                <input
                  id={keyIds[provider]}
                  className={CONTROL}
                  type={isOllama ? 'text' : 'password'}
                  value={isOllama ? ollamaUrl : (keys[provider] ?? '')}
                  placeholder={isOllama ? 'http://localhost:11434' : configured ? MASK : 'sk-…'}
                  onChange={(event) =>
                    isOllama
                      ? setOllamaUrl(event.target.value)
                      : setKeys({ ...keys, [provider]: event.target.value })
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="mt-2 text-xs underline underline-offset-2 disabled:no-underline disabled:opacity-50"
                  disabled={!configured || test.isPending}
                  onClick={() => {
                    setTested(provider);
                    test.mutate(provider);
                  }}
                >
                  {test.isPending && tested === provider ? 'Testing…' : 'Test'}
                </button>
              </Field>
            );
          })}
        </div>

        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          <Field
            id={budgetId}
            label="Monthly budget (£)"
            hint="Reviews pause when the month's spend reaches it. Empty means no cap."
          >
            <input
              id={budgetId}
              className={CONTROL}
              type="number"
              min="0"
              step="0.01"
              value={budget}
              placeholder="No cap"
              onChange={(event) => setBudget(event.target.value)}
            />
          </Field>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          {save.isSuccess && !save.isPending ? (
            <span className="text-sm text-ink-dim dark:text-ink-dim-dark">Saved.</span>
          ) : null}
        </div>

        {save.error ? (
          <div className="mt-4">
            <Alert tone="error">{save.error.message}</Alert>
          </div>
        ) : null}

        {test.data && tested ? (
          <div className="mt-4">
            {/* The provider's own words, as the SMTP error is shown verbatim: "model not found"
                and "insufficient quota" need different fixes. */}
            <Alert tone={test.data.health.status === 'ok' ? 'ok' : 'error'}>
              {PROVIDER_LABELS[tested]}: {test.data.health.message}
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

function roleLabel(role: RoleName): string {
  return role === 'prefilter' ? 'Pre-filter' : `${role[0]?.toUpperCase() ?? ''}${role.slice(1)}`;
}
