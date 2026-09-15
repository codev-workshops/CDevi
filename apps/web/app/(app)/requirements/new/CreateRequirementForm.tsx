'use client';

import type { CreateRequirementRequest, Me, RequirementDetail } from '@cdevi/contracts';
import { OBJECTIVE_MAX } from '@cdevi/contracts/requirement-rules';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '../../../../lib/api';
import {
  ActionBar,
  Button,
  Card,
  Field,
  Input,
  Notice,
  Select,
  TextArea,
} from '../../../../lib/ds';
import { PROJECT_COOKIE } from '../../../../lib/navigation';

export interface CreateRequirementFormProps {
  me: Me;
}

type FieldName = 'project' | 'title' | 'objective' | 'criteria';
type Errors = Partial<Record<FieldName, string>>;

const FIELD_ORDER: FieldName[] = ['project', 'title', 'objective', 'criteria'];
const TITLE_MIN = 3;
const TITLE_MAX = 200;
const OBJECTIVE_MIN = 10;
const CRITERION_MAX = 1000;
const CRITERIA_MAX = 20;

const MESSAGES = {
  project: 'Choose a project',
  title: `Enter a title (${TITLE_MIN}–${TITLE_MAX} characters)`,
  objective: `Describe the business objective (${OBJECTIVE_MIN}–4 000 characters)`,
  criterion: 'Each acceptance criterion must be 1–1 000 characters',
  criteria: `At most ${CRITERIA_MAX} acceptance criteria`,
} as const;

/** Acceptance criteria are entered one per line; blank lines are dropped (ui-requirements.md §4.2). */
export function splitCriteria(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function validate(values: {
  project: string;
  title: string;
  objective: string;
  criteria: string[];
}): Errors {
  const errors: Errors = {};
  if (!values.project) errors.project = MESSAGES.project;
  const title = values.title.trim();
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) errors.title = MESSAGES.title;
  const objective = values.objective.trim();
  if (objective.length < OBJECTIVE_MIN || objective.length > OBJECTIVE_MAX)
    errors.objective = MESSAGES.objective;
  if (values.criteria.length > CRITERIA_MAX) errors.criteria = MESSAGES.criteria;
  else if (values.criteria.some((c) => c.length > CRITERION_MAX))
    errors.criteria = MESSAGES.criterion;
  return errors;
}

/** Maps a problem+json `errors[].path` pointer onto a form field. */
function fieldForPath(path: string): FieldName | null {
  const head = path.replace(/^\//, '').split(/[./[]/)[0];
  switch (head) {
    case 'projectId':
      return 'project';
    case 'title':
      return 'title';
    case 'businessObjective':
      return 'objective';
    case 'acceptanceCriteria':
      return 'criteria';
    default:
      return null;
  }
}

function cookieProject(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${PROJECT_COOKIE}=([^;]*)`));
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function firstInvalid(errors: Errors): FieldName | null {
  return FIELD_ORDER.find((f) => errors[f]) ?? null;
}

/** Create requirement form (specs/001 US4 scenario 1; ui-requirements.md §4/§5.3). */
export function CreateRequirementForm({ me }: CreateRequirementFormProps) {
  const router = useRouter();
  const headingId = useId();
  const [project, setProject] = useState<string>(() => {
    const key = cookieProject();
    return (me.projects.find((p) => p.key === key) ?? me.projects[0])?.id ?? '';
  });
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [criteriaText, setCriteriaText] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const projectRef = useRef<HTMLSelectElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const objectiveRef = useRef<HTMLTextAreaElement>(null);
  const criteriaRef = useRef<HTMLTextAreaElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<FieldName | 'notice' | null>(null);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const el =
      target === 'notice'
        ? noticeRef.current
        : target === 'project'
          ? projectRef.current
          : target === 'title'
            ? titleRef.current
            : target === 'objective'
              ? objectiveRef.current
              : criteriaRef.current;
    el?.focus();
  });

  if (!me.canCreateRequirement) {
    return (
      <Notice tone="info">
        Your role ({me.user.role}) cannot create requirements. Ask an administrator if you need
        this.
      </Notice>
    );
  }

  const values = () => ({
    project,
    title,
    objective,
    criteria: splitCriteria(criteriaText),
  });

  const revalidate = () => {
    if (attempted) setErrors(validate(values()));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    setApiError(null);
    const v = values();
    const next = validate(v);
    setErrors(next);
    const invalid = firstInvalid(next);
    if (invalid) {
      focusNext.current = invalid;
      return;
    }
    const body: CreateRequirementRequest = {
      projectId: v.project,
      title: v.title.trim(),
      businessObjective: v.objective.trim(),
      acceptanceCriteria: v.criteria,
    };
    setSubmitting(true);
    try {
      const detail = await apiFetch<RequirementDetail>('/api/requirements', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      router.push(detail.requirement.href);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && typeof window !== 'undefined') {
        window.location.assign('/sign-in?reason=expired&next=/requirements/new');
        return;
      }
      if (err instanceof ApiError && err.status === 400 && err.problem?.errors?.length) {
        const mapped: Errors = {};
        for (const item of err.problem.errors) {
          const f = fieldForPath(item.path);
          if (f && !mapped[f]) mapped[f] = item.message;
        }
        const first = firstInvalid(mapped);
        if (first) {
          setErrors(mapped);
          focusNext.current = first;
          return;
        }
      }
      setApiError(
        err instanceof ApiError && err.problem?.title ? err.problem.title : 'Request failed',
      );
      focusNext.current = 'notice';
    } finally {
      setSubmitting(false);
    }
  };

  const err = (f: FieldName) => (errors[f] ? { error: errors[f] } : {});

  return (
    <>
      {apiError ? (
        <Notice ref={noticeRef} tone="error" tabIndex={-1}>
          The requirement couldn&apos;t be created. {apiError}
        </Notice>
      ) : null}
      <Card>
        <h2 id={headingId}>Requirement details</h2>
        <form aria-labelledby={headingId} noValidate onSubmit={(e) => void onSubmit(e)}>
          <Field label="Project" htmlFor="req-project" {...err('project')}>
            <Select
              ref={projectRef}
              id="req-project"
              required
              value={project}
              onChange={(e) => setProject(e.target.value)}
              onBlur={revalidate}
              disabled={submitting}
            >
              {me.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" hint="3–200 characters" htmlFor="req-title" {...err('title')}>
            <Input
              ref={titleRef}
              id="req-title"
              required
              maxLength={TITLE_MAX}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={revalidate}
              readOnly={submitting}
            />
          </Field>
          <Field
            label="Business objective"
            hint="10–4 000 characters"
            htmlFor="req-objective"
            {...err('objective')}
          >
            <TextArea
              ref={objectiveRef}
              id="req-objective"
              required
              rows={6}
              maxLength={OBJECTIVE_MAX}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              onBlur={revalidate}
              readOnly={submitting}
            />
          </Field>
          <Field
            label="Acceptance criteria (optional)"
            hint="One per line, up to 20"
            htmlFor="req-criteria"
            {...err('criteria')}
          >
            <TextArea
              ref={criteriaRef}
              id="req-criteria"
              rows={4}
              value={criteriaText}
              onChange={(e) => setCriteriaText(e.target.value)}
              onBlur={revalidate}
              readOnly={submitting}
            />
          </Field>
          <ActionBar>
            <Button type="submit" variant="saffron" disabled={submitting} loading={submitting}>
              Create requirement
            </Button>
            <Button variant="ghost" href="/requirements">
              Cancel
            </Button>
          </ActionBar>
        </form>
      </Card>
    </>
  );
}
