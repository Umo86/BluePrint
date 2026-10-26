import type { Metadata } from 'next';
import { IconAccessible, IconAlignLeft, IconFilter, IconShieldCheck } from '@tabler/icons-react';
import { CtaLink } from '@/components/site/cta-link';
import { SitePage } from '@/components/site/site-chrome';
import styles from '@/components/site/site.module.css';
import { getCurrentAuth } from '@/server/auth/current';

export const metadata: Metadata = {
  title: 'About',
  description: 'Why Media10 built BluePrint, and how it is made.',
};

// Set out like the title block in the corner of a drawing.
const TITLE_BLOCK: { label: string; value: string; wide?: boolean }[] = [
  { label: 'Project', value: 'BluePrint', wide: true },
  { label: 'Made by', value: 'Media10' },
  { label: 'Hosted in', value: 'London' },
  { label: 'For', value: 'Exhibitors, stand contractors, suppliers and show teams', wide: true },
  { label: 'Shows', value: 'UK Construction Week, Futurebuild, Stone & Surface', wide: true },
  { label: 'Accessibility', value: 'Tested to WCAG 2.2 AA', wide: true },
  { label: 'Sign-in', value: 'Emailed codes, with two-factor for staff', wide: true },
];

const PRINCIPLES = [
  { icon: IconAlignLeft, title: 'Plain words', text: 'Every page says what to do, by when and why, without jargon.' },
  {
    icon: IconFilter,
    title: 'Only what applies',
    text: 'Shell scheme and space-only exhibitors see the tasks and manual pages for their own stand type, and nothing else.',
  },
  {
    icon: IconAccessible,
    title: 'Usable by everyone',
    text: 'Pages are tested against the WCAG 2.2 AA accessibility standard, and work on a phone as well as a laptop.',
  },
  {
    icon: IconShieldCheck,
    title: 'Careful with data',
    text: 'Two-factor sign-in for staff, private files, a full audit log, and tools for handling data protection requests.',
  },
];

export default async function AboutPage() {
  const auth = await getCurrentAuth();
  const signedIn = Boolean(auth && !auth.needsSecondFactor && !auth.needsTwoFactorSetup);

  return (
    <SitePage signedIn={signedIn} current="about">
      <section className={`${styles.hero} ${styles.heroPlain}`} aria-labelledby="about-title">
        <div className={`${styles.container} ${styles.heroText}`}>
          <p className={styles.kicker} style={{ margin: 0 }}>
            About BluePrint.
          </p>
          <h1 id="about-title" className={styles.display}>
            Made for Media10 shows <span className={styles.displaySans}>and the people who build them</span>
          </h1>
          <p className={styles.lede}>
            BluePrint is Media10’s own exhibitor manual and service-ordering platform. Every stand has one record that the exhibitor, their contractor, the
            suppliers and the show team all work from.
          </p>
          <dl className={styles.titleBlock}>
            {TITLE_BLOCK.map((c) => (
              <div key={c.label} className={`${styles.titleCell} ${c.wide ? styles.titleCellWide : ''}`}>
                <dt className={styles.titleLabel}>{c.label}</dt>
                <dd className={styles.titleValue}>{c.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="why-title">
        <div className={`${styles.container} ${styles.split}`}>
          <div className={styles.splitHead}>
            <p className={styles.kicker}>Why it exists.</p>
            <h2 id="why-title" className={styles.h2}>
              A stand has a lot to get right <span className={styles.h2Sans}>before the doors open</span>
            </h2>
          </div>
          <div>
            <p className={styles.body}>
              Getting a stand ready for a trade show means reading the rules, meeting deadlines, ordering power, furniture and graphics, and, for a space-only
              stand, having the design and the safety documents approved before anyone can build.
            </p>
            <p className={styles.body}>
              When all of that is spread across a PDF manual, separate order forms and long email threads, things get missed, and the show team spends the
              last weeks before build-up chasing.
            </p>
            <p className={styles.body}>
              BluePrint keeps it on one record for each stand. Exhibitors see only what applies to them, with every deadline in one checklist. Contractors and
              suppliers see the stands they work on. The show team can see at a glance who is on track and who needs a reminder.
            </p>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionMist}`} aria-labelledby="principles-title">
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>How it is made.</p>
            <h2 id="principles-title" className={styles.h2}>
              Four rules <span className={styles.h2Sans}>for every page</span>
            </h2>
          </div>
          <div className={styles.facts}>
            {PRINCIPLES.map(({ icon: Icon, title, text }) => (
              <div key={title} className={styles.fact}>
                <Icon size={26} stroke={1.5} className={styles.factIcon} aria-hidden="true" />
                <h3 className={styles.factTitle}>{title}</h3>
                <p className={styles.factText}>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionDark}`} aria-labelledby="contact-title">
        <div className={styles.container}>
          <div className={styles.questionsHead}>
            <p className={styles.kicker} style={{ margin: 0 }}>
              Get in touch.
            </p>
            <h2 id="contact-title" className={styles.h2}>
              Questions about your stand? <span className={styles.h2Sans}>Ask your show team</span>
            </h2>
            <p className={styles.body}>
              If you are exhibiting, your show team’s contact details are on your BluePrint home page, and you can send them a question from the help desk. If
              your invitation has not arrived, contact the team at the show you are exhibiting at.
            </p>
            <div className={styles.actions}>
              <CtaLink href={signedIn ? '/start' : '/sign-in'} onDark>
                {signedIn ? 'Open BluePrint' : 'Sign in'}
              </CtaLink>
              <CtaLink href="/" variant="ghost" onDark>
                Back to home
              </CtaLink>
            </div>
          </div>
        </div>
      </section>
    </SitePage>
  );
}
