import {
  BadgeCheck,
  Bot,
  ClipboardList,
  FileText,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";

export const landingContent = {
  hero: {
    eyebrow: "Chrome extension. One profile. Applications on autopilot.",
    headline: {
      line1: "Land more interviews",
      emphasis: "by applying 10× faster",
    },
    subheadline:
      "exempliphai finds roles that match you, tailors your resume, autofills every field, and can submit applications for you. You stay in control. We do the busywork.",
    stats: [
      { label: "Setup time", value: "5 min" },
      { label: "Applications per hour", value: "10–50" },
      { label: "Privacy-first", value: "Never sold" },
    ],
    ctas: {
      primary: { label: "Install free and start applying", href: "/download" },
      secondary: { label: "Watch the 60s demo", href: "#demo" },
    },
    privacyNote:
      "Private by default. We never sell your data. You choose what gets submitted.",
  },

  featureTabs: {
    title: "Your fastest path from search to interview.",
    subtitle:
      "Stop spending nights copy and pasting. exempliphai automates the boring parts so you can apply early, apply more, and show up sharper in interviews.",
    items: [
      {
        icon: Search,
        title: "Instant matches",
        description:
          "Set role, location, and dealbreakers. exempliphai continuously surfaces only jobs worth applying to.",
        isNew: false,
        backgroundPositionX: 0,
        backgroundPositionY: 0,
        backgroundSizeX: 150,
      },
      {
        icon: Sparkles,
        title: "Tailor your resume",
        description:
          "Generate a job-specific version, catch missing keywords, and keep your story consistent across applications.",
        isNew: false,
        backgroundPositionX: 96,
        backgroundPositionY: 100,
        backgroundSizeX: 140,
      },
      {
        icon: Zap,
        title: "Autofill + bulk apply",
        description:
          "One profile powers every form. Reuse verified answers, avoid typos, and submit in fewer clicks.",
        isNew: false,
        backgroundPositionX: 18,
        backgroundPositionY: 60,
        backgroundSizeX: 165,
      },
      {
        icon: ClipboardList,
        title: "List mode sprints",
        description:
          "Queue roles, tailor once per posting, then run a clean apply sprint. No tabs. No chaos.",
        isNew: true,
        backgroundPositionX: 100,
        backgroundPositionY: 25,
        backgroundSizeX: 175,
      },
      {
        icon: FileText,
        title: "Built-in tracking",
        description:
          "Status, deadlines, notes, follow-ups, and what you sent — all in one place. Never lose a lead.",
        isNew: false,
        backgroundPositionX: 62,
        backgroundPositionY: 35,
        backgroundSizeX: 160,
      },
      {
        icon: Bot,
        title: "Smarter answers",
        description:
          "Get posting-specific talking points and strong answers to common questions — in your voice.",
        isNew: false,
        backgroundPositionX: 45,
        backgroundPositionY: 75,
        backgroundSizeX: 155,
      },
    ],
  },

  howItWorks: {
    title: "How it works",
    subtitle:
      "Set it up once, then run daily apply sprints in minutes. Be early. Be consistent. Stop burning out.",
    steps: [
      {
        title: "Build your private profile once",
        description:
          "Import your resume and set your targets. exempliphai saves your answers so every future application is faster.",
        icon: BadgeCheck,
      },
      {
        title: "Find roles, fast",
        description:
          "Get a clean shortlist of roles that match your criteria. Apply early before the pile up.",
        icon: Search,
      },
      {
        title: "Tailor, then lock in your story",
        description:
          "Generate a tailored resume and get clear talking points for the questions recruiters actually ask.",
        icon: Sparkles,
      },
      {
        title: "Apply in minutes and track automatically",
        description:
          "Autofill forms, reuse saved answers, and keep a clean tracker so follow ups are automatic, not forgotten.",
        icon: ClipboardList,
      },
    ],
  },

  testimonials: {
    title: "More applications. More replies. Less mental load.",
    subtitle:
      "exempliphai users apply earlier and at higher volume without turning job search into a second full time job.",
    items: [
      {
        quote:
          "“I used to spend my evenings on applications. Now I run a 20 minute sprint and I’m done for the day.”",
        name: "Maya R.",
        role: "New Grad, software engineering",
      },
      {
        quote:
          "“As a data analyst, I can’t afford sloppy copy/paste. Autofill keeps my answers consistent and I apply while the posting is still fresh.”",
        name: "Riley K.",
        role: "Data Analyst",
      },
      {
        quote:
          "“The privacy-first approach was the dealbreaker for me. I can tailor fast without worrying my resume is getting resold.”",
        name: "Casey T.",
        role: "Cybersecurity Analyst",
      },
      {
        quote:
          "“List mode turned my job search into a real workflow: shortlist, tailor, submit. I’m getting replies because I’m early now.”",
        name: "Avery V.",
        role: "Sales Development Representative",
      },
      {
        quote:
          "“For product design roles, the tailored versions help me hit the right keywords without rewriting everything from scratch.”",
        name: "Alex P.",
        role: "Product Designer",
      },
      {
        quote:
          "“Marketing applications used to eat my whole weekend. Now I batch 15–20 in one sitting and keep my messaging tight.”",
        name: "Taylor S.",
        role: "Marketing Coordinator",
      },
      {
        quote:
          "“I track postings like I track budgets. Having everything saved and searchable keeps me moving fast without losing details.”",
        name: "Morgan L.",
        role: "Financial Analyst",
      },
      {
        quote:
          "“Supply chain roles move quickly. The minute a job goes live, I can tailor and submit before it’s flooded.”",
        name: "Quinn D.",
        role: "Supply Chain Coordinator",
      },
      {
        quote:
          "“My schedule is chaotic. Being able to apply in short bursts between shifts is the only way I stay consistent.”",
        name: "Camryn H.",
        role: "Registered Nurse",
      },
      {
        quote:
          "“Customer success interviews love specifics. exempliphai helps me keep my story consistent across apps without oversharing.”",
        name: "Kevin J.",
        role: "Customer Success Manager",
      },
    ],
  },

  faq: {
    title: "FAQ",
    subtitle: "The honest answers before you install.",
    items: [
      {
        q: "Is exempliphai free?",
        a: "Yes. You can start free. We may introduce optional paid plans for advanced automation, higher volume, or premium AI features.",
      },
      {
        q: "Do you sell my data?",
        a: "No. We do not sell your personal data. Your profile is private by default, and you control what gets submitted on your behalf.",
      },
      {
        q: "Will it apply without me watching?",
        a: "When auto apply is available, exempliphai can submit for you. You can always review and keep it in assisted mode if you prefer.",
      },
      {
        q: "How is this different from other autofill tools?",
        a: "Most tools stop at form fill. exempliphai goes end to end: match, tailor, answer, apply, then track so you can follow up.",
      },
      {
        q: "Will my applications look spammy?",
        a: "No. You provide the source profile and answers. Tailoring keeps your experience accurate and relevant, not generic.",
      },
      {
        q: "What do I need to get started?",
        a: "Your resume and 5 minutes. Import once, set your targets, then run your first apply sprint.",
      },
    ],
  },
} as const;

export type LandingContent = typeof landingContent;
