/* ============================================================
   RESUME CONTENT — the single source of every visible word.
   Edit this file to change anything the site says.

   The site presents Riley Betts' résumé as a mock NetSuite ERP
   account: an Employee record, an Employment History list,
   Project records, a Subsidiary (Fobech) and a Home dashboard
   of portlets. Components render from this file and only from
   this file.
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

/* ---- NetSuite chrome --------------------------------------- */
export interface NavLink {
  label: string
  to?: string
  href?: string
  desc?: string
}
export interface NavColumn {
  heading: string
  links: NavLink[]
}
export interface NavTab {
  id: string
  label: string
  to?: string
  columns?: NavColumn[]
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

/* ---- capabilities (Fobech subsidiary sublist) -------------- */
export interface Capability {
  title: string
  desc: string
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
    subsidiary: string
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
  fobech: {
    name: string
    legalName: string
    url: string
    taglines: [string, string]
    blurb: string
    cta: string
    groups: FieldGroup[]
    capabilities: Capability[]
  }
  projects: Project[]
  contact: {
    intro: string
    email: string
    github: string
    githubUrl: string
    fobech: string
    subjects: string[]
    footer: string
    privacyNotice: string
  }
  eggs: {
    consoleBanner: string[]
    consoleHint: string
    toast: string
  }
}

export const resume: ResumeContent = {
  meta: {
    title: 'Riley Betts — Home | NetSuite',
    description:
      'Riley Betts — IT Manager at Ida Milk, LLC (Suntado) and founder of Fobech. A résumé built as a working mock NetSuite ERP account.',
  },

  account: {
    product: 'NetSuite',
    edition: 'Personnel Account',
    personName: 'Riley Betts',
    roleLabel: 'Administrator',
    accountName: 'Ida Milk, LLC (Suntado)',
    accountId: 'ACCT 42537',
    subsidiary: 'Ida Milk, LLC : IT',
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

  nav: [
    { id: 'home', label: 'Home', to: '/' },
    {
      id: 'activities',
      label: 'Activities',
      columns: [
        {
          heading: 'Career',
          links: [
            { label: 'Employment History', to: '/positions', desc: 'Every role, in order' },
            { label: 'Current Position', to: '/positions/ida-milk', desc: 'IT Manager — Ida Milk (Suntado)' },
            { label: 'Milestones', to: '/positions', desc: 'Promotions and inductions' },
          ],
        },
        {
          heading: 'Standing',
          links: [
            { label: 'Cross-Dept Meetings', to: '/positions/ida-milk', desc: 'IT ships what the floor needs' },
            { label: 'On-Call / Help Desk', to: '/positions/ida-milk', desc: 'Nothing dropped, everything logged' },
          ],
        },
      ],
    },
    {
      id: 'lists',
      label: 'Lists',
      columns: [
        {
          heading: 'Records',
          links: [
            { label: 'Employees', to: '/employee', desc: 'Riley Betts' },
            { label: 'Subsidiaries', to: '/fobech', desc: 'Fobech — systems studio' },
            { label: 'Positions', to: '/positions', desc: 'Employment history' },
          ],
        },
        {
          heading: 'Projects',
          links: [
            { label: 'Projects', to: '/projects', desc: 'Side builds, all statuses' },
            { label: 'Skills & Certifications', to: '/employee', desc: 'On the Human Resources subtab' },
          ],
        },
      ],
    },
    {
      id: 'reports',
      label: 'Reports',
      columns: [
        {
          heading: 'Scorecards',
          links: [
            { label: 'KPI Scorecard', to: '/', desc: 'Uptime, spend, headcount' },
            { label: 'Career Trajectory', to: '/', desc: 'Scope of responsibility over time' },
            { label: 'Skills Coverage', to: '/', desc: 'Depth by discipline' },
          ],
        },
      ],
    },
    {
      id: 'fobech',
      label: 'Fobech',
      columns: [
        {
          heading: 'Subsidiary',
          links: [
            { label: 'Subsidiary Record', to: '/fobech', desc: 'The independent systems studio' },
            { label: 'Capabilities', to: '/fobech', desc: 'MES · Traceability · QC · Andon' },
            { label: 'Visit fobech.com', href: 'https://fobech.com', desc: 'External site' },
          ],
        },
      ],
    },
    {
      id: 'support',
      label: 'Support',
      columns: [
        {
          heading: 'Contact',
          links: [
            { label: 'New Message', to: '/contact', desc: 'Open a channel' },
            { label: 'Email', href: 'mailto:rbetts@idamilk.com', desc: 'rbetts@idamilk.com' },
            { label: 'GitHub', href: 'https://github.com/Riley-D-Betts', desc: '@Riley-D-Betts' },
          ],
        },
      ],
    },
  ],

  dashboard: {
    greeting: 'Welcome, Riley',
    kpis: [
      {
        label: 'Network Uptime',
        value: '99.9%',
        period: 'This Period',
        compare: 'vs. 99.5% target',
        delta: '+0.4%',
        direction: 'up',
        to: '/positions/ida-milk',
      },
      {
        label: 'IT Spend — Training / Doc Control / B2B',
        value: '$0',
        period: 'Year to Date',
        compare: 'vs. ~$120K quoted',
        delta: '-100%',
        direction: 'down',
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
        label: 'Tickets Aged > 48h',
        value: '0',
        period: 'Open',
        compare: 'nothing dropped',
        delta: '0',
        direction: 'flat',
        goodWhenDown: true,
        to: '/positions/ida-milk',
      },
      {
        label: 'Tenure in Systems',
        value: '9 yrs',
        period: 'Since 2016',
        compare: 'phones → server room → ERP',
        delta: '+1 yr',
        direction: 'up',
        to: '/positions',
      },
    ],
    meter: {
      label: 'Network Uptime SLA',
      value: '99.9%',
      percent: 99.9,
      min: 95,
      max: 100,
      target: 'Target 99.5%',
    },
    trend: {
      title: 'Scope of Responsibility',
      unit: 'tier',
      points: [
        { label: '2016', value: 1, note: 'Solar appointment setter — the phones' },
        { label: '2018', value: 2, note: 'Permit / system designer — the drafting table' },
        { label: '2019', value: 3, note: 'Business systems administrator — the server room' },
        { label: '2020', value: 4, note: 'MSP systems administrator — many networks' },
        { label: '2024', value: 5, note: 'IT Supervisor — sole operator' },
        { label: '2025', value: 6, note: 'IT Manager — founded the department' },
        { label: '2026', value: 7, note: 'Founder — Fobech systems studio' },
      ],
    },
    reminders: [
      { count: '1', label: 'Employee record to review', tone: 'info', to: '/employee' },
      { count: '4', label: 'Positions in employment history', tone: 'info', to: '/positions' },
      { count: '5', label: 'Projects online', tone: 'good', to: '/projects' },
      { count: '1', label: 'Subsidiary awaiting your visit — Fobech', tone: 'good', to: '/fobech' },
      { count: '0', label: 'Overdue support tickets', tone: 'good' },
      { count: '1', label: 'Channel open to hire this operator', tone: 'warn', to: '/contact' },
    ],
    recent: [
      { type: 'Employee', name: 'Riley Betts', glyph: '👤', to: '/employee' },
      { type: 'Subsidiary', name: 'Fobech', glyph: '🏢', to: '/fobech' },
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
      { label: 'Fobech Studio', glyph: '↗', href: 'https://fobech.com' },
      { label: 'GitHub', glyph: '↗', href: 'https://github.com/Riley-D-Betts' },
    ],
    report: {
      title: 'Skills Coverage by Discipline',
      rows: [
        { label: 'ERP / Business Systems', pct: 96, note: 'NetSuite, EDI/B2B, doc control' },
        { label: 'Network & Infrastructure', pct: 92, note: 'UniFi, VLANs, firewalls, cameras' },
        { label: 'Automation / Scripting', pct: 90, note: 'PowerShell, MS Graph, integrations' },
        { label: 'Virtualization', pct: 85, note: 'VMware, HCX, Windows Server, DR' },
        { label: 'Floor Systems', pct: 88, note: 'MES, Andon, AI vision, ESP32' },
      ],
    },
    tip: 'This account is a résumé. Every portlet, record and list is real information about Riley Betts, arranged the way NetSuite would arrange it.',
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
          { label: 'Department', value: 'Information Technology' },
          { label: 'Class', value: 'Systems / Infrastructure / Automation' },
          { label: 'Supervisor', value: 'Executive Team' },
          { label: 'Subsidiary', value: 'Ida Milk, LLC (Suntado)' },
          { label: 'Location', value: 'Burley, ID — Plant' },
          { label: 'Hire Date', value: '11/18/2024', help: 'Inducted as IT Supervisor' },
          { label: 'Status', value: 'Active — Full Time', tone: 'green' },
        ],
      },
      {
        title: 'Communication',
        fields: [
          { label: 'Email', value: 'rbetts@idamilk.com', href: 'mailto:rbetts@idamilk.com' },
          { label: 'GitHub', value: '@Riley-D-Betts', href: 'https://github.com/Riley-D-Betts' },
          { label: 'Studio', value: 'fobech.com', href: 'https://fobech.com' },
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
      'The habit does not switch off at home. I build cameras for my kids, a wall dashboard for my kitchen, and manufacturing software for other plants through my studio, Fobech. If a tool does not fit the hand that uses it, I take that personally.',
    ],
    skills: [
      {
        category: 'ERP / Business Systems',
        proficiency: 'Expert',
        years: '9 yrs',
        skills: ['NetSuite', 'EDI / B2B', 'Document Control', 'Process Design'],
      },
      {
        category: 'Network & Infrastructure',
        proficiency: 'Advanced',
        years: '9 yrs',
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
        { title: 'IT Supervisor', period: 'Nov 2024 — 2025' },
        { title: 'Information Technology Manager', period: '2025 — Present' },
      ],
      status: 'Current',
      statusTone: 'green',
      summary:
        'Sole IT operator for a high-volume dairy / UHT beverage plant, then founder of its IT department. Everything from the ERP core to the cable tray.',
      milestones: [
        { note: 'Inducted as IT Supervisor — sole IT operator for the plant', type: 'Hired' },
        { note: 'Held network uptime above 99.9% across plant operations', type: 'Note' },
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
      start: '2020-01-01',
      end: '2024-11-01',
      periodLabel: '2020 — 2024',
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
      start: '2016-01-01',
      end: '2019-12-31',
      periodLabel: '2016 — 2019',
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
    {
      id: 'fobech',
      company: 'Fobech',
      subtitle: 'Independent systems studio — Founder',
      location: 'fobech.com',
      start: '2026-01-01',
      periodLabel: '2026 — Present',
      titles: [{ title: 'Founder / Principal Engineer', period: 'Ongoing' }],
      status: 'Active',
      statusTone: 'teal',
      summary:
        'A boutique software studio for food & beverage manufacturers who keep buying software that almost fits. Fobech builds the part that never ships in a box.',
      milestones: [
        { note: 'Established the studio — custom F&B manufacturing software', type: 'Hired' },
        { note: 'MES, lot traceability, QC gating and Andon — see the Fobech subsidiary record', type: 'Note' },
      ],
      tags: ['Nuxt', 'Cloudflare', 'SQLite', 'MES', 'Traceability'],
    },
  ],

  fobech: {
    name: 'Fobech',
    legalName: 'Fobech — Independent Systems Studio',
    url: 'https://fobech.com',
    taglines: ['Complexity Is Our Problem. Not Yours.', "We build what off-the-shelf can't."],
    blurb:
      'Fobech is my software studio. It exists because food & beverage manufacturers keep buying software that almost fits, then bending the plant around the software. Fobech bends the software around the plant: manufacturing execution, lot traceability that runs both directions, QC gating that actually gates, and Andon boards that tell the floor the truth in real time.',
    cta: 'Visit fobech.com',
    groups: [
      {
        title: 'Subsidiary Information',
        fields: [
          { label: 'Name', value: 'Fobech' },
          { label: 'Legal Name', value: 'Fobech — Independent Systems Studio' },
          { label: 'Type', value: 'Software Studio (F&B Manufacturing)' },
          { label: 'Principal', value: 'Riley Betts', href: '/employee' },
          { label: 'Website', value: 'fobech.com', href: 'https://fobech.com' },
          { label: 'Status', value: 'Active', tone: 'teal' },
        ],
      },
      {
        title: 'Stack',
        fields: [
          { label: 'Frontend', value: 'Nuxt' },
          { label: 'Edge / Data', value: 'Cloudflare · SQLite' },
          { label: 'Focus', value: 'MES · Traceability · QC · Andon' },
          { label: 'Model', value: 'Boutique, built-to-fit' },
        ],
      },
    ],
    capabilities: [
      { title: 'MES', desc: 'Work orders · station ops · line state' },
      { title: 'Lot Traceability', desc: 'Forward + backward · instant recall scope' },
      { title: 'QC Hold / Release', desc: 'Gated flow · nothing ships on a guess' },
      { title: 'Andon / Live Status', desc: 'Live boards · no massaged numbers' },
    ],
  },

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
        'Manufacturing execution built next to a real production floor: work orders, station operations, and line status that operators actually use. The proving ground for the ideas Fobech ships.',
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
    fobech: 'fobech.com',
    subjects: [
      'Hiring / role inquiry',
      'Fobech — custom F&B software',
      'Consulting / systems help',
      'Just saying hello',
    ],
    footer: '© 2026 Riley Betts · Built with Nuxt · A résumé wearing a NetSuite costume · No templates harmed',
    privacyNotice:
      'This site runs self-hosted, first-party analytics, including sampled session replay. No third parties. Data stays on my server.',
  },

  eggs: {
    consoleBanner: [
      '  ____  _   _ _   _ _____  _    ____   ___',
      ' / ___|| | | | \\ | |_   _|/ \\  |  _ \\ / _ \\',
      ' \\___ \\| | | |  \\| | | | / _ \\ | | | | | | |',
      '  ___) | |_| | |\\  | | |/ ___ \\| |_| | |_| |',
      ' |____/ \\___/|_| \\_| |_/_/   \\_\\____/ \\___/',
      '',
      '⚠ Authorized personnel only.',
      'signed, the God King of NetSuite',
    ],
    consoleHint: 'type ns.help() for the maintenance interface.',
    toast: 'Role Center refreshed. Nice reflexes.',
  },
}
