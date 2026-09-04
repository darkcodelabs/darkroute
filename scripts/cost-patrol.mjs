#!/usr/bin/env node
/**
 * Cost patrol - a budget circuit breaker for DarkRoute.
 *
 * Cloudflare does not offer a hard spend cap on Workers. Usage-based billing
 * runs until the month ends or somebody stops it. For a product that is
 * expected to be attacked, "somebody" cannot mean a human noticing a dashboard.
 *
 * This reads month-to-date usage from Cloudflare's GraphQL Analytics API,
 * prices it against the published rate card, and escalates through three
 * tiers. It is designed to run on a schedule from GitHub Actions rather than
 * from a Worker, because a watchdog for runaway Workers must not itself be a
 * Worker.
 *
 * TIERS (defaults; override with env)
 *   WARN     $25   report loudly, change nothing
 *   DEGRADE  $75   zone security level -> under_attack. Bots and scripted
 *                  traffic are challenged at the edge and never reach a
 *                  Worker, so they stop costing anything. Humans get through.
 *   CRITICAL $125  keep the zone under attack mode, suspend Neon when
 *                  configured, and fail loudly for manual Pages/R2 response.
 *
 * The critical tier sits well below the $200 ceiling on purpose. Polling is not
 * continuous, so the gap between runs has to be affordable - see "the honest
 * limitation" at the bottom of this file.
 *
 * WHY THERE IS NO AUTOMATIC PAGES KILL
 * Pages Functions are attached to the Pages project, not zone Worker routes.
 * Deleting zone routes does not stop them, verified against the live account
 * on 2026-09-01. Deleting a Pages project or its custom domain automatically
 * would be a destructive recovery mechanism and could also remove the static
 * offline shell. The critical tier therefore challenges traffic, performs the
 * independently configured Neon suspension, and raises a failing alert that
 * says exactly what remains live.
 *
 * NEVER AUTO-RECOVERS. Re-arming is a deliberate human act (`--rearm`).
 * Automatic recovery into an ongoing attack just re-spends the budget.
 *
 * Usage:
 *   node scripts/cost-patrol.mjs                 # report only, exit 0
 *   node scripts/cost-patrol.mjs --execute       # act on the tier reached
 *   node scripts/cost-patrol.mjs --json          # machine-readable
 *   node scripts/cost-patrol.mjs --rearm --execute
 *
 * Required env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_ID
 * Optional env: NEON_API_KEY, NEON_PROJECT_ID
 *               FWM_WARN_USD, FWM_DEGRADE_USD, FWM_KILL_USD, FWM_CEILING_USD
 */

const API = 'https://api.cloudflare.com/client/v4'

// ---------------------------------------------------------------------------
// Rate card. Confirmed from Cloudflare's published pricing on 2026-08-20 and
// from the Workers Paid purchase confirmation. If Cloudflare changes these,
// this file is wrong and the patrol under-reports - re-check on plan changes.
// ---------------------------------------------------------------------------

const RATES = {
  baseUsd: 5.0,
  workers: { includedRequests: 10_000_000, usdPerMillion: 0.3 },
  doRequests: { included: 1_000_000, usdPerMillion: 0.15 },
  // activeTime is reported in microseconds. Duration is billed in GB-s, and a
  // Durable Object is metered at 128 MB.
  doDuration: { includedGbS: 400_000, usdPerMillionGbS: 12.5, memoryGb: 128 / 1024 },
}

const args = new Set(process.argv.slice(2))
const EXECUTE = args.has('--execute')
const JSON_OUT = args.has('--json')
const REARM = args.has('--rearm')

const env = (k, fallback) => process.env[k] ?? fallback
const THRESHOLDS = {
  warn: Number(env('FWM_WARN_USD', '25')),
  degrade: Number(env('FWM_DEGRADE_USD', '75')),
  // FWM_KILL_USD is retained as the deployed configuration name. The action
  // is now honestly called critical because it cannot stop Pages Functions.
  critical: Number(env('FWM_KILL_USD', '125')),
  ceiling: Number(env('FWM_CEILING_USD', '200')),
}

const TOKEN = env('CLOUDFLARE_API_TOKEN')
const ACCOUNT = env('CLOUDFLARE_ACCOUNT_ID')
const ZONE = env('CLOUDFLARE_ZONE_ID')
const NEON_KEY = env('NEON_API_KEY')
const NEON_PROJECT = env('NEON_PROJECT_ID')

function fail(message) {
  console.error(`cost-patrol: ${message}`)
  process.exit(2)
}

if (!TOKEN || !ACCOUNT || !ZONE) {
  fail('CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_ZONE_ID are all required')
}
if (!/^[0-9a-f]{32}$/.test(ACCOUNT) || !/^[0-9a-f]{32}$/.test(ZONE)) {
  fail('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_ZONE_ID must be 32-character lowercase hex ids')
}
if (Boolean(NEON_KEY) !== Boolean(NEON_PROJECT)) {
  fail('NEON_API_KEY and NEON_PROJECT_ID must be configured together')
}
if (NEON_PROJECT && !/^[a-z0-9-]{1,128}$/.test(NEON_PROJECT)) {
  fail('NEON_PROJECT_ID has an invalid shape')
}
if (
  !Object.values(THRESHOLDS).every((value) => Number.isFinite(value) && value >= 0) ||
  !(THRESHOLDS.warn < THRESHOLDS.degrade) ||
  !(THRESHOLDS.degrade < THRESHOLDS.critical) ||
  !(THRESHOLDS.critical < THRESHOLDS.ceiling)
) {
  fail(
    'cost thresholds must be finite, non-negative, and ordered warn < degrade < critical < ceiling',
  )
}

async function cf(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!body.success) {
    const detail = (body.errors ?? []).map((e) => e.message).join('; ') || `HTTP ${res.status}`
    throw new Error(`${path}: ${detail}`)
  }
  return body.result
}

/** First instant of the current UTC billing month. */
function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

async function usage() {
  const since = monthStart()
  const query = `query {
    viewer {
      accounts(filter: { accountTag: "${ACCOUNT}" }) {
        workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: "${since}" }) {
          sum { requests errors }
        }
        durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: "${since}" }) {
          sum { requests }
        }
        durableObjectsPeriodicGroups(limit: 10000, filter: { datetime_geq: "${since}" }) {
          sum { activeTime }
        }
      }
    }
  }`

  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await res.json().catch(() => {
    throw new Error(`graphql: HTTP ${String(res.status)} returned non-JSON`)
  })
  if (!res.ok) throw new Error(`graphql: HTTP ${String(res.status)}`)
  if (body.errors) throw new Error(`graphql: ${body.errors.map((e) => e.message).join('; ')}`)

  const accounts = body.data?.viewer?.accounts
  if (!Array.isArray(accounts) || accounts.length !== 1) {
    throw new Error('graphql: expected exactly one account result')
  }
  const account = accounts[0]
  const total = (rows, pick, label) => {
    if (!Array.isArray(rows)) throw new Error(`graphql: ${label} is not an array`)
    return rows.reduce((sum, row) => {
      const value = pick(row)
      if (value === undefined || value === null) return sum
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`graphql: ${label} contains an invalid sum`)
      }
      return sum + value
    }, 0)
  }

  return {
    since,
    workerRequests: total(
      account.workersInvocationsAdaptive,
      (r) => r.sum?.requests,
      'workersInvocationsAdaptive',
    ),
    workerErrors: total(
      account.workersInvocationsAdaptive,
      (r) => r.sum?.errors,
      'workersInvocationsAdaptive',
    ),
    doRequests: total(
      account.durableObjectsInvocationsAdaptiveGroups,
      (r) => r.sum?.requests,
      'durableObjectsInvocationsAdaptiveGroups',
    ),
    doActiveTimeUs: total(
      account.durableObjectsPeriodicGroups,
      (r) => r.sum?.activeTime,
      'durableObjectsPeriodicGroups',
    ),
  }
}

function price(u) {
  const over = (used, included) => Math.max(0, used - included)

  const workersUsd =
    (over(u.workerRequests, RATES.workers.includedRequests) / 1e6) * RATES.workers.usdPerMillion
  const doReqUsd =
    (over(u.doRequests, RATES.doRequests.included) / 1e6) * RATES.doRequests.usdPerMillion

  const gbSeconds = (u.doActiveTimeUs / 1e6) * RATES.doDuration.memoryGb
  const doDurUsd =
    (over(gbSeconds, RATES.doDuration.includedGbS) / 1e6) * RATES.doDuration.usdPerMillionGbS

  const variable = workersUsd + doReqUsd + doDurUsd
  return {
    gbSeconds,
    workersUsd,
    doReqUsd,
    doDurUsd,
    variableUsd: variable,
    totalUsd: RATES.baseUsd + variable,
  }
}

/** Linear month-end projection from elapsed fraction of the month. */
function project(totalUsd) {
  const now = new Date()
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  const elapsed = (now.getTime() - start) / (end - start)
  if (elapsed <= 0) return totalUsd
  const variable = totalUsd - RATES.baseUsd
  return RATES.baseUsd + variable / elapsed
}

function tierFor(usd) {
  if (usd >= THRESHOLDS.critical) return 'critical'
  if (usd >= THRESHOLDS.degrade) return 'degrade'
  if (usd >= THRESHOLDS.warn) return 'warn'
  return 'ok'
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function setSecurityLevel(value) {
  await cf(`/zones/${ZONE}/settings/security_level`, {
    method: 'PATCH',
    body: JSON.stringify({ value }),
  })
  return `zone security_level -> ${value}`
}

async function suspendNeon() {
  if (!NEON_KEY || !NEON_PROJECT) {
    return 'neon: skipped (NEON_API_KEY / NEON_PROJECT_ID not set)'
  }

  const res = await fetch(`https://console.neon.tech/api/v2/projects/${NEON_PROJECT}/endpoints`, {
    headers: { Authorization: `Bearer ${NEON_KEY}` },
  })
  if (!res.ok) throw new Error(`neon endpoint inventory failed (HTTP ${String(res.status)})`)
  const body = await res.json().catch(() => {
    throw new Error('neon endpoint inventory returned non-JSON')
  })
  if (!Array.isArray(body.endpoints))
    throw new Error('neon endpoint inventory has no endpoints array')
  const endpoints = body.endpoints
  const done = []
  for (const ep of endpoints) {
    if (typeof ep?.id !== 'string' || !/^[a-z0-9-]{1,128}$/.test(ep.id)) {
      throw new Error('neon endpoint inventory contains an invalid endpoint id')
    }
    const r = await fetch(
      `https://console.neon.tech/api/v2/projects/${NEON_PROJECT}/endpoints/${ep.id}/suspend`,
      { method: 'POST', headers: { Authorization: `Bearer ${NEON_KEY}` } },
    )
    done.push(`${ep.id}:${r.ok ? 'suspended' : `failed(${String(r.status)})`}`)
  }
  return done.length > 0 ? `neon endpoints ${done.join(', ')}` : 'neon: no endpoints found'
}

async function act(tier) {
  const done = []
  if (tier === 'degrade' || tier === 'critical') {
    done.push(await setSecurityLevel('under_attack'))
  }
  if (tier === 'critical') {
    done.push(await suspendNeon())
    done.push(
      'CRITICAL: Pages Functions and R2 remain live; inspect Cloudflare usage and disable the affected Pages deployment or binding manually',
    )
  }
  return done
}

async function rearm() {
  const done = [await setSecurityLevel('medium')]
  done.push('neon compute resumes on its next connection; no action needed')
  return done
}

// ---------------------------------------------------------------------------

async function main() {
  if (REARM) {
    if (!EXECUTE) {
      console.log('cost-patrol: --rearm requires --execute. Nothing changed.')
      return
    }
    for (const line of await rearm()) console.log(`  re-armed: ${line}`)
    return
  }

  const u = await usage()
  const cost = price(u)
  const projected = project(cost.totalUsd)
  const tier = tierFor(cost.totalUsd)
  const projectedTier = tierFor(projected)

  const report = {
    since: u.since,
    usage: u,
    cost,
    projectedMonthEndUsd: projected,
    thresholds: THRESHOLDS,
    tier,
    projectedTier,
    executed: [],
  }

  if (EXECUTE && tier !== 'ok') report.executed = await act(tier)

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    const money = (n) => `$${n.toFixed(2)}`
    console.log(`cost-patrol - month to date since ${u.since}`)
    console.log(
      `  worker requests   ${u.workerRequests.toLocaleString()}  -> ${money(cost.workersUsd)}`,
    )
    console.log(`  DO requests       ${u.doRequests.toLocaleString()}  -> ${money(cost.doReqUsd)}`)
    console.log(
      `  DO duration       ${Math.round(cost.gbSeconds).toLocaleString()} GB-s  -> ${money(cost.doDurUsd)}`,
    )
    console.log(`  base plan         ${money(RATES.baseUsd)}`)
    console.log(`  TOTAL             ${money(cost.totalUsd)}   (tier: ${tier})`)
    console.log(`  projected month-end  ${money(projected)}   (tier: ${projectedTier})`)
    console.log(
      `  thresholds        warn ${money(THRESHOLDS.warn)} / degrade ${money(THRESHOLDS.degrade)} / critical ${money(THRESHOLDS.critical)} / ceiling ${money(THRESHOLDS.ceiling)}`,
    )
    for (const line of report.executed) console.log(`  ACTION: ${line}`)
    if (!EXECUTE && tier !== 'ok') console.log('  (report only - pass --execute to act)')
  }

  // Non-zero exit makes the scheduled job fail, which is the notification.
  if (tier === 'critical') process.exit(1)
  if (tier === 'degrade' || projectedTier === 'critical') process.exit(1)
  if (tier === 'warn') process.exit(0)
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))

/*
 * THE HONEST LIMITATION
 *
 * This is a poller, not a hard cap. Cloudflare has no hard cap to set, so spend
 * between two runs is unbounded in principle. What bounds it in practice:
 *
 *   - Cloudflare's L3/L4/L7 DDoS mitigation is unmetered and automatic, and
 *     requests it drops never become billable Worker invocations.
 *   - Requests blocked at the edge - by the challenge that `under_attack` puts
 *     up, or by a WAF rule - do not invoke a Worker and do not bill.
 *   - The critical threshold is set at $125 against a $200 ceiling, so the
 *     alert has $75 of nominal headroom for manual response.
 *
 * Rough worst case at the Workers rate: sustained 10k req/s that survives every
 * edge defence costs about $5.40 over 30 minutes; 100k req/s costs about $54.
 * A sustained 100k req/s that Cloudflare's own DDoS protection does not touch
 * is not a realistic scenario for this application, but neither this estimate
 * nor the threshold is a hard cap. R2 operations are not priced by this script.
 *
 * To tighten further, in order of value:
 *   1. Mint a token with WAF/rate-limiting permissions and add per-IP rate
 *      limiting rules. This bounds the burn rate by construction rather than by
 *      polling, and it is the single biggest improvement available.
 *   2. Run this every 5 minutes instead of 30.
 *   3. Add a Worker-side counter that trips itself off, accepting that the
 *      counter itself costs a fraction of a request to maintain.
 */
