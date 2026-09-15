import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateRequirementForm } from '../../app/(app)/requirements/new/CreateRequirementForm';
import { expectNoViolations, renderApp } from '../a11y';
// vitest aliases `next/navigation` to this module, so the component's `useRouter().push` lands in `__nav.pushed`.
import { __nav } from '../mocks/next-navigation';
import { OTHER_PROJECT, PROJECT, detailDraft, me } from '../fixtures/requirements';

const fetchMock = vi.fn();
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : null };
};
const saffron = (c: Element) => c.querySelectorAll('.cd-saffron').length;

const field = {
  project: () => screen.getByRole('combobox', { name: /Project/ }) as HTMLSelectElement,
  title: () => screen.getByRole('textbox', { name: /Title/ }) as HTMLInputElement,
  objective: () =>
    screen.getByRole('textbox', { name: /Business objective/ }) as HTMLTextAreaElement,
  criteria: () =>
    screen.getByRole('textbox', { name: /Acceptance criteria/ }) as HTMLTextAreaElement,
};
const errorOf = (el: HTMLElement) => {
  expect(el).toHaveAttribute('aria-invalid', 'true');
  const ids = (el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
  const alerts = ids.map((id) => document.getElementById(id)).filter((n) => n?.role === 'alert');
  expect(alerts.length).toBeGreaterThan(0);
  return alerts.map((n) => n!.textContent).join(' ');
};

const VALID_OBJECTIVE =
  'Merchants need partial refunds so support can stop issuing manual credits.';

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(field.title(), 'Partial refunds');
  await user.type(field.objective(), VALID_OBJECTIVE);
}

beforeEach(() => {
  fetchMock.mockReset();
  __nav.pushed.length = 0;
  document.cookie = 'cdevi_project=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('Create requirement form (specs/001 US4 scenario 1, ui-requirements.md §4/§5.3)', () => {
  it('FR-007 renders the labelled form: Project Select (me.projects only, cookie default), Title Input maxLength 200, objective TextArea rows 6, criteria TextArea rows 4, one saffron submit and a ghost Cancel link', async () => {
    document.cookie = `cdevi_project=${OTHER_PROJECT.key}; path=/`;
    const { container } = renderApp(<CreateRequirementForm me={me('engineer')} />);
    const form = screen.getByRole('form');
    expect(form).toHaveAttribute('aria-labelledby');
    expect(form.closest('.cd-card')).not.toBeNull();

    const project = field.project();
    expect(project).toHaveAttribute('id', 'req-project');
    expect(project).toBeRequired();
    const options = within(project)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual([PROJECT.name, OTHER_PROJECT.name]);
    expect(project.value).toBe(OTHER_PROJECT.id);

    const title = field.title();
    expect(title).toHaveAttribute('id', 'req-title');
    expect(title).toHaveAttribute('maxlength', '200');
    expect(title).toBeRequired();
    expect(screen.getByText('3–200 characters')).toBeInTheDocument();

    const objective = field.objective();
    expect(objective).toHaveAttribute('id', 'req-objective');
    expect(objective).toHaveAttribute('rows', '6');
    expect(objective).toBeRequired();
    expect(screen.getByText('10–4 000 characters')).toBeInTheDocument();

    const criteria = field.criteria();
    expect(criteria).toHaveAttribute('id', 'req-criteria');
    expect(criteria).toHaveAttribute('rows', '4');
    expect(criteria).not.toBeRequired();
    expect(screen.getByText('One per line, up to 20')).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'Create requirement' });
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit).toHaveClass('cd-saffron');
    expect(saffron(container)).toBe(1);
    const cancel = screen.getByRole('link', { name: 'Cancel' });
    expect(cancel).toHaveAttribute('href', '/requirements');
    expect(cancel).toHaveClass('cd-ghost');
    await expectNoViolations(container);
  });

  it('FR-007 defaults to the first project when the cookie is missing or unknown', () => {
    document.cookie = 'cdevi_project=nope; path=/';
    renderApp(<CreateRequirementForm me={me('engineer')} />);
    expect(field.project().value).toBe(PROJECT.id);
  });

  it('FR-007 submitting an empty form shows the R45 messages, focuses the first invalid field, sends nothing and keeps submit enabled', async () => {
    const user = userEvent.setup();
    const { container } = renderApp(<CreateRequirementForm me={me('engineer')} />);
    await user.click(screen.getByRole('button', { name: 'Create requirement' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorOf(field.title())).toBe('Enter a title (3–200 characters)');
    expect(errorOf(field.objective())).toBe(
      'Describe the business objective (10–4 000 characters)',
    );
    expect(field.title()).toHaveFocus();
    expect(field.criteria()).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('button', { name: 'Create requirement' })).toBeEnabled();
    await expectNoViolations(container);

    // after the first submit, blur re-validates
    await user.type(field.title(), 'Partial refunds');
    await user.tab();
    expect(field.title()).not.toHaveAttribute('aria-invalid');
    expect(errorOf(field.objective())).toBe(
      'Describe the business objective (10–4 000 characters)',
    );
  });

  it('FR-007 "Choose a project" when no project is selectable', async () => {
    const user = userEvent.setup();
    const m = me('engineer');
    renderApp(<CreateRequirementForm me={{ ...m, projects: [] }} />);
    await user.type(field.title(), 'Partial refunds');
    await user.type(field.objective(), VALID_OBJECTIVE);
    await user.click(screen.getByRole('button', { name: 'Create requirement' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorOf(field.project())).toBe('Choose a project');
    expect(field.project()).toHaveFocus();
  });

  it('FR-007 acceptance criteria are split on newlines, trimmed and empty lines dropped; each 1–1 000 chars; at most 20', async () => {
    const user = userEvent.setup();
    const created = detailDraft();
    fetchMock.mockResolvedValue(jsonResponse(created, 201));
    renderApp(<CreateRequirementForm me={me('engineer')} />);
    await fillValid(user);

    await user.type(field.criteria(), `${'x'.repeat(1001)}`);
    await user.click(screen.getByRole('button', { name: 'Create requirement' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorOf(field.criteria())).toBe('Each acceptance criterion must be 1–1 000 characters');
    expect(field.criteria()).toHaveFocus();

    await user.clear(field.criteria());
    await user.click(field.criteria());
    await user.paste(Array.from({ length: 21 }, (_, i) => `criterion ${i + 1}`).join('\n'));
    await user.click(screen.getByRole('button', { name: 'Create requirement' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorOf(field.criteria())).toBe('At most 20 acceptance criteria');

    await user.clear(field.criteria());
    await user.click(field.criteria());
    await user.paste(
      '  Refund up to the captured amount \n\n\nRefund creates a ledger entry\n   \n',
    );
    await user.click(screen.getByRole('button', { name: 'Create requirement' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastCall().body.acceptanceCriteria).toEqual([
      'Refund up to the captured amount',
      'Refund creates a ledger entry',
    ]);
  });

  it('SC-008 a valid submit POSTs CreateRequirementRequest to /api/requirements, is busy while in flight and pushes the new detail href on 201', async () => {
    const user = userEvent.setup();
    const created = detailDraft();
    let resolve: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    );
    const { container } = renderApp(<CreateRequirementForm me={me('engineer')} />);
    await user.selectOptions(field.project(), PROJECT.id);
    await user.type(field.title(), '  Partial refunds  ');
    await user.type(field.objective(), VALID_OBJECTIVE);
    await user.click(screen.getByRole('button', { name: 'Create requirement' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastCall().url).toBe('/api/requirements');
    expect(lastCall().method).toBe('POST');
    expect(lastCall().body).toEqual({
      projectId: PROJECT.id,
      title: 'Partial refunds',
      businessObjective: VALID_OBJECTIVE,
      acceptanceCriteria: [],
    });
    const submit = screen.getByRole('button', { name: 'Create requirement' });
    expect(submit).toHaveAttribute('aria-busy', 'true');
    expect(submit).toBeDisabled();
    expect(field.title()).toHaveAttribute('readonly');
    expect(field.objective()).toHaveAttribute('readonly');
    expect(field.criteria()).toHaveAttribute('readonly');
    await expectNoViolations(container);

    resolve(jsonResponse(created, 201));
    await waitFor(() => expect(__nav.pushed).toEqual([created.requirement.href]));
  });

  it('FR-007 API 400 errors[] map onto the fields by pointer and focus the first one', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          type: 'urn:cdevi:problem:validation',
          title: 'Validation failed',
          status: 400,
          errors: [
            { path: 'businessObjective', message: 'Objective too vague' },
            { path: 'acceptanceCriteria.0', message: 'Criterion 1 is empty' },
          ],
        },
        400,
      ),
    );
    renderApp(<CreateRequirementForm me={me('engineer')} />);
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create requirement' }));
    await waitFor(() => expect(errorOf(field.objective())).toBe('Objective too vague'));
    expect(errorOf(field.criteria())).toBe('Criterion 1 is empty');
    expect(field.objective()).toHaveFocus();
    expect(screen.queryByRole('alert', { name: /couldn't be created/ })).toBeNull();
    expect(__nav.pushed).toEqual([]);
  });

  it('FR-007 a 5xx renders the error Notice with the Problem title, focuses it and preserves the values', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ type: 'about:blank', title: 'Database unavailable', status: 503 }, 503),
    );
    const { container } = renderApp(<CreateRequirementForm me={me('engineer')} />);
    await fillValid(user);
    await user.click(screen.getByRole('button', { name: 'Create requirement' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveClass('cd-notice', 'cd-error');
    expect(alert).toHaveTextContent("The requirement couldn't be created.");
    expect(alert).toHaveTextContent('Database unavailable');
    expect(alert).toHaveFocus();
    expect(field.title().value).toBe('Partial refunds');
    expect(field.objective().value).toBe(VALID_OBJECTIVE);
    expect(screen.getByRole('button', { name: 'Create requirement' })).toBeEnabled();
    expect(__nav.pushed).toEqual([]);
    await expectNoViolations(container);
  });

  it('FR-032 a viewer sees the info Notice and no form, no saffron', async () => {
    const { container } = renderApp(<CreateRequirementForm me={me('viewer')} />);
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your role (viewer) cannot create requirements',
    );
    expect(saffron(container)).toBe(0);
    await expectNoViolations(container);
  });
});
