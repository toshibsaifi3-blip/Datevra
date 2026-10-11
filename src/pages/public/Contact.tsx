import { useState } from "react";
import { Field, PageHero, Reveal, inputCls, useToast } from "../../components/ui";
import { useBackend, useAsync } from "../../lib/data";
import type { PlatformSettings } from "../../lib/types";

export default function Contact() {
  const { toast } = useToast();
  const db = useBackend();
  const { data: settings } = useAsync(
    (b) => b.getSettings(),
    [db],
    null as PlatformSettings | null,
  );
  const supportEmail = settings?.supportEmail ?? "care@datevra.in";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) {
      setError("Please fill in your name, email and message.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("That email address doesn't look quite right.");
      return;
    }
    setError("");
    setName("");
    setEmail("");
    setMessage("");
    toast("Message received — our team replies within 2 days.");
  };

  return (
    <div>
      <PageHero
        kicker="Contact"
        title="We'd love to hear from you"
        sub="Questions, feedback, press, partnerships — or just to say hello. A human reads every message."
      />

      <section className="max-w-6xl mx-auto px-5 py-14 grid md:grid-cols-5 gap-6">
        <Reveal className="md:col-span-3">
          <form onSubmit={submit} className="glass rounded-[1.75rem] p-8 space-y-5">
            <Field label="Your name">
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Aarav Sharma"
                autoComplete="name"
              />
            </Field>
            <Field label="Email address">
              <input
                className={inputCls}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </Field>
            <Field label="Message" hint="Tell us what's on your mind — the more detail, the better we can help.">
              <textarea
                className={`${inputCls} min-h-[140px] resize-y`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Hi Datevra team…"
                maxLength={2000}
              />
            </Field>
            {error && (
              <p className="text-sm text-rosegold bg-burgundy/25 border border-burgundy-soft/40 rounded-xl px-4 py-3">
                {error}
              </p>
            )}
            <button type="submit" className="btn-gold rounded-full px-10 py-3.5 text-sm font-semibold w-full sm:w-auto">
              Send message
            </button>
          </form>
        </Reveal>

        <Reveal delay={0.1} className="md:col-span-2">
          <div className="glass-strong rounded-[1.75rem] p-8 h-full">
            <h3 className="font-display text-2xl text-ivory">Other ways to reach us</h3>
            <div className="mt-6 space-y-5 text-sm">
              <div>
                <p className="text-[0.68rem] uppercase tracking-[0.25em] text-mist">Support</p>
                <a
                  href={`mailto:${supportEmail}`}
                  className="text-champagne hover:text-rosegold transition-colors mt-1 inline-block"
                >
                  {supportEmail}
                </a>
                <p className="text-mist/75 text-xs mt-1">Replies within 2 days · safety reports within 24 hours</p>
              </div>
              <div>
                <p className="text-[0.68rem] uppercase tracking-[0.25em] text-mist">Partnerships</p>
                <p className="text-ivory-dim/85 mt-1">
                  Cafés and venues interested in partnering with Datevra — tell us about your space in the form.
                </p>
              </div>
              <div>
                <p className="text-[0.68rem] uppercase tracking-[0.25em] text-mist">Press</p>
                <p className="text-ivory-dim/85 mt-1">
                  For media enquiries, mention "Press" in your message subject line.
                </p>
              </div>
            </div>
            <div className="ornament-divider my-6">
              <span className="text-sm">✦</span>
            </div>
            <p className="text-xs text-mist/75 leading-relaxed">
              Please never share passwords, payment details or intimate content
              via this form. For urgent safety concerns, use the in-app report
              flow for the fastest response.
            </p>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
