/* ============================================================
   RESUME CONTENT — the single source of every visible word.
   Edit this file to change anything the site says.

   The site presents Riley Betts' résumé as a mock Bettsuite ERP
   account: an Employee record, an Employment History list,
   Project records and a Home dashboard of portlets. Components
   render from this file and only from this file.
   ============================================================ */

/* ------------------------------------------------------------
   /ops (the private analytics console) still imports this type.
   Leave it exported.
   ------------------------------------------------------------ */
export interface StatusReadout {
  label: string
  value: string
  lamp?: 'green' | 'amber' | 'red' | 'teal'
  /** wired to a live client-side value */
  live?: 'uptime' | 'clock'
}

/* ---- Bettsuite chrome ---------------------------------------
   Bettsuite's menus are strictly SINGLE COLUMN: one label per row,
   no category headings inside the panel and no descriptive
   subtext. Rows with children show a right chevron and open a
   flyout butted against the parent panel. Every menu's first row
   is "<Tab> Overview", followed by a separator.
   ------------------------------------------------------------ */
export interface NavLink {
  label: string
  to?: string
  href?: string
  /** rows with children render a › and open a flyout */
  children?: NavLink[]
}
export interface NavTab {
  id: string
  label: string
  /** the three icon-only tabs Bettsuite pins to the far left */
  icon?: 'recent' | 'shortcuts' | 'home'
  to?: string
  items?: NavLink[]
}

/* ---- records ----------------------------------------------- */
export type Tone = 'green' | 'amber' | 'red' | 'teal' | 'blue' | 'gray'

export interface Field {
  label: string
  value: string
  href?: string
  mono?: boolean
  tone?: Tone
  help?: string
}
export interface FieldGroup {
  title: string
  fields: Field[]
}

export interface SkillRow {
  category: string
  proficiency: string
  years: string
  skills: string[]
}

/* ---- dashboard --------------------------------------------- */
export interface Kpi {
  label: string
  value: string
  period: string
  compare: string
  delta: string
  direction: 'up' | 'down' | 'flat'
  /** color the delta green even when it points down (e.g. $0 spend) */
  goodWhenDown?: boolean
  to?: string
}
export interface Reminder {
  count: string
  label: string
  tone: 'info' | 'good' | 'warn'
  to?: string
  href?: string
}
export interface RecentRecord {
  type: string
  name: string
  glyph: string
  to?: string
  href?: string
}
export interface Shortcut {
  label: string
  glyph: string
  to?: string
  href?: string
}
export interface ReportRow {
  label: string
  pct: number
  note: string
}
export interface TrendPoint {
  label: string
  value: number
  note: string
}

/* ---- employment history ------------------------------------ */
export interface Milestone {
  note: string
  type: 'Hired' | 'Promoted' | 'Note'
}
export interface RoleTitle {
  title: string
  period: string
}
export interface Position {
  id: string
  company: string
  subtitle?: string
  location: string
  start: string
  end?: string
  periodLabel: string
  titles: RoleTitle[]
  status: string
  statusTone: Tone
  summary: string
  milestones: Milestone[]
  tags: string[]
}

/* ---- projects ---------------------------------------------- */
export interface ProjectLink {
  label: string
  href: string
}
export interface Project {
  id: string
  code: string
  name: string
  category: string
  status: 'Online' | 'Prototype' | 'Active Dev' | 'Complete' | 'Archived'
  statusTone: Tone
  blurb: string
  specs: string[]
  links: ProjectLink[]
  featured?: boolean
}

/* ---- colophon (/colophon — "How This Site Was Built") --------
   The Script record that describes the stack. Kept here, not in the
   page, so the README's single-source promise holds for this copy too.
   ------------------------------------------------------------ */
export interface ColophonDeployment {
  name: string
  audience: string
  status: string
  tone: Tone
}
export interface ColophonContent {
  /** the record's Primary Information field group */
  stack: FieldGroup
  /** Notes subtab paragraphs */
  notes: string[]
  /** Files subtab rows */
  files: { file: string; role: string }[]
  /** Deployments subtab rows */
  deployments: ColophonDeployment[]
}

/* ---- the Cycle Count portlet (home dashboard easter egg) ----- */
export interface CycleCountCopy {
  /** portlet title — reads like any other Bettsuite portlet */
  title: string
  /** the count's transaction id, shown in the status line */
  countId: string
  /** item names dealt onto the bins; at least nine */
  items: string[]
  /** status-line labels per phase */
  status: { idle: string; running: string; done: string }
  /** idle copy under the grid */
  idle: string
  /** shown while the count runs */
  hint: string
  /** buttons */
  start: string
  again: string
  /** results — {reconciled} {missed} {phantom} are substituted */
  perfect: string
  done: string
  /** toast on a perfect count */
  toast: string
}

export interface ResumeContent {
  meta: { title: string; description: string }
  account: {
    product: string
    edition: string
    personName: string
    roleLabel: string
    accountName: string
    accountId: string
    environment: string
    release: string
  }
  identity: {
    name: string
    email: string
    github: string
    githubUrl: string
    location: string
    coords: string
    /** first day at Ida Milk — epoch for the live tenure counter */
    hiredISO: string
    timezone: string
  }
  nav: NavTab[]
  /** the flyout Bettsuite's star (Shortcuts) tab opens */
  shortcutsMenu: NavLink[]
  /** the flyout Bettsuite's clock (Recent Records) tab opens */
  recentMenu: NavLink[]
  dashboard: {
    greeting: string
    kpis: Kpi[]
    meter: { label: string; value: string; percent: number; min: number; max: number; target: string }
    trend: { title: string; unit: string; points: TrendPoint[] }
    reminders: Reminder[]
    recent: RecentRecord[]
    shortcuts: Shortcut[]
    report: { title: string; rows: ReportRow[] }
    tip: string
  }
  employee: {
    title: string
    status: string
    statusTone: Tone
    groups: FieldGroup[]
    bio: string[]
    skills: SkillRow[]
  }
  positions: Position[]
  projects: Project[]
  contact: {
    intro: string
    email: string
    phone: string
    web: string
    github: string
    githubUrl: string
    /** e.g. "Open to relocation" — shown under Location on the contact page */
    availability: string
    subjects: string[]
    footer: string
    privacyNotice: string
  }
  colophon: ColophonContent
  eggs: {
    consoleBanner: string[]
    consoleHint: string
    toast: string
    /** the Cycle Count portlet — a whack-a-mole in a portlet's clothing */
    cycleCount: CycleCountCopy
  }
}

export const resume: ResumeContent = {
  meta: {
    title: 'Riley Betts — Home | Bettsuite',
    description:
      'Riley Betts — NetSuite / IT Manager in FDA-regulated manufacturing. Five years on NetSuite, admin to developer, two failed go-lives fixed. A résumé built as a working mock Bettsuite ERP account.',
  },

  /* The mock account is RILEY'S OWN — a personal "Personnel Account",
     never the employer's system. Employers appear only as facts in the
     employment history, the way any résumé lists them. */
  account: {
    product: 'Bettsuite',
    edition: 'Personnel Account',
    personName: 'Riley Betts',
    roleLabel: 'Administrator',
    accountName: 'Riley Betts',
    accountId: 'ACCT 42537',
    environment: 'Production',
    release: '2026.2',
  },

  identity: {
    name: 'Riley Betts',
    email: 'Riley.Betts@outlook.com',
    github: 'Riley-D-Betts',
    githubUrl: 'https://github.com/Riley-D-Betts',
    location: 'Twin Falls, Idaho',
    coords: '42.56°N, -114.46°W',
    hiredISO: '2024-11-18',
    timezone: 'America/Boise',
  },

  /* Bettsuite's real Administrator menu bar, in Bettsuite's real order.
     The three icon tabs (clock / star / house) come first, exactly as
     Bettsuite pins them. Menus are single-column; every menu opens with
     "<Tab> Overview" and a separator. The structure is genuine
     Bettsuite; the rows underneath are this résumé's records. */
  nav: [
    { id: 'recent', label: 'Recent Records', icon: 'recent' },
    { id: 'shortcuts', label: 'Shortcuts', icon: 'shortcuts' },
    { id: 'home', label: 'Home', icon: 'home', to: '/' },
    {
      id: 'activities',
      label: 'Activities',
      items: [
        {
          label: 'Scheduling',
          children: [
            { label: 'Employment History', to: '/positions' },
            { label: 'Milestones', to: '/positions/ida-milk' },
            { label: 'Audit Prep', to: '/positions/ida-milk' },
          ],
        },
        { label: 'Go-Live Remediations', to: '/projects' },
        { label: 'Search', children: [{ label: 'All Positions', to: '/positions' }] },
      ],
    },
    {
      id: 'transactions',
      label: 'Transactions',
      items: [
        {
          label: 'Employees',
          children: [
            { label: 'Enter Induction', to: '/positions/ida-milk' },
            { label: 'Enter Promotion', to: '/positions/ida-milk' },
            { label: 'Approve Deployments', to: '/projects' },
          ],
        },
        {
          label: 'Manufacturing',
          children: [
            { label: 'Enter Work Orders', to: '/projects/sunapps-mes' },
            { label: 'Enter Completions', to: '/projects/sunapps-mes' },
            { label: 'Cycle Counts', to: '/projects/suntado-netsuite-remediation' },
          ],
        },
        { label: 'Inventory', children: [{ label: 'Adjust Inventory (Phantom: Billions → 0)', to: '/projects/suntado-netsuite-remediation' }] },
      ],
    },
    {
      id: 'lists',
      label: 'Lists',
      items: [
        {
          label: 'Employees',
          children: [
            { label: 'Employees', to: '/employee' },
            { label: 'NetSuite Skills', to: '/employee' },
          ],
        },
        {
          label: 'Relationships',
          children: [{ label: 'Positions', to: '/positions' }],
        },
        {
          label: 'Accounting',
          children: [
            { label: 'Items', to: '/projects/suntado-netsuite-remediation' },
            { label: 'Bills of Materials', to: '/projects/suntado-netsuite-remediation' },
          ],
        },
        {
          label: 'Supply Chain',
          children: [
            { label: 'Projects', to: '/projects' },
            { label: 'Work Orders', to: '/projects/sunapps-mes' },
          ],
        },
        { label: 'Search', children: [{ label: 'Saved Searches', to: '/projects' }] },
      ],
    },
    {
      id: 'reports',
      label: 'Reports',
      items: [
        { label: 'New Search', to: '/projects' },
        { label: 'Saved Searches', to: '/positions' },
        {
          label: 'Employees/HR',
          children: [
            { label: 'KPI Scorecard', to: '/' },
            { label: 'NetSuite Coverage', to: '/employee' },
            { label: 'Career Trajectory', to: '/positions' },
          ],
        },
        {
          label: 'Custom Reports',
          children: [
            { label: 'Phantom Inventory by Period', to: '/projects/suntado-netsuite-remediation' },
            { label: 'Audit Findings (0)', to: '/positions/ida-milk' },
          ],
        },
      ],
    },
    {
      id: 'analytics',
      label: 'Analytics',
      items: [
        { label: 'Saved Searches', to: '/projects' },
        { label: 'SuiteQL Query Tool', to: '/positions/ida-milk' },
        { label: 'Datasets', to: '/positions' },
        { label: 'Workbooks', to: '/' },
      ],
    },
    {
      id: 'documents',
      label: 'Documents',
      items: [
        { label: 'Files', children: [{ label: 'File Cabinet', to: '/colophon' }] },
        { label: 'Templates', to: '/colophon' },
      ],
    },
    {
      id: 'setup',
      label: 'Setup',
      items: [
        {
          label: 'Company',
          children: [{ label: 'Company Information', to: '/employee' }],
        },
        { label: 'Users/Roles', children: [{ label: 'Manage Roles', to: '/employee' }] },
        {
          label: 'Integration',
          children: [
            { label: 'SuiteTalk REST', to: '/projects/sunapps-mes' },
            { label: 'Boomi', to: '/projects/suntado-netsuite-remediation' },
          ],
        },
        { label: 'Import/Export', children: [{ label: 'Import CSV Records', to: '/projects/suntado-netsuite-remediation' }] },
      ],
    },
    {
      id: 'customization',
      label: 'Customization',
      items: [
        {
          label: 'Scripting',
          children: [
            { label: 'Scripts', to: '/colophon' },
            { label: 'Script Deployments', to: '/colophon' },
          ],
        },
        { label: 'Workflow', children: [{ label: 'Workflows', to: '/positions/ida-milk' }] },
        { label: 'Centers and Tabs', children: [{ label: 'Role Center Layout', to: '/' }] },
      ],
    },
    {
      id: 'support',
      label: 'Support',
      items: [
        { label: 'New Message', to: '/contact' },
        { label: 'Email Riley.Betts@outlook.com', href: 'mailto:Riley.Betts@outlook.com' },
        { label: 'GitHub', href: 'https://github.com/Riley-D-Betts' },
      ],
    },
  ],

  shortcutsMenu: [
    { label: 'New Message', to: '/contact' },
    { label: 'Employee Record', to: '/employee' },
    { label: 'Employment History', to: '/positions' },
    { label: 'Projects', to: '/projects' },
    { label: 'GitHub', href: 'https://github.com/Riley-D-Betts' },
  ],

  recentMenu: [
    { label: 'Riley Betts (Employee)', to: '/employee' },
    { label: 'Suntado LLC (Position)', to: '/positions/ida-milk' },
    { label: 'NetSuite Remediation — Suntado (Project)', to: '/projects/suntado-netsuite-remediation' },
    { label: 'SunApps MES (Project)', to: '/projects/sunapps-mes' },
    { label: 'How This Site Was Built (Script)', to: '/colophon' },
  ],

  dashboard: {
    greeting: 'Welcome, Riley',
    kpis: [
      {
        label: 'Years on NetSuite',
        value: '5 yrs',
        period: 'Since 2021',
        compare: 'admin → developer',
        delta: '+1 yr',
        direction: 'up',
        to: '/positions',
      },
      {
        label: 'Years in IT & Systems',
        value: '9 yrs',
        period: 'Since 2017',
        compare: 'EHR → MSP → ERP',
        delta: '+1 yr',
        direction: 'up',
        to: '/positions',
      },
      {
        label: 'Failed NetSuite Go-Lives Fixed',
        value: '2',
        period: 'All Time',
        compare: 'one solar, one dairy',
        delta: '+2',
        direction: 'up',
        to: '/projects',
      },
      {
        label: 'Audit Findings on My Systems',
        value: '0',
        period: 'All Time',
        compare: 'FDA / FSMA',
        delta: '0',
        direction: 'flat',
        goodWhenDown: true,
        to: '/positions/ida-milk',
      },
      {
        label: 'Phantom Inventory Units',
        value: '0',
        period: 'Post-Remediation',
        compare: 'the system had been reporting billions',
        delta: 'billions',
        direction: 'down',
        goodWhenDown: true,
        to: '/projects/suntado-netsuite-remediation',
      },
      {
        label: 'Team Led',
        value: '3',
        period: 'Current',
        compare: 'IT + two JavaScript developers',
        delta: '+2',
        direction: 'up',
        to: '/positions/ida-milk',
      },
    ],
    meter: {
      label: 'Failed Go-Lives Rescued',
      value: '2 of 2',
      percent: 2,
      min: 0,
      max: 2,
      target: 'Every one that landed on my desk',
    },
    trend: {
      title: 'NetSuite Trajectory',
      unit: 'tier',
      points: [
        { label: '2018', value: 1, note: 'Medical Systems Administrator — EHR, network and secure comms at Betts Psychiatric' },
        { label: '2021', value: 2, note: 'Business Systems Administrator — first NetSuite account, plus 16 other systems (Big Dog Solar)' },
        { label: '2022', value: 3, note: 'Led the remediation of a failed NetSuite go-live — project-based, complex revenue recognition' },
        { label: '2023', value: 4, note: 'MSP Systems Administrator — data migration, integrations and implementations across Southern Idaho' },
        { label: '2024', value: 5, note: 'NetSuite Administrator — remediating a failed deployment in an FDA-regulated dairy plant (Suntado)' },
        { label: '2025', value: 6, note: 'NetSuite / IT Manager — player-coach for a three-person IT and dev team' },
        { label: '2026', value: 7, note: 'Building a mobile-first plant-floor app on the NetSuite REST API to replace RF-SMART' },
      ],
    },
    reminders: [
      { count: '2', label: 'Failed NetSuite go-lives remediated — one solar, one dairy', tone: 'good', to: '/projects' },
      {
        count: '204',
        label: 'FSMA 204 traceability design and audit prep in an aseptic dairy plant — I know what an FDA investigator asks for',
        tone: 'warn',
        to: '/positions/ida-milk',
      },
      {
        count: '1',
        label: 'Custom NetSuite integration tying plant-floor data to the ERP — scoped, built, and supported after',
        tone: 'info',
        to: '/projects/sunapps-mes',
      },
      {
        count: '3',
        label: 'Person IT and dev team led — comfortable as the whole department or as one voice in a larger one',
        tone: 'info',
        to: '/positions/ida-milk',
      },
      { count: '5', label: 'Positions in employment history', tone: 'info', to: '/positions' },
      { count: '1', label: 'Channel open — NetSuite roles and consulting inquiries welcome', tone: 'warn', to: '/contact' },
    ],
    recent: [
      { type: 'Employee', name: 'Riley Betts', glyph: '👤', to: '/employee' },
      { type: 'Position', name: 'NetSuite / IT Manager — Suntado LLC', glyph: '💼', to: '/positions/ida-milk' },
      { type: 'Project', name: 'NetSuite Remediation — Suntado', glyph: '📦', to: '/projects/suntado-netsuite-remediation' },
      { type: 'Project', name: 'SunApps MES', glyph: '📦', to: '/projects/sunapps-mes' },
      { type: 'Report', name: 'KPI Scorecard', glyph: '📊', to: '/' },
    ],
    shortcuts: [
      { label: 'New Message', glyph: '✉', to: '/contact' },
      { label: 'Employee Record', glyph: '👤', to: '/employee' },
      { label: 'NetSuite Skills', glyph: '🧰', to: '/employee' },
      { label: 'Employment History', glyph: '🗂', to: '/positions' },
      { label: 'Projects', glyph: '📦', to: '/projects' },
      { label: 'GitHub', glyph: '↗', href: 'https://github.com/Riley-D-Betts' },
    ],
    report: {
      title: 'NetSuite Coverage by Area',
      rows: [
        { label: 'Inventory & Manufacturing', pct: 99, note: 'Work orders, assemblies, multistage, lot/serial, cycle counts' },
        { label: 'Financials & Revenue', pct: 92, note: 'GL, AP, AR, revenue recognition, record-to-report' },
        { label: 'SuiteCloud Development', pct: 90, note: 'SuiteScript, SuiteFlow, SuiteQL, saved searches' },
        { label: 'Integration', pct: 90, note: 'SuiteTalk REST, Boomi, CSV imports' },
        { label: 'Compliance', pct: 95, note: 'FDA-regulated computer systems, FSMA 204 traceability' },
      ],
    },
    tip: 'This account is a résumé. Every portlet, record and list is real information about Riley Betts, arranged the way Bettsuite would arrange it.',
  },

  employee: {
    title: 'NetSuite / IT Manager',
    status: 'Active — Full Time',
    statusTone: 'green',
    groups: [
      {
        title: 'Primary Information',
        fields: [
          { label: 'Name', value: 'Riley Betts' },
          { label: 'Employee ID', value: 'EMP-1042', mono: true },
          { label: 'Job Title', value: 'NetSuite / IT Manager' },
          { label: 'Class', value: 'NetSuite / ERP / Manufacturing Systems' },
          { label: 'Employer', value: 'Suntado LLC (Ida Milk)', help: 'FDA-regulated dairy · Burley, Idaho' },
          { label: 'Location', value: 'Twin Falls, Idaho', help: 'Open to relocation' },
          { label: 'Hire Date', value: '11/18/2024', help: 'Inducted as NetSuite Administrator' },
          { label: 'Status', value: 'Active — Full Time', tone: 'green' },
        ],
      },
      {
        title: 'Communication',
        fields: [
          { label: 'Email', value: 'Riley.Betts@outlook.com', href: 'mailto:Riley.Betts@outlook.com' },
          { label: 'Phone', value: '541-852-5410', href: 'tel:+15418525410' },
          { label: 'Web', value: 'rileybetts.xyz', href: 'https://rileybetts.xyz' },
          { label: 'GitHub', value: '@Riley-D-Betts', href: 'https://github.com/Riley-D-Betts' },
          { label: 'Coordinates', value: '42.56°N, -114.46°W', mono: true },
        ],
      },
      {
        title: 'Access & Roles',
        fields: [
          { label: 'NetSuite', value: 'Administrator', tone: 'blue', help: 'Roles and permissions, cost rollups, revaluation, the license renewal' },
          { label: 'SuiteCloud', value: 'Developer', tone: 'blue', help: 'SuiteScript, SuiteFlow, SuiteQL, SuiteTalk REST' },
          { label: 'Integration', value: 'Boomi · REST · CSV', tone: 'blue' },
          { label: 'Network', value: 'Root', tone: 'blue' },
          { label: 'Compliance', value: 'FDA / FSMA 204', tone: 'green', help: 'Zero audit findings on my systems' },
          { label: 'Reports To', value: 'Three-person IT and dev team', help: 'Player-coach: two developers plus the IT Manager duties' },
        ],
      },
    ],
    bio: [
      'In plain English: I keep a food plant’s software, network, and compliance systems running, and I build what ties them together.',
      'Solving complex problems in creative ways is what gets me out of bed. I live for the opportunity to solve problems others could not. I have found the right tool for the job is usually the one you build yourself.',
      'Twice now that problem has been a NetSuite implementation that didn’t take: once in a project/task-based solar business with complex revenue recognition rules, once in an FDA-regulated dairy plant whose system was reporting billions of units of phantom inventory. Both times I led the remediation, wrote the procedures, and trained the people who use it.',
    ],
    skills: [
      {
        category: 'NetSuite Modules',
        proficiency: 'Expert',
        years: '5 yrs',
        skills: [
          'Financials (GL, AP, AR)',
          'Revenue Recognition',
          'Inventory',
          'Sales & Purchase Orders',
          'Work Orders & Assemblies',
          'Multistage Manufacturing',
          'Lot / Serial',
          'Cycle Counts',
          'CRM',
        ],
      },
      {
        category: 'Process Areas',
        proficiency: 'Expert',
        years: '5 yrs',
        skills: ['Procure-to-Pay', 'Order-to-Cash', 'Record-to-Report'],
      },
      {
        category: 'Building in It',
        proficiency: 'Advanced',
        years: '5 yrs',
        skills: ['SuiteScript', 'SuiteFlow', 'SuiteQL', 'Saved Searches', 'SuiteTalk REST', 'Boomi', 'CSV Imports'],
      },
      {
        category: 'Industries',
        proficiency: 'Hands-on',
        years: '9 yrs',
        skills: ['Food & Beverage Manufacturing (FDA)', 'Solar / Construction', 'Managed Services'],
      },
      {
        category: 'Training',
        proficiency: 'Completed',
        years: '—',
        skills: ['FDA-Regulated Computer Systems'],
      },
      {
        category: 'IT & Infrastructure',
        proficiency: 'Advanced',
        years: '9 yrs',
        skills: ['Windows Server', 'Hypervisors', 'Networking', 'PowerShell', 'EHR Systems', 'End-User Support'],
      },
    ],
  },

  positions: [
    {
      id: 'ida-milk',
      company: 'Suntado LLC',
      subtitle: 'Ida Milk, LLC · FDA-regulated dairy',
      location: 'Burley, Idaho',
      start: '2024-11-18',
      periodLabel: 'Nov 2024 — Present',
      titles: [
        { title: 'NetSuite Administrator', period: 'Nov 2024 — Nov 2025' },
        { title: 'NetSuite / IT Manager', period: 'Nov 2025 — Present (promotion)' },
      ],
      status: 'Current',
      statusTone: 'green',
      summary:
        'Hired to remediate a failed NetSuite deployment in an active FDA-regulated dairy plant, then promoted to run NetSuite and IT for the site. Still the NetSuite admin — now also a player-coach for two developers building plant-floor software on the NetSuite REST API.',
      milestones: [
        { note: 'Inducted as NetSuite Administrator', type: 'Hired' },
        {
          note: 'Led the remediation of a failed NetSuite deployment in an active FDA-regulated environment, across Warehouse, Multistage Manufacturing, Quality Control, and Procurement',
          type: 'Note',
        },
        {
          note: 'Redid the items, BOMs, costing, and inventory valuation; got work orders to consume components correctly; then rebuilt cycle counts and lot traceability until the numbers could be trusted again — the system had been reporting billions of units of phantom inventory',
          type: 'Note',
        },
        { note: 'Wrote the procedures and trained the people who use it', type: 'Note' },
        { note: 'Recruited a team of JavaScript developers to overhaul Manufacturing & Logistics', type: 'Note' },
        { note: 'SuiteScript, SuiteFlow, Boomi, saved searches — whatever the problem called for', type: 'Note' },
        { note: 'FSMA 204 traceability design and audit prep in an aseptic dairy plant — zero audit findings on my systems', type: 'Note' },
        { note: 'Promoted to NetSuite / IT Manager', type: 'Promoted' },
        {
          note: 'Lead a team building a locally hosted, mobile-first web app for plant operations on the NetSuite REST API — work orders, issues, and completions — to replace RF-SMART',
          type: 'Note',
        },
        { note: 'Player-coach position: two developers, plus the IT Manager duties for the site', type: 'Note' },
        {
          note: 'Still the NetSuite admin: roles and permissions, cost rollups and inventory revaluation, the reports Finance asks for (SuiteQL when a saved search won’t do it), and the license renewal',
          type: 'Note',
        },
      ],
      tags: ['NetSuite', 'SuiteScript', 'SuiteFlow', 'SuiteQL', 'SuiteTalk REST', 'Boomi', 'Manufacturing', 'FDA / FSMA 204', 'Leadership'],
    },
    {
      id: 'rymer',
      company: 'Rymer Technologies',
      subtitle: 'Managed services',
      location: 'Idaho Falls, Idaho',
      start: '2023-11-01',
      end: '2024-09-01',
      periodLabel: '2023 — 2024',
      titles: [{ title: 'Systems Administrator', period: 'Many clients, one sysadmin' }],
      status: 'Closed',
      statusTone: 'gray',
      summary:
        'Data migration, integrations, and systems implementation for small-business clients across Southern Idaho — plus the desktop, server, hypervisor, IT admin and end-user support that comes with managed services.',
      milestones: [
        { note: 'Data migration, integrations, and systems implementation for small-business clients across Southern Idaho', type: 'Note' },
        { note: 'Desktop, server, hypervisor, IT admin and end-user support', type: 'Note' },
      ],
      tags: ['MSP', 'Data Migration', 'Integrations', 'Systems Implementation', 'Windows Server', 'Hypervisors'],
    },
    {
      id: 'big-dog-solar',
      company: 'Big Dog Solar Energy',
      subtitle: 'Residential & commercial solar',
      location: 'Pocatello, Idaho',
      start: '2021-07-01',
      end: '2023-11-01',
      periodLabel: '2021 — 2023',
      titles: [{ title: 'Business Systems Administrator', period: '2021 — 2023' }],
      status: 'Closed',
      statusTone: 'gray',
      summary:
        'First NetSuite account. Ran NetSuite for a project/task-based solar construction business, and led the remediation of an implementation that had not taken.',
      milestones: [
        { note: 'Business Systems Administrator — first NetSuite account', type: 'Hired' },
        {
          note: 'Led the remediation of a failed NetSuite implementation in a construction, project/task-based environment with complex revenue recognition rules',
          type: 'Note',
        },
        { note: 'Ran NetSuite Financials, CRM, and Inventory, plus 16 other business systems and the integrations between them', type: 'Note' },
      ],
      tags: ['NetSuite', 'Financials', 'Revenue Recognition', 'CRM', 'Inventory', 'Integrations', 'Solar / Construction'],
    },
    {
      id: 'betts-psychiatric',
      company: 'Betts Psychiatric',
      subtitle: 'Healthcare',
      location: 'Eugene, Oregon',
      start: '2018-01-01',
      end: '2021-06-30',
      periodLabel: '2018 — 2021',
      titles: [{ title: 'Medical Systems Administrator', period: '2018 — 2021' }],
      status: 'Closed',
      statusTone: 'gray',
      summary:
        'Managed and maintained electronic health records systems, network infrastructure, and secure communication systems for a psychiatric practice.',
      milestones: [
        { note: 'Medical Systems Administrator', type: 'Hired' },
        { note: 'Managed and maintained electronic health records systems, network infrastructure, and secure communication systems', type: 'Note' },
      ],
      tags: ['EHR', 'Healthcare IT', 'Network Infrastructure', 'Secure Communications'],
    },
  ],

  projects: [
    {
      id: 'suntado-netsuite-remediation',
      code: 'PRJ-01',
      name: 'NetSuite Remediation — Suntado',
      category: 'NetSuite Go-Live Rescue',
      status: 'Complete',
      statusTone: 'green',
      blurb:
        'A failed NetSuite deployment in an active FDA-regulated dairy plant, across Warehouse, Multistage Manufacturing, Quality Control, and Procurement. In practice that meant redoing the items, BOMs, costing, and inventory valuation, getting work orders to consume components correctly, then rebuilding cycle counts and lot traceability until the numbers could be trusted again — the system had been reporting billions of units of phantom inventory. Wrote the procedures and trained the people who use it.',
      specs: [
        'Warehouse',
        'Multistage Manufacturing',
        'Quality Control',
        'Procurement',
        'Items & BOMs',
        'Costing & Inventory Valuation',
        'Work Orders & Component Consumption',
        'Cycle Counts',
        'Lot Traceability (FSMA 204)',
        'SuiteScript · SuiteFlow · Boomi · Saved Searches',
      ],
      links: [],
      featured: true,
    },
    {
      id: 'sunapps-mes',
      code: 'PRJ-02',
      name: 'SunApps MES',
      category: 'NetSuite REST · Plant Floor',
      status: 'Active Dev',
      statusTone: 'green',
      blurb:
        'A locally hosted, mobile-first web app for plant operations, built on the NetSuite REST API to replace RF-SMART: work orders, issues, and completions from the floor straight into the ERP. Led as player-coach with two developers, next to a real production line.',
      specs: ['NetSuite REST API', 'Work Orders', 'Issues & Completions', 'Mobile-First', 'Locally Hosted', 'Replaces RF-SMART'],
      links: [{ label: 'GitHub', href: 'https://github.com/Riley-D-Betts/SunApps_MES' }],
      featured: true,
    },
    {
      id: 'big-dog-netsuite-remediation',
      code: 'PRJ-03',
      name: 'NetSuite Remediation — Big Dog Solar',
      category: 'NetSuite Go-Live Rescue',
      status: 'Complete',
      statusTone: 'green',
      blurb:
        'A failed NetSuite implementation in a construction, project/task-based environment with complex revenue recognition rules. Led the remediation, then ran NetSuite Financials, CRM, and Inventory alongside 16 other business systems and the integrations between them.',
      specs: ['Financials (GL, AP, AR)', 'Revenue Recognition', 'Projects / Tasks', 'CRM', 'Inventory', '16 Integrated Business Systems'],
      links: [],
    },
    {
      id: 'riley-bettsuite',
      code: 'PRJ-04',
      name: 'Riley Bettsuite',
      category: 'NetSuite Clone (This Site)',
      status: 'Online',
      statusTone: 'green',
      blurb:
        'A NetSuite clone serving as my résumé — you are looking at it. The Role Center, Employee record, Employment History and Project records are hand-rolled against NetSuite’s own design tokens, on Nuxt and Cloudflare Workers, with first-party analytics and session replay underneath. Customization > Scripting has the build notes.',
      specs: ['Nuxt 4 · Vue 3 · SSR', 'TypeScript (strict)', 'Cloudflare Workers', 'D1 + R2', 'First-Party Analytics', 'Session Replay'],
      links: [{ label: 'Live Site', href: 'https://rileybetts.xyz' }],
    },
    {
      id: 'betts-board',
      code: 'PRJ-05',
      name: 'Betts Board',
      category: 'Household Ops Platform',
      status: 'Online',
      statusTone: 'green',
      blurb:
        'An open source, self-hosted family organizational application, similar to Skylight, but with a bank feed integration. Family calendar with real recurrence rules, chores with a rewards store the kids actually check, recipes that turn into meal plans and aisle-sorted shopping lists, a barcode-scanned pantry, and a photo frame for the kitchen tablet. One Docker container, a documented REST API, and Home Assistant can join the family.',
      specs: ['Nuxt 4', 'SQLite + Drizzle', 'Bank Feed Integration', 'PWA', 'Web Push', 'REST + OpenAPI', 'Home Assistant'],
      links: [{ label: 'GitHub', href: 'https://github.com/Riley-D-Betts/betts-board' }],
    },
    {
      id: 'kidcam',
      code: 'PRJ-06',
      name: 'KidCam',
      category: 'Hardware / Firmware',
      status: 'Prototype',
      statusTone: 'amber',
      blurb:
        'A real digital camera for a three-year-old. Two buttons, no menus, no cloud. ESP32-S3 with a proper viewfinder, photos to SD, and a hold-both-buttons Wi-Fi mode so a parent can pull the shots from a browser. Deep sleep so the battery survives a toddler’s attention span.',
      specs: ['ESP32-S3 Sense', 'OV2640 Cam', 'ST7789 TFT', 'SD Storage', 'Soft-AP Photo Server', 'Deep Sleep'],
      links: [],
    },
    {
      id: 'quilt',
      code: 'PRJ-07',
      name: 'Quilt',
      category: 'Design Studio (Web)',
      status: 'Online',
      statusTone: 'green',
      blurb:
        'A quilt-design studio. Paint the pattern cell by cell, name your fabrics, and it does the math that matters at the cutting table: piece counts, seam allowance, and yardage off a 42″ bolt rounded to the next eighth. Small pieces, carefully stitched.',
      specs: ['React 19', 'Cloudflare Workers', 'Hono', 'D1 SQLite', 'Fabric Math', 'PWA'],
      links: [
        { label: 'Live App', href: 'https://quilt.rileybetts.xyz' },
        { label: 'GitHub', href: 'https://github.com/Riley-D-Betts/Quilt' },
      ],
    },
    {
      id: 'little-artists',
      code: 'PRJ-08',
      name: 'Little Artists',
      category: 'Kids’ Creative App',
      status: 'Online',
      statusTone: 'green',
      blurb:
        'A drawing studio for artists aged two to eight, with no logins and no ads. Kids tap their animal to sign in, then get crayons, sparkles, stamps, and a flood-fill bucket that respects the lines. Any photo can become a coloring page. Every masterpiece lands on the family server, where the delete button hides behind a multiplication problem.',
      specs: ['Nuxt 4', 'Canvas', 'Flood Fill', 'Photo → Line Art', 'Self-Hosted'],
      links: [{ label: 'GitHub', href: 'https://github.com/Riley-D-Betts/draw' }],
    },
  ],

  contact: {
    intro:
      'Open a channel — NetSuite roles, consulting engagements, and go-lives that didn’t take are all welcome. This form composes an email: nothing is sent until your mail client opens, and nothing is stored on the way.',
    email: 'Riley.Betts@outlook.com',
    phone: '541-852-5410',
    web: 'https://rileybetts.xyz',
    github: '@Riley-D-Betts',
    githubUrl: 'https://github.com/Riley-D-Betts',
    availability: 'Open to opportunities · Open to relocation',
    subjects: [
      'NetSuite role / hiring inquiry',
      'NetSuite consulting / contract',
      'A go-live that isn’t taking',
      'Just saying hello',
    ],
    footer: '© 2026 Riley Betts · Built with Nuxt · A résumé wearing a Bettsuite costume · No templates harmed',
    privacyNotice:
      'This site runs first-party analytics, including session replay, stored in my own Cloudflare account. A link I send you may carry a short code identifying who I sent it to, and opening that link is recorded. No third-party trackers. Add ?optout=1 to any URL to opt out.',
  },

  colophon: {
    stack: {
      title: 'Primary Information',
      fields: [
        { label: 'Script Type', value: 'Suitelet (allegedly)' },
        { label: 'Framework', value: 'Nuxt 4 · Vue 3 · SSR' },
        { label: 'Language', value: 'TypeScript (strict)' },
        { label: 'Runtime', value: 'Cloudflare Workers · Nitro' },
        { label: 'Data Store', value: 'D1 (SQLite at the edge) + R2' },
        { label: 'Deployment', value: 'Cloudflare Workers · wrangler · free tier' },
        { label: 'Owner', value: 'Riley Betts', href: '/employee' },
        { label: 'Status', value: 'Released', tone: 'green' },
      ],
    },
    notes: [
      'Every visible word comes from one typed file — app/data/resume.ts. Components render from it and nothing hardcodes copy, so the résumé is edited in one place.',
      'The Bettsuite costume is a hand-written stylesheet scoped under a single body class. Behind a password at /ops sits a completely different dark console — first-party analytics with session replay, no third-party trackers. Events land in D1, replay chunks in R2, and a daily cron prunes whatever has aged out — all of it inside my own Cloudflare account.',
      'No UI kit, no component library, no template. The masthead, the menu bar, the field groups and the subtabs are all hand-rolled CSS, built against Bettsuite’s own published design tokens rather than from memory. Any resemblance to an ERP you administer daily is entirely the point.',
    ],
    files: [
      { file: 'app/data/resume.ts', role: 'Content model — the single source of truth' },
      { file: 'app/assets/css/bettsuite.css', role: 'The costume — tokens, chrome, records, lists' },
      { file: 'app/components/ns/*.vue', role: 'Masthead, menu bar, portlets, subtabs, tables' },
      { file: 'app/pages/**', role: 'Dashboard, records, lists, this page' },
      { file: 'server/**', role: 'Analytics intake, /ops API, D1/R2 access' },
      { file: 'wrangler.jsonc', role: 'Workers config — D1, R2 and cron bindings' },
    ],
    deployments: [
      { name: '/ — Role Center', audience: 'All Roles', status: 'Released', tone: 'green' },
      { name: '/ops — Analytics Console', audience: 'Administrator', status: 'Password Gated', tone: 'amber' },
    ],
  },

  eggs: {
    consoleBanner: [
      '  ____  _____ _____ _____ ____',
      ' | __ )| ____|_   _|_   _/ ___|',
      ' |  _ \\|  _|   | |   | | \\___ \\',
      ' | |_) | |___  | |   | |  ___) |',
      ' |____/|_____| |_|   |_| |____/',
      '',
      '⚠ Authorized personnel only.',
      'signed, the God King of Bettsuite',
    ],
    consoleHint: 'type ns.help() for the maintenance interface.',
    toast: 'Role Center refreshed. Nice reflexes.',
    cycleCount: {
      title: 'Cycle Count',
      countId: 'CC-2024-11',
      items: [
        'UHT Milk 1L',
        'Aseptic Carton',
        'Cap, 38mm',
        'Whey Isolate',
        'Oat Base',
        'Chocolate Syrup',
        'Shrink Film',
        'Label Roll',
        'Case Tray 12ct',
        'Strawberry Puree',
        'Straw, Paper',
        'Pallet, GMA',
      ],
      status: { idle: 'Ready', running: 'In Progress', done: 'Complete' },
      idle: 'The last count found billions of units that were not there. Bins will start reporting phantom quantities — count each one before the auditor gets to it. Click a bin or press Start.',
      hint: 'Click (or press 1–9 on) any bin showing a variance.',
      start: 'Start Count',
      again: 'Count Again',
      perfect: 'Zero variance: {reconciled} bins reconciled, none missed. The auditor has nothing to write down.',
      done: '{reconciled} bins reconciled, {missed} missed. {phantom} phantom units written off — the numbers still cannot be trusted.',
      toast: 'Count complete — zero variance. Finance would like a word (a nice one).',
    },
  },
}
