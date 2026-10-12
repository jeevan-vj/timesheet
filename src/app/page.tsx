export default function HomePage() {
  return (
    <main className="landing">
      <nav className="topbar">
        <a className="brand" href="/"><span className="brand-mark">C</span> CleanTrack</a>
        <div className="nav-actions"><a href="/sign-in">Sign in</a><a className="button small" href="/sign-up">Create account</a></div>
      </nav>
      <section className="hero">
        <div>
          <p className="eyebrow">Built for cleaning teams</p>
          <h1>Hours, sites, and weekly pay—in one calm place.</h1>
          <p className="hero-copy">Record each contractor’s daily shift, keep site rates straight, and know what to pay every Monday without rebuilding a spreadsheet.</p>
          <div className="hero-actions"><a className="button" href="/sign-up">Start tracking</a><a className="text-link" href="/sign-in">I already have an account →</a></div>
          <p className="micro">Private by default · NZD totals · Monday–Sunday weeks</p>
        </div>
        <aside className="preview-card" aria-label="Example weekly pay summary">
          <div className="preview-header"><span>This week</span><strong>31 Aug – 6 Sep</strong></div>
          <div className="preview-total"><span>Contractor pay</span><strong>$2,184.50</strong></div>
          <div className="person-row"><span className="avatar coral">AM</span><div><strong>Aroha M.</strong><small>32h 30m · 3 sites</small></div><b>$1,040.00</b></div>
          <div className="person-row"><span className="avatar mint">JT</span><div><strong>James T.</strong><small>21h 15m · 2 sites</small></div><b>$637.50</b></div>
          <div className="person-row"><span className="avatar blue">SK</span><div><strong>Sina K.</strong><small>16h 54m · 1 site</small></div><b>$507.00</b></div>
        </aside>
      </section>
      <section className="feature-strip">
        <article><span>01</span><h2>Add your team</h2><p>Keep contractor contact details and default rates together.</p></article>
        <article><span>02</span><h2>Connect each site</h2><p>Assign people wherever they work, with a site-specific rate when needed.</p></article>
        <article><span>03</span><h2>Close the week</h2><p>Review daily shifts and see exact gross payment totals by contractor and by site.</p></article>
      </section>
    </main>
  );
}
