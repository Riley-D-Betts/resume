/* ============================================================
   RESUME CONTENT — the single source of every visible word.
   Edit this file to change anything the site says.
   Components render from here and only from here.
   ============================================================ */

export interface StatusReadout {
  label: string
  value: string
  lamp?: 'green' | 'amber' | 'red' | 'teal'
  /** wired to a live client-side value */
  live?: 'uptime' | 'clock'
}

export interface SkillGroup {
  label: string
  skills: string[]
}

export interface Stat {
  /** rendered big; if countTo is set the number animates up to it */
  value: string
  countTo?: number
  suffix?: string
  label: string
}

export interface LogLine {
  text: string
  stamp?: 'OK' | 'PROMOTED' | 'HIRED'
}

export interface RoleTitle {
  title: string
  period: string
}

export interface Role {
  org: string
  aka?: string
  location: string
  start: string // ISO date — drives the timeline
  end?: string // undefined = present
  titles: RoleTitle[]
  summary: string
  logLines: LogLine[]
  tags: string[]
}

export interface Project {
  id: string
  bay: string
  name: string
  status: 'ONLINE' | 'PROTOTYPE' | 'ACTIVE DEV' | 'ARCHIVED'
  statusLamp: 'green' | 'amber' | 'teal'
  blurb: string
  specs: string[]
  links: { label: string; href: string }[]
  featured?: boolean
}

export interface ResumeContent {
  meta: { title: string; description: string }
  identity: {
    name: [string, string]
    role: string
    org: string
    email: string
    github: string
    githubUrl: string
    location: string
    coords: string
    /** first day at Ida Milk — epoch for the live uptime counter */
    hiredISO: string
    timezone: string
  }
  boot: { lines: string[]; done: string }
  hero: {
    prefix: string
    readouts: StatusReadout[]
    ticker: string[]
    scrollHint: string
  }
  about: {
    header: string
    fileTag: string
    paragraphs: string[]
    operatorClass: string
    clearances: string[]
    skillGroups: SkillGroup[]
    stats: Stat[]
  }
  roles: Role[]
  fobech: {
    name: string
    url: string
    logo: string
    taglines: [string, string]
    blurb: string
    cta: string
    capabilities: { title: string; desc: string }[]
  }
  projects: Project[]
  comms: {
    title: string
    promptLines: string[]
    ready: string
    actions: { label: string; kind: 'mail' | 'copy' | 'link'; href?: string }[]
    footer: string
    privacyNotice: string
  }
  eggs: {
    consoleBanner: string[]
    consoleHint: string
    konamiMessage: string
  }
}

export const resume: ResumeContent = {
  meta: {
    title: 'RILEY BETTS // OPS CONSOLE',
    description:
      'Riley Betts — IT Manager, Ida Milk (Suntado). The person who runs the systems that run a dairy plant. Founder, Fobech.',
  },

  identity: {
    name: ['RILEY', 'BETTS'],
    role: 'IT MANAGER — IDA MILK, LLC (SUNTADO)',
    org: 'Ida Milk, LLC',
    email: 'rbetts@idamilk.com',
    github: 'RILEY-D-BETTS',
    githubUrl: 'https://github.com/Riley-D-Betts',
    location: 'BURLEY, IDAHO',
    coords: '42.53N -113.79W',
    hiredISO: '2024-11-18',
    timezone: 'America/Boise',
  },

  boot: {
    lines: [
      'IDAMILK/SUNTADO OPS CONSOLE v1.0',
      'MOUNTING /dev/riley ............... OK',
      'NETWORK UPTIME .................. 99.9% [PASS]',
      'ERP CORE (NETSUITE) ... GOD KING PRIVILEGES GRANTED',
      'FLOOR SYSTEMS ................. ALL LINES REPORTING',
      'SIDE PROJECTS ................. 5 BAYS POWERED',
      'FOBECH STUDIO LINK .................... ACTIVE',
    ],
    done: 'OPERATOR AUTHENTICATED',
  },

  hero: {
    prefix: 'SYS:// OPERATOR CONSOLE — PERSONNEL RECORD',
    readouts: [
      { label: 'PWR', value: 'ONLINE', lamp: 'green' },
      { label: 'UPTIME', value: '---:--:--:--', live: 'uptime' },
      { label: 'LOC', value: 'BURLEY, ID · 42.53N -113.79W' },
      { label: 'LT', value: '--:--:--', live: 'clock' },
      { label: 'ROLE', value: 'IT MANAGER — IDA MILK LLC (SUNTADO)' },
      { label: 'SIDE', value: 'FOBECH.COM — STUDIO ACTIVE', lamp: 'teal' },
    ],
    ticker: [
      '>99.9% NETWORK UPTIME',
      'ERP OVERHAUL DIRECTED',
      'DEPARTMENT BUILT FROM A SOLO OP',
      'ZERO-COST DEPLOYMENTS: TRAINING / DOC CONTROL / B2B',
      'POLICY WRITTEN WHERE NONE EXISTED',
      'AI CAMERAS ON PRODUCTION LINES',
      'DASHBOARDS THE FLOOR ACTUALLY READS',
    ],
    scrollHint: 'SCROLL TO INSPECT',
  },

  about: {
    header: 'OPERATOR PROFILE',
    fileTag: 'PERSONNEL FILE: BETTS, R.',
    paragraphs: [
      'I run IT for a dairy manufacturer. That sentence undersells it. At a plant filling millions of units, "IT" means the ERP, the network, the servers, the cameras, the help desk, the dashboards on the floor, and the B2B pipes that keep trucks arriving.',
      'I got here by building. When the plant needed something that did not exist yet, a training system or document control or a way for partners to talk to us, the answer was rarely a purchase order. Most of it I built myself, or it got built under my direction, for close to zero dollars. The department started as one person keeping a very long list. The list eventually became a system, and the one person got to hire help.',
      'The habit does not switch off at home. I build cameras for my kids, a wall dashboard for my kitchen, and manufacturing software for other plants through my studio, Fobech. If a tool does not fit the hand that uses it, I take that personally.',
    ],
    operatorClass: 'SYSTEMS / INFRASTRUCTURE / AUTOMATION',
    clearances: ['ERP: ADMIN', 'NET: ROOT', 'FLOOR: ALL LINES', 'BUDGET: $0 PREFERRED'],
    skillGroups: [
      { label: 'NETWORK', skills: ['UNIFI', 'VLANS', 'FIREWALLS', 'WIFI AT SCALE', 'CAMERAS'] },
      { label: 'VIRTUALIZATION', skills: ['VMWARE', 'HCX', 'WINDOWS SERVER', 'BACKUP/DR'] },
      { label: 'AUTOMATION', skills: ['POWERSHELL', 'MS GRAPH', 'INTEGRATIONS', 'SCRIPT EVERYTHING'] },
      { label: 'ERP / BUSINESS', skills: ['NETSUITE', 'EDI / B2B', 'DOC CONTROL', 'PROCESS DESIGN'] },
      { label: 'FLOOR SYSTEMS', skills: ['MES', 'ANDON', 'DASHBOARDS', 'AI VISION', 'ESP32 / HW'] },
    ],
    stats: [
      { value: '99.9', countTo: 99.9, suffix: '%+', label: 'NETWORK UPTIME MAINTAINED' },
      { value: '1', suffix: ' → TEAM', label: 'DEPARTMENT GROWN FROM A SOLO OPERATION' },
      { value: '0', countTo: 0, suffix: '$', label: 'SPENT ON TRAINING / DOC CONTROL / B2B STACKS' },
    ],
  },

  roles: [
    // start/end are not rendered anywhere — array order drives the timeline.
    {
      org: 'BIG DOG SOLAR',
      aka: 'THE SOLAR YEARS',
      location: 'CHUBBUCK / POCATELLO, IDAHO',
      start: '2016-01-01',
      end: '2019-12-31',
      titles: [
        { title: 'SOLAR APPOINTMENT SETTER', period: 'THE PHONES' },
        { title: 'PERMIT / SYSTEM DESIGNER', period: 'THE DRAFTING TABLE' },
        { title: 'BUSINESS SYSTEMS ADMINISTRATOR', period: 'THE SERVER ROOM' },
      ],
      summary:
        'Residential and commercial solar out of southeast Idaho. Started on the phones, ended up running the software that ran the company.',
      logLines: [
        { text: 'STARTED ON THE PHONES — QUALIFIED LEADS, EXPLAINED SOLAR TO HOMEOWNERS', stamp: 'HIRED' },
        { text: 'MOVED TO DESIGN — RESIDENTIAL PERMITS AND ONE-LINE DIAGRAMS, DRAWN TO CODE IN AUTOCAD', stamp: 'OK' },
        { text: 'PROMOTED TO BUSINESS SYSTEMS ADMINISTRATOR — HARDWARE, SOFTWARE, NETSUITE', stamp: 'PROMOTED' },
        { text: 'FIRST CONTACT WITH NETSUITE — THE OBSESSION BEGINS', stamp: 'OK' },
      ],
      tags: ['AUTOCAD', 'NETSUITE', 'SOLAR', 'PERMITS', 'SALES'],
    },
    {
      org: 'RYMER TECHNOLOGIES',
      aka: 'THE MSP YEARS',
      location: 'IDAHO FALLS, IDAHO',
      start: '2020-01-01',
      end: '2024-11-01',
      titles: [{ title: 'SYSTEMS ADMINISTRATOR', period: 'MANY NETWORKS, ONE SYSADMIN' }],
      summary:
        'Managed IT and custom software delivery for small businesses across Southern Idaho. Every client ran a different stack, and something was always on fire somewhere.',
      logLines: [
        { text: 'CLIENT NETWORKS, SERVERS, AND BACKUPS ACROSS SOUTHERN IDAHO', stamp: 'OK' },
        { text: 'CUSTOM SOFTWARE + IT SERVICE DELIVERY AT SMALL-BUSINESS SCALE', stamp: 'OK' },
      ],
      tags: ['MSP', 'WINDOWS SERVER', 'NETWORKING', 'BACKUP / DR'],
    },
    {
      org: 'IDA MILK, LLC',
      aka: 'OPERATING AS SUNTADO',
      location: 'BURLEY, IDAHO',
      start: '2024-11-18',
      titles: [
        { title: 'IT SUPERVISOR', period: 'NOV 2024 — 2025' },
        { title: 'INFORMATION TECHNOLOGY MANAGER', period: '2025 — PRESENT' },
      ],
      summary:
        'Sole IT operator for a high-volume dairy / UHT beverage plant, then founder of its IT department. Everything from the ERP core to the cable tray.',
      logLines: [
        { text: '2024-11-18 // OPERATOR INDUCTED — IT SUPERVISOR', stamp: 'HIRED' },
        { text: 'NETWORK UPTIME HELD ABOVE 99.9% ACROSS PLANT OPERATIONS', stamp: 'OK' },
        { text: 'MAJORITY OF COMPANY SYSTEMS BUILT PERSONALLY OR UNDER DIRECTION', stamp: 'OK' },
        { text: 'POLICY + PROCEDURE AUTHORED FOR PREVIOUSLY UNDOCUMENTED PROCESSES', stamp: 'OK' },
        { text: 'RAN THE DEPARTMENT SOLO WHILE UNDERSTAFFED — NOTHING DROPPED, EVERYTHING LOGGED', stamp: 'OK' },
        { text: 'PROMOTED — INFORMATION TECHNOLOGY MANAGER', stamp: 'PROMOTED' },
        { text: 'ZERO-COST SOLUTIONS DEPLOYED: TRAINING, DOCUMENT CONTROL, B2B COMMUNICATIONS', stamp: 'OK' },
        { text: 'OVERHAUL OF CRITICAL BUSINESS SYSTEMS DIRECTED (NETSUITE ERP CORE)', stamp: 'OK' },
        { text: 'STANDING CROSS-DEPARTMENT MEETINGS ESTABLISHED — IT SHIPS WHAT THE FLOOR NEEDS', stamp: 'OK' },
        { text: 'MANUFACTURING DASHBOARDS, HELP DESK, AI LINE CAMERAS: IDENTIFIED, BUILT, DEPLOYED', stamp: 'OK' },
      ],
      tags: ['ERP', 'NETWORK', 'VMWARE', 'UNIFI', 'POWERSHELL', 'MES', 'LEADERSHIP'],
    },
    {
      org: 'FOBECH',
      aka: 'INDEPENDENT SYSTEMS STUDIO — FOUNDER',
      location: 'FOBECH.COM',
      start: '2026-01-01',
      titles: [{ title: 'FOUNDER / PRINCIPAL ENGINEER', period: 'ONGOING' }],
      summary:
        'A boutique software studio for food & beverage manufacturers who keep buying software that almost fits. Fobech builds the part that never ships in a box.',
      logLines: [
        { text: 'STUDIO ESTABLISHED — CUSTOM F&B MANUFACTURING SOFTWARE', stamp: 'OK' },
        { text: 'MES / LOT TRACEABILITY / QC GATING / ANDON — SEE SEGMENT 04', stamp: 'OK' },
      ],
      tags: ['NUXT', 'CLOUDFLARE', 'SQLITE', 'MES', 'TRACEABILITY'],
    },
  ],

  fobech: {
    name: 'FOBECH',
    url: 'https://fobech.com',
    logo: '/fobech/logo.svg',
    taglines: ['Complexity Is Our Problem. Not Yours.', "We build what off-the-shelf can't."],
    blurb:
      'Fobech is my software studio. It exists because food & beverage manufacturers keep buying software that almost fits, then bending the plant around the software. Fobech bends the software around the plant: manufacturing execution, lot traceability that runs both directions, QC gating that actually gates, and Andon boards that tell the floor the truth in real time.',
    cta: 'ESTABLISH LINK → FOBECH.COM',
    capabilities: [
      { title: 'MES', desc: 'WORK ORDERS · STATION OPS · LINE STATE' },
      { title: 'LOT TRACEABILITY', desc: 'FORWARD + BACKWARD · INSTANT RECALL SCOPE' },
      { title: 'QC HOLD / RELEASE', desc: 'GATED FLOW · NOTHING SHIPS ON A GUESS' },
      { title: 'ANDON / LIVE STATUS', desc: 'LIVE BOARDS · NO MASSAGED NUMBERS' },
    ],
  },

  projects: [
    {
      id: 'kidcam',
      bay: 'BAY-01',
      name: 'KIDCAM',
      status: 'PROTOTYPE',
      statusLamp: 'amber',
      blurb:
        'A real digital camera for a three-year-old. Two buttons, no menus, no cloud. ESP32-S3 with a proper viewfinder, photos to SD, and a hold-both-buttons WiFi mode so a parent can pull the shots from a browser. Deep sleep so the battery survives a toddler’s attention span.',
      specs: ['ESP32-S3 SENSE', 'OV2640 CAM', 'ST7789 TFT', 'SD STORAGE', 'SOFT-AP PHOTO SERVER', 'DEEP SLEEP'],
      links: [],
      featured: true,
    },
    {
      id: 'sunapps-mes',
      bay: 'BAY-02',
      name: 'SUNAPPS_MES',
      status: 'ACTIVE DEV',
      statusLamp: 'green',
      blurb:
        'Manufacturing execution built next to a real production floor: work orders, station operations, and line status that operators actually use. The proving ground for the ideas Fobech ships.',
      specs: ['MES', 'WORK ORDERS', 'LINE STATUS', 'SHOP-FLOOR UI'],
      links: [{ label: 'GITHUB ↗', href: 'https://github.com/Riley-D-Betts/SunApps_MES' }],
    },
    {
      id: 'betts-board',
      bay: 'BAY-03',
      name: 'BETTS-BOARD',
      status: 'ONLINE',
      statusLamp: 'green',
      blurb:
        'The household ops board: family calendar with real recurrence rules, chores with a rewards store the kids actually check, recipes that turn into meal plans and aisle-sorted shopping lists, a barcode-scanned pantry, and a photo frame for the kitchen tablet. It runs as one Docker container and speaks a documented REST API, so Home Assistant can join the family.',
      specs: ['NUXT 4', 'SQLITE + DRIZZLE', 'PWA', 'WEB PUSH', 'REST + OPENAPI', 'HOME ASSISTANT'],
      links: [{ label: 'GITHUB ↗', href: 'https://github.com/Riley-D-Betts/betts-board' }],
    },
    {
      id: 'quilt',
      bay: 'BAY-04',
      name: 'QUILT',
      status: 'ONLINE',
      statusLamp: 'green',
      blurb:
        'A quilt-design studio. Paint the pattern cell by cell, name your fabrics, and it does the math that matters at the cutting table: piece counts, seam allowance, and yardage off a 42″ bolt rounded to the next eighth. Small pieces, carefully stitched.',
      specs: ['REACT 19', 'CLOUDFLARE WORKERS', 'HONO', 'D1 SQLITE', 'FABRIC MATH', 'PWA'],
      links: [
        { label: 'LIVE APP ↗', href: 'https://quilt.rileybetts.xyz' },
        { label: 'GITHUB ↗', href: 'https://github.com/Riley-D-Betts/Quilt' },
      ],
    },
    {
      id: 'draw',
      bay: 'BAY-05',
      name: 'LITTLE ARTISTS',
      status: 'ONLINE',
      statusLamp: 'green',
      blurb:
        'A drawing studio for artists aged two to eight, with no logins and no ads. Kids tap their animal to sign in, then get crayons, sparkles, stamps, and a flood-fill bucket that respects the lines. Any photo can become a coloring page. Every masterpiece lands on the family server, where the delete button hides behind a multiplication problem.',
      specs: ['NUXT 4', 'CANVAS', 'FLOOD FILL', 'PHOTO → LINE ART', 'SELF-HOSTED'],
      links: [{ label: 'GITHUB ↗', href: 'https://github.com/Riley-D-Betts/draw' }],
    },
  ],

  comms: {
    title: 'COMMS UPLINK',
    promptLines: ['> establish uplink --to rbetts@idamilk.com', '> handshake ......... ACCEPTED', '> channel open — encryption: TRUST'],
    ready: 'LINK READY. AWAITING TRANSMISSION.',
    actions: [
      { label: '[ SEND MAIL ]', kind: 'mail', href: 'mailto:rbetts@idamilk.com' },
      { label: '[ COPY ADDR ]', kind: 'copy' },
      { label: '[ GITHUB: RILEY-D-BETTS ]', kind: 'link', href: 'https://github.com/Riley-D-Betts' },
      { label: '[ FOBECH.COM ]', kind: 'link', href: 'https://fobech.com' },
    ],
    footer: '© 2026 RILEY BETTS · BUILT WITH NUXT + GSAP · NO TEMPLATES HARMED',
    privacyNotice:
      'THIS SITE RUNS SELF-HOSTED FIRST-PARTY ANALYTICS, INCLUDING SESSION REPLAY. NO THIRD PARTIES. DATA STAYS ON MY SERVER.',
  },

  eggs: {
    consoleBanner: [
      '  ____  _   _ _   _ _____  _    ____   ___',
      ' / ___|| | | | \\ | |_   _|/ \\  |  _ \\ / _ \\',
      ' \\___ \\| | | |  \\| | | | / _ \\ | | | | | | |',
      '  ___) | |_| | |\\  | | |/ ___ \\| |_| | |_| |',
      ' |____/ \\___/|_| \\_| |_/_/   \\_\\____/ \\___/',
      '',
      '⚠ AUTHORIZED PERSONNEL ONLY.',
      'signed, the God King of NetSuite',
    ],
    consoleHint: 'type ops.help() for the maintenance interface.',
    konamiMessage: 'DRILL COMPLETE. NICE REFLEXES.',
  },
}
