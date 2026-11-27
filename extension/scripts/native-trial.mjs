// Records a bounded trial on the host while the operator drives the dedicated QA Space.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { isRunAsScript } from './utils/isRunAsScript.mjs'
import {
  controlTrial,
  reportTrials,
  watchTrial,
} from './utils/nativeTrialJournal.mjs'

const HELP = `Usage: node extension/scripts/native-trial.mjs COMMAND [options]
  watch --id ID --cycle N --profile LABEL [--interval SECONDS] [--duration SECONDS]
  plan-stop --id ID                 record intent before issuing a normal stop
  finish --id ID --outcome healthy|disconnected|unknown
  report [--json]                   summarize all trials across cycles
Every command accepts --root DIR. The default is $XDG_STATE_HOME/codebook/native-trials
or ~/.local/state/codebook/native-trials on the host. Use short public labels, never secrets.
Start watch before ordinary QA. When it prints the first sample, the evidence is on the host.
Run QA normally and use finish on completion. Leave watch running through a planned stop.
An unexpectedly stopped VM requires a previously observed running state. The cause is unknown.
Resume a killed observer with the same watch arguments and ID. Deadlines do not reset.`

async function main() {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries(
      [
        'root',
        'id',
        'cycle',
        'profile',
        'interval',
        'duration',
        'outcome',
        'json',
        'help',
      ].map((k) => [
        k,
        { type: ['json', 'help'].includes(k) ? 'boolean' : 'string' },
      ]),
    ),
  })
  if (v.help) return console.log(HELP)
  const [cmd] = positionals
  if (
    positionals.length !== 1 ||
    !['watch', 'plan-stop', 'finish', 'report'].includes(cmd)
  )
    throw new Error(HELP)
  const root =
    v.root ||
    join(
      process.env.XDG_STATE_HOME || join(homedir(), '.local/state'),
      'codebook',
      'native-trials',
    )
  if (cmd === 'report') {
    const result = await reportTrials(root)
    if (v.json) return console.log(JSON.stringify(result, null, 2))
    console.log(
      `Native QA trials: ${result.trials.length}. Unexpected stops have no assigned cause.`,
    )
    for (const g of result.groups)
      console.log(
        `${g.profile} / observed ${g.observed} — ${g.total} trial(s): ${Object.entries(
          g.counts,
        )
          .filter(([, n]) => n)
          .map(([k, n]) => k + ' ' + n)
          .join(', ')} [${g.ids.join(', ')}]`,
      )
    for (const t of result.trials)
      console.log(
        `${t.id} · cycle ${t.cycle} · ${t.outcome} · ${t.samples} samples · peaks ${JSON.stringify(t.peakProcesses)} · pressure ${t.pressures.join('/') || 'unknown'} · used swap ${t.minUsedSwapMb ?? '?'}–${t.maxUsedSwapMb ?? '?'} MiB`,
      )
    return
  }
  if (cmd !== 'watch')
    return console.log(
      JSON.stringify(await controlTrial(root, v.id, cmd, v.outcome)),
    )
  const controller = new AbortController()
  for (const sig of ['SIGTERM', 'SIGINT'])
    process.once(sig, () => controller.abort())
  console.log(
    JSON.stringify(
      await watchTrial(root, v, {
        signal: controller.signal,
        note: (row) => console.log(JSON.stringify(row)),
      }),
    ),
  )
}

if (isRunAsScript(import.meta.url))
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
