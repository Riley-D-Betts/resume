import { resume } from '~/data/resume'

export interface SearchHit {
  type: string
  name: string
  to?: string
  href?: string
  terms: string
}

/** A flat, searchable index of every record in the account. */
export function useSearchIndex(): SearchHit[] {
  const hits: SearchHit[] = []

  hits.push({
    type: 'Employee',
    name: resume.identity.name,
    to: '/employee',
    terms: `${resume.identity.name} it manager information technology ${resume.employee.skills
      .flatMap((s) => s.skills)
      .join(' ')}`.toLowerCase(),
  })

  hits.push({
    type: 'Subsidiary',
    name: resume.fobech.name,
    to: '/fobech',
    terms: `fobech studio mes traceability qc andon manufacturing software ${resume.fobech.taglines.join(' ')}`.toLowerCase(),
  })

  for (const p of resume.positions) {
    hits.push({
      type: 'Position',
      name: `${p.titles[0]?.title ?? p.company} — ${p.company}`,
      to: `/positions/${p.id}`,
      terms: `${p.company} ${p.subtitle ?? ''} ${p.titles.map((t) => t.title).join(' ')} ${p.tags.join(' ')} ${p.location}`.toLowerCase(),
    })
  }

  for (const p of resume.projects) {
    hits.push({
      type: 'Project',
      name: p.name,
      to: `/projects/${p.id}`,
      terms: `${p.name} ${p.category} ${p.status} ${p.specs.join(' ')}`.toLowerCase(),
    })
  }

  hits.push({ type: 'Report', name: 'KPI Scorecard', to: '/', terms: 'kpi uptime spend headcount dashboard report scorecard' })
  hits.push({ type: 'Page', name: 'Contact — New Message', to: '/contact', terms: 'contact email hire message reach out' })
  hits.push({ type: 'List', name: 'Employment History', to: '/positions', terms: 'work history jobs positions career' })
  hits.push({ type: 'List', name: 'Projects', to: '/projects', terms: 'projects side builds apps' })

  return hits
}
