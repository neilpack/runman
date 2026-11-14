// The rest of the welcome page under the hero: About (what RunMan is) and Contact.
// The header's "About Us" / "Contact Us" links scroll down to these (see scrollToSection.ts).

import { useId, useState } from 'react';
import { Link } from 'react-router';
import { scrollToSection } from './scrollToSection';
import './welcomeSections.css';

/**
 * Where the contact form sends messages. The form opens the visitor's own email app with the
 * message filled in (there's no backend mail service), so it needs a real team inbox.
 * Leave it empty to show the form with sending switched off.
 */
const CONTACT_EMAIL = '';

const FEATURES = [
  {
    title: 'Build your mix',
    text: 'Search a free music library, or upload and record your own audio. Every tape has two sides with 30 minutes each.',
    icon: <path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm11-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3z" />,
  },
  {
    title: 'Make it yours',
    text: 'Pick the shell colour, label, ink and pen style, then cover each side in stickers.',
    icon: <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z" />,
  },
  {
    title: 'Press play',
    text: 'Drop the tape into the RunMan Walkman: play, pause, fast-forward, rewind and skip, with real tape sounds.',
    icon: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <circle cx="8.5" cy="12" r="2" />
        <circle cx="15.5" cy="12" r="2" />
      </>
    ),
  },
  {
    title: 'Share or keep it',
    text: 'Keep a tape private, or make it public so other listeners can find it on Explore.',
    icon: <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" />,
  },
];

export function WelcomeSections() {
  return (
    <>
      <AboutSection />
      <ContactSection />
      <footer className="ws-footer">
        <span>© 2026 RunMan</span>
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            scrollToSection('');
          }}
        >
          Back to top ↑
        </a>
      </footer>
    </>
  );
}

function AboutSection() {
  return (
    <section id="about" className="ws-section ws-about" aria-labelledby="about-title">
      <div className="ws-inner">
        <p className="ws-eyebrow">About RunMan</p>
        <h2 id="about-title" className="ws-title">
          Mixtapes, rewound for the streaming age
        </h2>
        <p className="ws-lead">
          Remember making a mixtape for someone? Picking every song, timing each side, decorating the label? RunMan
          brings that back. Build cassette mixes from real music, make them look the way you want, and play them on a
          Walkman right in your browser.
        </p>

        <ul className="ws-features">
          {FEATURES.map((f) => (
            <li key={f.title} className="ws-feature">
              <span className="ws-feature-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">{f.icon}</svg>
              </span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </li>
          ))}
        </ul>

        <Link to="/login?mode=signup" className="welcome-cta ws-cta">
          Start your first tape
        </Link>
      </div>
    </section>
  );
}

function ContactSection() {
  const id = useId();
  const [sent, setSent] = useState(false);
  const ready = CONTACT_EMAIL !== '';

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ready) return;
    const data = new FormData(e.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    const message = String(data.get('message') ?? '').trim();
    const subject = `RunMan: message from ${name || 'a visitor'}`;
    const body = `${message}\n\n${name}${email ? ` <${email}>` : ''}`;
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSent(true);
  };

  return (
    <section id="contact" className="ws-section ws-contact" aria-labelledby="contact-title">
      <div className="ws-inner ws-contact-grid">
        <div>
          <p className="ws-eyebrow">Contact us</p>
          <h2 id="contact-title" className="ws-title">
            Say hello
          </h2>
          <p className="ws-lead">
            Questions, ideas for the next feature, or found a bug? Send the RunMan team a note and we'll get back to
            you.
          </p>
          {ready && (
            <p className="ws-direct">
              Or email us directly at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
          )}
        </div>

        <form className="ws-form" onSubmit={submit}>
          <label htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} name="name" autoComplete="name" required />

          <label htmlFor={`${id}-email`}>Email</label>
          <input id={`${id}-email`} name="email" type="email" autoComplete="email" required />

          <label htmlFor={`${id}-message`}>Message</label>
          <textarea id={`${id}-message`} name="message" rows={5} required />

          <button type="submit" className="welcome-cta ws-send" disabled={!ready}>
            Send message
          </button>
          <p className="ws-form-note" role="status">
            {!ready
              ? 'Messages can’t be sent yet: the team email address hasn’t been set up.'
              : sent
                ? 'Your email app should open with the message filled in. Just press send there.'
                : 'Opens your email app with your message ready to send.'}
          </p>
        </form>
      </div>
    </section>
  );
}
