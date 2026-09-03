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
  status: 'Online' | 'Prototype' | 'Active Dev' | 'Archived'
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
    github: string
    githubUrl: string
    subjects: string[]
    footer: string
    privacyNotice: string
  }
  colophon: ColophonContent
  eggs: {
    consoleBanner: string[]
    consoleHint: string
    toast: string
  }
}

export const resume: ResumeContent = {
  meta: {
    title: 'Riley Betts — Home | Bettsuite',
    description:
      'Riley Betts — IT Manager at Ida Milk, LLC (Suntado). A résumé built as a working mock Bettsuite ERP account.',
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
    email: 'rbetts@idamilk.com',
    github: 'Riley-D-Betts',
    githubUrl: 'https://github.com/Riley-D-Betts',
    location: 'Burley, Idaho',
    coords: '42.53°N, -113.79°W',
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
            { label: 'Standing Meetings', to: '/positions/ida-milk' },
          ],
        },
        { label: 'On-Call / Help Desk', to: '/positions/ida-milk' },
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
            { label: 'Enter Promotion', to: '/positions/big-dog-solar' },
            { label: 'Approve Deployments', to: '/projects' },
          ],
        },
        { label: 'Management', children: [{ label: 'Capital Requests ($0 Filed)', to: '/positions/ida-milk' }] },
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
            { label: 'Skills & Proficiency', to: '/employee' },
          ],
        },
        {
          label: 'Relationships',
          children: [{ label: 'Positions', to: '/positions' }],
        },
        {
          label: 'Supply Chain',
          children: [
            { label: 'Projects', to: '/projects' },
            { label: 'Items', to: '/projects/kidcam' },
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
            { label: 'Skills Coverage', to: '/employee' },
            { label: 'Career Trajectory', to: '/positions' },
          ],
        },
        { label: 'Custom Reports', children: [{ label: 'Uptime by Period', to: '/positions/ida-milk' }] },
      ],
    },
    {
      id: 'analytics',
      label: 'Analytics',
      items: [
        { label: 'Saved Searches', to: '/projects' },
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
        { label: 'Centers and Tabs', children: [{ label: 'Role Center Layout', to: '/' }] },
      ],
    },
    {
      id: 'support',
      label: 'Support',
      items: [
        { label: 'New Message', to: '/contact' },
        { label: 'Email rbetts@idamilk.com', href: 'mailto:rbetts@idamilk.com' },
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
    { label: 'SunApps MES (Project)', to: '/projects/sunapps-mes' },
    { label: 'Ida Milk, LLC (Position)', to: '/positions/ida-milk' },
    { label: 'KidCam (Project)', to: '/projects/kidcam' },
    { label: 'How This Site Was Built (Script)', to: '/colophon' },
  ],

  dashboard: {
    greeting: 'Welcome, Riley',
    kpis: [
      {
        label: 'Network Uptime',
        value: '99.9%+',
        period: 'Tenure to Date',
        compare: 'held across plant operations',
        delta: 'held',
        direction: 'flat',
        to: '/positions/ida-milk',
      },
      {
        label: 'Cost of Training / Doc Control / B2B Stacks',
        value: '$0',
        period: 'All Time',
        compare: 'built in-house, not bought',
        delta: '$0',
        direction: 'flat',
        goodWhenDown: true,
        to: '/positions/ida-milk',
      },
      {
        label: 'Department Headcount',
        value: '1 → Team',
        period: 'Since Induction',
        compare: 'built from a solo op',
        delta: '+Team',
        direction: 'up',
        to: '/positions/ida-milk',
      },
      {
        label: 'Systems Deployed',
        value: '12+',
        period: 'Trailing 12 Mo.',
        compare: 'dashboards · help desk · AI cams',
        delta: '+12',
        direction: 'up',
        to: '/projects',
      },
      {
        label: 'Side Projects Online',
        value: '5',
        period: 'Current',
        compare: 'hardware to household ops',
        delta: '+5',
        direction: 'up',
        to: '/projects',
      },
      {
        label: 'Tenure in Systems',
        value: '7 yrs',
        period: 'Since 2019',
        compare: 'phones → server room → ERP',
        delta: '+1 yr',
        direction: 'up',
        to: '/positions',
      },
    ],
    meter: {
      label: 'Network Uptime',
      value: '99.98%',
      percent: 99.98,
      min: 99,
      max: 100,
      target: 'Held above 99.9%',
    },
    trend: {
      title: 'Scope of Responsibility',
      unit: 'tier',
      points: [
        { label: '2021', value: 1, note: 'Solar appointment setter — the phones' },
        { label: '2022', value: 2, note: 'Permit / system designer — the drafting table' },
        { label: '2022', value: 3, note: 'Business systems administrator — the server room' },
        { label: '2023', value: 4, note: 'MSP systems administrator — many networks' },
        { label: '2024', value: 5, note: 'Systems Analyst — intro to manufacturing' },
        { label: '2025', value: 6, note: 'IT Supervisor — solo operation' },
        { label: '2026', value: 7, note: 'IT Manager — founded the department' },
      ],
    },
    reminders: [
      { count: '1', label: 'Employee record to review', tone: 'info', to: '/employee' },
      { count: '3', label: 'Positions in employment history', tone: 'info', to: '/positions' },
      { count: '5', label: 'Projects online', tone: 'good', to: '/projects' },
      { count: '0', label: 'Messages awaiting reply', tone: 'good' },
      { count: '1', label: 'Channel open to hire this operator', tone: 'warn', to: '/contact' },
    ],
    recent: [
      { type: 'Employee', name: 'Riley Betts', glyph: '👤', to: '/employee' },
      { type: 'Project', name: 'SunApps MES', glyph: '📦', to: '/projects/sunapps-mes' },
      { type: 'Position', name: 'IT Manager — Ida Milk (Suntado)', glyph: '💼', to: '/positions/ida-milk' },
      { type: 'Project', name: 'KidCam', glyph: '📦', to: '/projects/kidcam' },
      { type: 'Report', name: 'KPI Scorecard', glyph: '📊', to: '/' },
    ],
    shortcuts: [
      { label: 'New Message', glyph: '✉', to: '/contact' },
      { label: 'Employee Record', glyph: '👤', to: '/employee' },
      { label: 'Projects', glyph: '📦', to: '/projects' },
      { label: 'Employment History', glyph: '🗂', to: '/positions' },
      { label: 'GitHub', glyph: '↗', href: 'https://github.com/Riley-D-Betts' },
    ],
    report: {
      title: 'Skills Coverage by Discipline',
      rows: [
        { label: 'ERP / Business Systems', pct: 99, note: 'NetSuite, EDI/B2B, doc control' },
        { label: 'Network & Infrastructure', pct: 95, note: 'UniFi, VLANs, firewalls, cameras' },
        { label: 'Automation / Scripting', pct: 90, note: 'PowerShell, MS Graph, integrations' },
        { label: 'Virtualization', pct: 95, note: 'VMware, HCX, Windows Server, DR' },
        { label: 'Floor Systems', pct: 99, note: 'MES, Andon, AI vision, ESP32' },
      ],
    },
    tip: 'This account is a résumé. Every portlet, record and list is real information about Riley Betts, arranged the way Bettsuite would arrange it.',
  },

  employee: {
    title: 'Information Technology Manager',
    status: 'Active — Full Time',
    statusTone: 'green',
    groups: [
      {
        title: 'Primary Information',
        fields: [
          { label: 'Name', value: 'Riley Betts' },
          { label: 'Employee ID', value: 'EMP-1042', mono: true },
          { label: 'Job Title', value: 'Information Technology Manager' },
          { label: 'Class', value: 'Systems / Infrastructure / Automation' },
          { label: 'Employer', value: 'Ida Milk, LLC (Suntado)' },
          { label: 'Location', value: 'Burley, Idaho' },
          { label: 'Hire Date', value: '11/18/2024', help: 'Inducted as Systems Analyst' },
          { label: 'Status', value: 'Active — Full Time', tone: 'green' },
        ],
      },
      {
        title: 'Communication',
        fields: [
          { label: 'Email', value: 'riley.betts@outlook.com', href: 'mailto:riley.betts@outlook.com' },
          { label: 'GitHub', value: '@Riley-D-Betts', href: 'https://github.com/Riley-D-Betts' },
          { label: 'Coordinates', value: '42.53°N, -113.79°W', mono: true },
        ],
      },
      {
        title: 'Access & Roles',
        fields: [
          { label: 'ERP', value: 'Administrator', tone: 'blue' },
          { label: 'Network', value: 'Root', tone: 'blue' },
          { label: 'Floor Systems', value: 'All Lines', tone: 'blue' },
          { label: 'Budget Authority', value: '$0 preferred', help: 'The best line item is the one you never file' },
        ],
      },
    ],
    bio: [
      'I run IT for a dairy manufacturer. That sentence undersells it. At a plant filling millions of units, "IT" means the ERP, the network, the servers, the cameras, the help desk, the dashboards on the floor, and the B2B pipes that keep trucks arriving.',
      'I got here by building. When the plant needed something that did not exist yet — a training system, or document control, or a way for partners to talk to us — the answer was rarely a purchase order. Most of it I built myself, or it got built under my direction, for close to zero dollars. The department started as one person keeping a very long list. The list eventually became a system, and the one person got to hire help.',
      'The habit does not switch off at home. I build cameras for my kids, a wall dashboard for my kitchen, and drawing apps for tiny artists. If a tool does not fit the hand that uses it, I take that personally.',
    ],
    skills: [
      {
        category: 'ERP / Business Systems',
        proficiency: 'Expert',
        years: '7 yrs',
        skills: ['NetSuite', 'EDI / B2B', 'Document Control', 'Process Design'],
      },
      {
        category: 'Network & Infrastructure',
        proficiency: 'Advanced',
        years: '7 yrs',
        skills: ['UniFi', 'VLANs', 'Firewalls', 'Wi-Fi at Scale', 'IP Cameras'],
      },
      {
        category: 'Virtualization',
        proficiency: 'Advanced',
        years: '6 yrs',
        skills: ['VMware', 'HCX', 'Windows Server', 'Backup / DR'],
      },
      {
        category: 'Automation / Scripting',
        proficiency: 'Advanced',
        years: '7 yrs',
        skills: ['PowerShell', 'MS Graph', 'Integrations', 'Script Everything'],
      },
      {
        category: 'Floor Systems',
        proficiency: 'Proficient',
        years: '2 yrs',
        skills: ['MES', 'Andon', 'Dashboards', 'AI Vision', 'ESP32 / Hardware'],
      },
    ],
  },

  positions: [
    {
      id: 'ida-milk',
      company: 'Ida Milk, LLC',
      subtitle: 'Operating as Suntado',
      location: 'Burley, Idaho',
      start: '2024-11-18',
      periodLabel: 'Nov 2024 — Present',
      titles: [
        { title: 'Systems Analyst', period: 'Nov 2024 — 2025' },
        { title: 'IT Supervisor', period: 'Nov 2025 — 2026' },
        { title: 'Information Technology Manager', period: '2026 — Present' },
      ],
      status: 'Current',
      statusTone: 'green',
      summary:
        'Sole IT operator for a high-volume dairy / UHT beverage plant, then founder of its IT department. Everything from the ERP core to the cable tray.',
      milestones: [
        { note: 'Inducted as Systems Analyst — sole IT operator for the plant', type: 'Hired' },
        { note: 'Held network uptime above 99.98% across plant operations', type: 'Note' },
        { note: 'Built the majority of company systems personally or under direction', type: 'Note' },
        { note: 'Authored policy and procedure for previously undocumented processes', type: 'Note' },
        { note: 'Ran the department solo while understaffed — nothing dropped, everything logged', type: 'Note' },
        { note: 'Promoted to Information Technology Manager', type: 'Promoted' },
        { note: 'Deployed zero-cost solutions: training, document control, B2B communications', type: 'Note' },
        { note: 'Directed the overhaul of critical business systems (NetSuite ERP core)', type: 'Note' },
        { note: 'Established standing cross-department meetings — IT ships what the floor needs', type: 'Note' },
        { note: 'Identified, built and deployed manufacturing dashboards, a help desk and AI line cameras', type: 'Note' },
      ],
      tags: ['NetSuite', 'Network', 'VMware', 'UniFi', 'PowerShell', 'MES', 'Leadership'],
    },
    {
      id: 'rymer',
      company: 'Rymer Technologies',
      subtitle: 'The MSP years',
      location: 'Idaho Falls, Idaho',
      start: '2023-11-01',
      end: '2024-09-01',
      periodLabel: '2023 — 2024',
      titles: [{ title: 'Systems Administrator', period: 'Many networks, one sysadmin' }],
      status: 'Closed',
      statusTone: 'gray',
      summary:
        'Managed IT and custom software delivery for small businesses across Southern Idaho. Every client ran a different stack, and something was always on fire somewhere.',
      milestones: [
        { note: 'Ran client networks, servers and backups across Southern Idaho', type: 'Note' },
        { note: 'Delivered custom software and IT service at small-business scale', type: 'Note' },
      ],
      tags: ['MSP', 'Windows Server', 'Networking', 'Backup / DR'],
    },
    {
      id: 'big-dog-solar',
      company: 'Big Dog Solar',
      subtitle: 'The solar years',
      location: 'Chubbuck / Pocatello, Idaho',
      start: '2021-07-01',
      end: '2023-11-01',
      periodLabel: '2021 — 2023',
      titles: [
        { title: 'Solar Appointment Setter', period: 'The phones' },
        { title: 'Permit / System Designer', period: 'The drafting table' },
        { title: 'Business Systems Administrator', period: 'The server room' },
      ],
      status: 'Closed',
      statusTone: 'gray',
      summary:
        'Residential and commercial solar out of southeast Idaho. Started on the phones, ended up running the software that ran the company.',
      milestones: [
        { note: 'Started on the phones — qualified leads and explained solar to homeowners', type: 'Hired' },
        { note: 'Moved to design — residential permits and one-line diagrams, drawn to code in AutoCAD', type: 'Note' },
        { note: 'Promoted to Business Systems Administrator — hardware, software, NetSuite', type: 'Promoted' },
        { note: 'First contact with NetSuite — the obsession begins', type: 'Note' },
      ],
      tags: ['AutoCAD', 'NetSuite', 'Solar', 'Permits', 'Sales'],
    },
  ],

  projects: [
    {
      id: 'kidcam',
      code: 'PRJ-01',
      name: 'KidCam',
      category: 'Hardware / Firmware',
      status: 'Prototype',
      statusTone: 'amber',
      blurb:
        'A real digital camera for a three-year-old. Two buttons, no menus, no cloud. ESP32-S3 with a proper viewfinder, photos to SD, and a hold-both-buttons Wi-Fi mode so a parent can pull the shots from a browser. Deep sleep so the battery survives a toddler’s attention span.',
      specs: ['ESP32-S3 Sense', 'OV2640 Cam', 'ST7789 TFT', 'SD Storage', 'Soft-AP Photo Server', 'Deep Sleep'],
      links: [],
      featured: true,
    },
    {
      id: 'sunapps-mes',
      code: 'PRJ-02',
      name: 'SunApps MES',
      category: 'Manufacturing Execution',
      status: 'Active Dev',
      statusTone: 'green',
      blurb:
        'Manufacturing execution built next to a real production floor: work orders, station operations, and line status that operators actually use.',
      specs: ['MES', 'Work Orders', 'Line Status', 'Shop-Floor UI'],
      links: [{ label: 'GitHub', href: 'https://github.com/Riley-D-Betts/SunApps_MES' }],
    },
    {
      id: 'betts-board',
      code: 'PRJ-03',
      name: 'Betts-Board',
      category: 'Household Ops Platform',
      status: 'Online',
      statusTone: 'green',
      blurb:
        'The household ops board: family calendar with real recurrence rules, chores with a rewards store the kids actually check, recipes that turn into meal plans and aisle-sorted shopping lists, a barcode-scanned pantry, and a photo frame for the kitchen tablet. It runs as one Docker container and speaks a documented REST API, so Home Assistant can join the family.',
      specs: ['Nuxt 4', 'SQLite + Drizzle', 'PWA', 'Web Push', 'REST + OpenAPI', 'Home Assistant'],
      links: [{ label: 'GitHub', href: 'https://github.com/Riley-D-Betts/betts-board' }],
    },
    {
      id: 'quilt',
      code: 'PRJ-04',
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
      code: 'PRJ-05',
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
      'Open a channel. This form composes an email — nothing is sent until your mail client opens, and nothing is stored on the way.',
    email: 'rbetts@idamilk.com',
    github: '@Riley-D-Betts',
    githubUrl: 'https://github.com/Riley-D-Betts',
    subjects: [
      'Hiring / role inquiry',
      'Consulting / systems help',
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
      'No UI kit, no component library, no template. The masthead, the menu bar, the field groups and the subtabs are all hand-rolled CSS, built against Bettsuite’s own published design tokens rather than from memory. Any resemblance to enterprise software you have suffered through is entirely intentional.',
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
  },
}
