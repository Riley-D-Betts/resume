// server/utils/orgKind.ts — classify an `as_org` name as org / isp / cloud
// (contract D11: a badge and a filter, never a sort key). PURE.

import type { OrgKind } from '../../shared/analytics/ops.ts'

// Hosting / cloud / proxy networks: a visit from here says nothing about the
// visitor's employer. Checked first — "Amazon Technologies", "AWS", "Microsoft
// Azure" and "Google Cloud" are cloud while the plain corporate names stay org.
const CLOUD_RE = new RegExp(
  '\\b(aws|amazon technologies|amazon data services|amazon\\.com services|a100 row|azure|google cloud|gcp|cloudflare|'
    + 'oracle cloud|oracle corporation|digitalocean|digital ocean|hetzner|ovh|linode|akamai|fastly|icloud|private relay|'
    + 'm247|datacamp|choopa|vultr|leaseweb|scaleway|contabo|godaddy|hostinger|ionos|rackspace|alibaba|aliyun|tencent|'
    + 'huawei cloud|equinix|zenlayer|serverius|hostwinds|psychz|colocrossing|quadranet|hostpapa|dreamhost|'
    + 'hosting|host|servers?|cloud|vpn|proxy|datacenter|data center|dedicated|colocation|kamatera|upcloud|netcup|'
    + 'lightsail|fly\\.io|heroku|vercel|netlify|nordvpn|expressvpn|mullvad|surfshark|protonvpn)\\b',
  'i',
)

// Consumer / carrier networks: home and mobile traffic.
const ISP_RE = new RegExp(
  '\\b(comcast|xfinity|verizon|at&t|att|charter|spectrum|cox|t-mobile|tmobile|sprint|vodafone|telecom|telecoms|telekom|'
    + 'telefonica|telef[oó]nica|orange|cable|cablevision|broadband|wireless|communications|centurylink|lumen|frontier|'
    + 'bell canada|rogers|telus|shaw|videotron|bt|sky|virgin|cellular|mobile|mobility|fibre|fiber|internet|isp|telco|telstra|'
    + 'optus|kddi|ntt|softbank|docomo|swisscom|kpn|ziggo|sfr|bouygues|free sas|iliad|jio|airtel|bsnl|windstream|'
    + 'mediacom|altice|optimum|suddenlink|wow!|starlink|hughes|hughesnet|viasat|cableone|sparklight|cricket|'
    + 'us cellular|uscellular|metro by t-mobile|tds telecom|consolidated communications|ziply|rcn|astound|breezeline|midco|'
    + 'silver star|blackfoot|syringa|ptera|cable one|telenor|telia|elisa|proximus|vivo|claro|movistar|'
    + 'rostelecom|beeline|megafon|china (telecom|unicom|mobile)|pldt|globe telecom|singtel|starhub|2degrees|'
    + 'one nz)\\b',
  'i',
)

/** '(unknown)', NULL and '' → unknown; cloud beats isp beats org. */
export function orgKind(name: string | null | undefined): OrgKind {
  if (name === null || name === undefined) return 'unknown'
  const n = name.trim()
  if (n.length === 0 || n === '(unknown)') return 'unknown'
  if (CLOUD_RE.test(n)) return 'cloud'
  if (ISP_RE.test(n)) return 'isp'
  return 'org'
}
