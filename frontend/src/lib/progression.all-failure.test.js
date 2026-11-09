// Each set progresses from the same set last time instead of the whole exercise moving on its
// weakest set: the default, and always with "All sets to failure".
import { describe, it, expect } from 'vitest'
import { nextPrescription, perSetOf, setStallCount, sessionsFor } from './progression.js'
import { applyFailurePlan } from './history.js'
import { buildSessionEntries } from './session-start.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { isWarmupRow } from './workout-model.js'
import { buildPlanBundle, parsePlan, planPrintHTML } from './plan-share.js'

const BENCH = '0025'   // barbell bench press: loaded, 2.5 kg step
const cfg = (over = {}) => ({ id: BENCH, sets: 3, reps: 8, repsMin: 5, weight: 30, prog: 'double', allToFailure: true, ...over })
const session = (d, rows) => ({ d, routineIds: ['r'], entries: [{ id: BENCH, rid: 'r', sets: rows.map(([w, r]) => ({ w, r, done: true })) }] })
const S = (...workouts) => ({ unit: 'kg', routines: [{ id: 'r', name: 'Push', ex: [cfg()] }], workouts })
const R = { id: 'r', ex: [] }
const rows = p => p.rowWeights.map((w, k) => [w, p.rowReps[k]])

describe('each set progresses on its own', () => {
  it('a rep more below the top, a step up and back to the bottom at the top', () => {
    const p = nextPrescription(S(session('2026-11-01', [[30, 5], [27.5, 8], [27.5, 6]])), cfg(), R)
    expect(rows(p)).toEqual([[30, 6], [30, 5], [27.5, 7]])
    expect(p.kind).toBe('up')
    expect(p.why[0]).toBe('Each set on its own: more reps until it reaches {0}, then more weight.')
  })

  it('holds a later set at its own lighter weight, not the first set\'s', () => {
    const p = nextPrescription(S(session('2026-11-01', [[32.5, 5], [30, 6]])), cfg({ sets: 2 }), R)
    expect(rows(p)).toEqual([[32.5, 6], [30, 7]])
    expect(p.kind).toBe('hold')
  })

  it('a set short of the bottom of the range aims at the bottom', () => {
    const p = nextPrescription(S(session('2026-11-01', [[30, 5], [30, 3]])), cfg({ sets: 2 }), R)
    expect(rows(p)).toEqual([[30, 6], [30, 5]])
  })

  describe('to failure, a set never asks for more than the set before it', () => {
    // Sets that all land on one step come back as one weight and reps, the way every rule does.
    const plan = (p, n) => (p.rowWeights ? rows(p) : Array.from({ length: n }, () => [p.weight, p.reps]))

    it('does not raise a later set above an earlier one still building reps', () => {
      const p = nextPrescription(S(session('2026-11-01', [[30, 6], [30, 8]])), cfg({ sets: 2 }), R)
      expect(plan(p, 2)).toEqual([[30, 7], [30, 7]])
    })

    it('does not ask a later set at the same weight for more reps', () => {
      const p = nextPrescription(S(session('2026-11-01', [[30, 6], [30, 7], [27.5, 6]])), cfg(), R)
      expect(rows(p)).toEqual([[30, 7], [30, 7], [27.5, 7]])
    })

    it('a lighter later set may still do more reps', () => {
      const p = nextPrescription(S(session('2026-11-01', [[32.5, 5], [27.5, 7]])), cfg({ sets: 2 }), R)
      expect(rows(p)).toEqual([[32.5, 6], [27.5, 8]])
    })

    it('applies when the sets were marked to failure, even without the switch', () => {
      const marked = { d: '2026-11-01', routineIds: ['r'], entries: [{ id: BENCH, rid: 'r', sets: [[30, 6], [30, 8]].map(([w, r]) => ({ w, r, done: true, failure: true })) }] }
      const plain = cfg({ sets: 2, allToFailure: undefined })
      expect(plan(nextPrescription(S(marked), plain, R), 2)).toEqual([[30, 7], [30, 7]])
      expect(rows(nextPrescription(S(session('2026-11-01', [[30, 6], [30, 8]])), plain, R))).toEqual([[30, 7], [32.5, 5]])
    })
  })

  it('sets that shared a weight and land on the same next step keep the usual reasons', () => {
    const up = nextPrescription(S(session('2026-11-01', [[30, 8], [30, 8]])), cfg({ sets: 2 }), R)
    expect([up.kind, up.weight, up.reps, up.rowWeights]).toEqual(['up', 32.5, 5, undefined])
    expect(up.why[0]).not.toMatch(/Each set on its own/)
    const hold = nextPrescription(S(session('2026-11-01', [[30, 3], [30, 3]])), cfg({ sets: 2 }), R)
    expect([hold.kind, hold.weight, hold.reps, hold.rowWeights]).toEqual(['hold', 30, 5, undefined])
  })

  it('reads a session with more sets than the plan whole, from its top set', () => {
    const p = nextPrescription(S(session('2026-11-01', [[20, 8], [25, 8], [30, 8], [32.5, 8]])), cfg({ sets: 2 }), R)
    expect(p.rowWeights).toBeUndefined()
    expect(p.weight).toBe(35)
  })

  it('a set added to the plan opens where the set before it does', () => {
    const p = nextPrescription(S(session('2026-11-01', [[30, 8], [27.5, 6]])), cfg(), R)
    expect(rows(p)).toEqual([[32.5, 5], [27.5, 7], [27.5, 7]])
  })

  it('under linear, a set at its reps goes up and one short of them holds at those reps', () => {
    const lin = cfg({ prog: 'linear', reps: 6, repsMin: undefined, sets: 2 })
    const p = nextPrescription(S(session('2026-11-01', [[30, 6], [27.5, 4]])), lin, R)
    expect(rows(p)).toEqual([[32.5, 6], [27.5, 6]])
  })

  it('deloads only the set that stood still three sessions running', () => {
    const st = S(
      session('2026-11-01', [[30, 6], [27.5, 5]]),
      session('2026-11-03', [[30, 7], [27.5, 5]]),
      session('2026-11-05', [[30, 7], [27.5, 5]]),
      session('2026-11-07', [[30, 7], [27.5, 5]]),
    )
    const sessions = sessionsFor(st, BENCH, cfg(), 'r')
    expect(setStallCount(sessions, 0, { reps: 8, repsMin: 5 })).toBe(2)
    expect(setStallCount(sessions, 1, { reps: 8, repsMin: 5 })).toBe(3)
    const p = nextPrescription(st, cfg({ sets: 2 }), R)
    expect(p.kind).toBe('deload')
    expect(p.rowWeights[0]).toBe(30)
    expect(p.rowWeights[1]).toBeLessThan(27.5)
    expect(p.rowReps[1]).toBe(5)
    expect(p.why[0]).toBe('A set stuck for {0} sessions goes lighter. The other sets move on their own.')
  })

  it('more reps than before at the same weight is not a stall', () => {
    const st = S(session('2026-11-01', [[30, 5]]), session('2026-11-03', [[30, 6]]), session('2026-11-05', [[30, 7]]))
    expect(setStallCount(sessionsFor(st, BENCH, cfg(), 'r'), 0, { reps: 8, repsMin: 5 })).toBe(0)
  })

  it('moves each set on its own without the switch too, unless the profile moves them together', () => {
    const plain = cfg({ sets: 2, allToFailure: undefined })
    const hist = S(session('2026-11-01', [[32.5, 5], [30, 6]]))
    expect(rows(nextPrescription(hist, plain, R))).toEqual([[32.5, 6], [30, 7]])
    const together = nextPrescription({ ...hist, setsMove: 'together' }, plain, R)
    expect(together.rowWeights).toBeUndefined()
    expect(together.weight).toBe(32.5)
    // The switch still moves its own exercise set by set.
    expect(rows(nextPrescription({ ...hist, setsMove: 'together' }, cfg({ sets: 2 }), R))).toEqual([[32.5, 6], [30, 7]])
  })

  it('is only for linear and double progression, never with back-off sets or a pyramid', () => {
    const plain = cfg({ allToFailure: undefined })
    expect(perSetOf(plain, 'double', 'reps')).toBe(true)
    expect(perSetOf(plain, 'linear', 'reps', {})).toBe(true)
    expect(perSetOf(plain, 'linear', 'reps', { setsMove: 'together' })).toBe(false)
    expect(perSetOf(cfg(), 'linear', 'reps', { setsMove: 'together' })).toBe(true)
    expect(perSetOf(cfg(), 'triple', 'reps')).toBe(false)
    expect(perSetOf(cfg(), 'greyskull', 'reps')).toBe(false)
    expect(perSetOf(cfg({ backoff: true }), 'double', 'reps')).toBe(false)
    expect(perSetOf(cfg({ pyramid: [8, 6, 4] }), 'double', 'reps')).toBe(false)
    expect(perSetOf(cfg(), 'time', 'time')).toBe(false)
  })
})

describe('a session built with the switch', () => {
  const work = e => e.sets.filter(s => !isWarmupRow(s))

  it('opens each set at its own weight and reps, all marked to failure, and reads back the same way', () => {
    const st = S(session('2026-11-01', [[30, 5], [27.5, 8], [27.5, 6]]))
    const [e] = buildSessionEntries(st, st.routines[0])
    expect(work(e).map(s => [s.w, s.r])).toEqual([[30, 6], [30, 5], [27.5, 7]])
    expect(work(e).every(s => s.failure === true)).toBe(true)
    // Logged as planned, the next one moves each set on again.
    const active = { id: 'w2', d: '2026-11-03', start: 2000, routineIds: ['r'], name: 'Push', entries: [{ ...e, sets: e.sets.map(s => ({ ...s, done: true })) }] }
    st.workouts.push(buildCompletedWorkout(active, { end: 3000 }))
    const [next] = buildSessionEntries(st, st.routines[0])
    expect(work(next).map(s => [s.w, s.r])).toEqual([[30, 7], [30, 6], [27.5, 8]])
  })

  it('marks every open work set, never a warm-up or a logged set', () => {
    const out = applyFailurePlan([{ w: 20, r: 5, phase: 'warmup' }, { w: 30, r: 6, done: true }, { w: 30, r: 6 }], { id: BENCH, allToFailure: true })
    expect(out.map(s => !!s.failure)).toEqual([false, false, true])
  })

  it('travels with a shared plan and reads on its printout', () => {
    const st = { unit: 'kg', week: {}, customEx: [], routines: [{ id: 'r1', name: 'Push', ex: [cfg()] }] }
    const bundle = buildPlanBundle(st, 'Plan')
    expect(bundle.routines[0].ex[0].allToFailure).toBe(true)
    expect(parsePlan(JSON.stringify(bundle)).routines[0].ex[0].allToFailure).toBe(true)
    expect(planPrintHTML(st, 'Me')).toContain('All sets to failure')
  })
})
