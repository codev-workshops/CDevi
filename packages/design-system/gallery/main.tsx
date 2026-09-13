import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../css/cdevi.css';
import './gallery.css';
import { Button, Segmented, ThemeProvider, useTheme, type ThemeSetting } from '../src/index';
import { entries } from './entries';

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return (
    <Segmented<ThemeSetting>
      label="Theme"
      value={theme}
      onChange={setTheme}
      options={[
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
        { value: 'system', label: 'System' },
      ]}
    />
  );
}

function Gallery() {
  // ?entry=Name renders a single entry (used by the visual tests); ?theme=dark forces a theme.
  const params = new URLSearchParams(location.search);
  const only = params.get('entry');
  const shown = only ? entries.filter((e) => e.name === only) : entries;
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    document.title = only ? `CDevi gallery — ${only}` : 'CDevi design system — gallery';
  }, [only]);

  return (
    <div className="g-wrap">
      <header className="g-head">
        <h1>
          CDevi{' '}
          <span className="si" lang="si">
            සීදේවි
          </span>{' '}
          design system
        </h1>
        <ThemeSwitch />
      </header>
      {!only && (
        <>
          <p className="g-intro">
            Every component exported by <code className="cd-mono">@cdevi/design-system</code>, in
            both themes. Rules live in <code className="cd-mono">DESIGN.md</code>; usage and the
            accessibility contract are under each example. Full-page pattern references:{' '}
            <a href="/reference-screens/index.html">reference screens</a>.
          </p>
          <nav className="g-nav" aria-label="Gallery sections">
            {entries.map((e) => (
              <a key={e.name} href={`#g-${e.name}`}>
                {e.title}
              </a>
            ))}
          </nav>
          <div className="cd-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((x) => !x)}
              aria-pressed={expanded}
            >
              {expanded ? 'Hide' : 'Show'} all usage notes
            </Button>
          </div>
        </>
      )}
      {shown.map((e) => (
        <section
          key={e.name}
          className="g-ex"
          id={`g-${e.name}`}
          data-entry={e.name}
          aria-labelledby={`h-${e.name}`}
        >
          <h2 id={`h-${e.name}`}>{e.title}</h2>
          <p>{e.description}</p>
          <div className={`g-stage${e.row ? ' g-row' : ''}${e.shell ? ' g-shell' : ''}`}>
            {e.render()}
          </div>
          <details className="g-a11y" open={expanded || undefined}>
            <summary>Usage and accessibility contract</summary>
            <pre>{e.usage}</pre>
            <p>{e.a11y}</p>
          </details>
        </section>
      ))}
    </div>
  );
}

const forced = new URLSearchParams(location.search).get('theme') as ThemeSetting | null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={forced ?? 'system'}>
      <Gallery />
    </ThemeProvider>
  </StrictMode>,
);
