import type { Metadata } from 'next';
import {
  IconBuildingStore,
  IconHistory,
  IconLayoutDashboard,
  IconLock,
  IconMapPin,
  IconShieldLock,
  IconTools,
  IconTruckDelivery,
} from '@tabler/icons-react';
import { CtaLink } from '@/components/site/cta-link';
import { HallPlan } from '@/components/site/hall-plan';
import { SitePage } from '@/components/site/site-chrome';
import styles from '@/components/site/site.module.css';
import { getCurrentAuth } from '@/server/auth/current';

export const metadata: Metadata = {
  title: { absolute: 'BluePrint for exhibition organisers' },
  description: 'The exhibitor manual and service-ordering platform for exhibition organisers.',
};

const AUDIENCES = [
  {
    icon: IconLayoutDashboard,
    title: 'Organisers',
    text: 'Set up each show’s manual, deadlines and services, follow every exhibitor’s progress, send reminders, review stand packs and download reports.',
  },
  {
    icon: IconBuildingStore,
    title: 'Exhibitors',
    text: 'Read the manual for your stand type, work through your checklist before each deadline, and order electrics, furniture and graphics in one basket.',
  },
  {
    icon: IconTools,
    title: 'Stand contractors',
    text: 'Prepare the space-only stand pack (drawings, risk assessment, method statement and insurance) and send it for health and safety review.',
  },
  {
    icon: IconTruckDelivery,
    title: 'Suppliers',
    text: 'Keep your catalogue up to date, see each order as it comes in with its details and artwork, and set up payouts.',
  },
];

const STEPS = [
  {
    title: 'Invitations go out',
    text: 'The organiser adds exhibitors and stands, or imports them from a spreadsheet, and BluePrint emails each company an invitation.',
  },
  {
    title: 'Exhibitors get their checklist',
    text: 'Each exhibitor sees the manual pages and tasks for their stand type, with every deadline in one place and reminders before they are due.',
  },
  {
    title: 'Services are ordered',
    text: 'Electrics, furniture, graphics and more come from the show’s approved suppliers, paid by card or on invoice, with artwork attached to the order.',
  },
  {
    title: 'Space-only stands are approved',
    text: 'The stand contractor sends the stand pack. The organiser’s team and its health and safety reviewers approve it or ask for changes.',
  },
  {
    title: 'Ready for build-up',
    text: 'The overview shows which stands are ready and who still has something to do, so reminders reach the right people.',
  },
];

const FACTS = [
  {
    icon: IconShieldLock,
    title: 'Careful with sign-in',
    text: 'Passwords are stored with Argon2id, common ones are refused, and repeated wrong tries pause sign-in. Two-factor sign-in can be required for staff.',
  },
  { icon: IconHistory, title: 'Every change is logged', text: 'The audit log records who changed what, and when. Super admins can search it and download it.' },
  { icon: IconLock, title: 'Private files', text: 'Uploads open only for the people who need them, through links that stop working after a minute.' },
  { icon: IconMapPin, title: 'Run from London', text: 'The site and its database are hosted in London, and data protection requests are handled from the admin dashboard.' },
];

const QUESTIONS = [
  {
    q: 'How do I get an account?',
    a: 'The organiser of your show invites you by email. Follow the link in the invitation to get started, using the address it was sent to.',
  },
  {
    q: 'Can colleagues help with our stand?',
    a: 'Yes. Your company’s main contact can invite colleagues from the Company page, and each person signs in with their own email address.',
  },
  {
    q: 'Who sends the stand pack for a space-only stand?',
    a: 'The exhibitor names their stand contractor in BluePrint, and the contractor is invited to prepare and send the stand pack. If you are building the stand yourselves, you send it.',
  },
  {
    q: 'Who do I ask about my stand?',
    a: 'The organiser’s team for your show. Their details are on your BluePrint home page, and you can send them a question from the help desk.',
  },
  {
    q: 'Can each show have its own look?',
    a: 'Yes. Each show has its own logo and colours on the exhibitor pages, and its emails come from the show’s own address.',
  },
];

export default async function HomePage() {
  const auth = await getCurrentAuth();
  const signedIn = Boolean(auth && !auth.needsSecondFactor && !auth.needsTwoFactorSetup);
  const primary = signedIn ? { href: '/start', label: 'Open BluePrint' } : { href: '/sign-in', label: 'Sign in' };

  return (
    <SitePage signedIn={signedIn} current="home">
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={`${styles.container} ${styles.heroText}`}>
          <h1 id="hero-title" className={styles.display}>
            Every stand ready <span className={styles.displaySans}>for build-up</span>
          </h1>
          <p className={styles.lede}>
            The exhibitor manual and service-ordering platform for exhibition organisers. Deadlines, orders and stand approvals in one place, for everyone
            working on a stand.
          </p>
          <div className={styles.actions}>
            <CtaLink href={primary.href}>{primary.label}</CtaLink>
            <CtaLink href="/about" variant="ghost">
              About BluePrint
            </CtaLink>
          </div>
        </div>
        <HallPlan />
      </section>

      <p className={`${styles.container} ${styles.shows}`}>
        Built for organisers running <strong>one show or a whole portfolio</strong>, each with its own branding, manual, suppliers and team.
      </p>

      <section className={styles.section} aria-labelledby="who-title" style={{ paddingTop: 48 }}>
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Who it’s for.</p>
            <h2 id="who-title" className={styles.h2}>
              One record for each stand, <span className={styles.h2Sans}>shared by everyone who works on it</span>
            </h2>
          </div>
          <div className={styles.cards}>
            {AUDIENCES.map(({ icon: Icon, title, text }) => (
              <article key={title} className={styles.card}>
                <span className={styles.cardIcon} aria-hidden="true">
                  <Icon size={22} stroke={1.5} />
                </span>
                <h3 className={styles.cardTitle}>{title}</h3>
                <p className={styles.cardText}>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionMist}`} aria-labelledby="how-title">
        <div className={`${styles.container} ${styles.split}`}>
          <div className={styles.splitHead}>
            <p className={styles.kicker}>How a show runs.</p>
            <h2 id="how-title" className={styles.h2}>
              From the first invitation <span className={styles.h2Sans}>to the morning of build-up</span>
            </h2>
            <p className={styles.lede}>Every step happens in BluePrint, so the organiser can see where each stand is up to.</p>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((s, i) => (
              <li key={s.title} className={styles.step}>
                <span className={styles.stepNum} aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className={styles.stepTitle}>{s.title}</h3>
                <p className={styles.stepText}>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="security-title">
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Security.</p>
            <h2 id="security-title" className={styles.h2}>
              Built to look after <span className={styles.h2Sans}>exhibitors’ information</span>
            </h2>
          </div>
          <div className={styles.facts}>
            {FACTS.map(({ icon: Icon, title, text }) => (
              <div key={title} className={styles.fact}>
                <Icon size={26} stroke={1.5} className={styles.factIcon} aria-hidden="true" />
                <h3 className={styles.factTitle}>{title}</h3>
                <p className={styles.factText}>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionDark}`} aria-labelledby="questions-title">
        <div className={styles.container}>
          <div className={styles.questionsHead}>
            <p className={styles.kicker} style={{ margin: 0 }}>
              Questions.
            </p>
            <h2 id="questions-title" className={styles.h2}>
              Exhibiting at a show? <span className={styles.h2Sans}>Start with your invitation</span>
            </h2>
            <div className={styles.actions}>
              <CtaLink href={primary.href} onDark>
                {primary.label}
              </CtaLink>
              <CtaLink href="/about" variant="ghost" onDark>
                About BluePrint
              </CtaLink>
            </div>
          </div>
          <dl className={styles.faq}>
            {QUESTIONS.map(({ q, a }) => (
              <div key={q} className={styles.faqItem}>
                <dt className={styles.faqQ}>{q}</dt>
                <dd className={styles.faqA}>{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </SitePage>
  );
}
