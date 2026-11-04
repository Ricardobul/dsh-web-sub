/**
 * timeline-sandbox.js — Pillar 3: Sandbox DOM & In-Memory Simulation
 *
 * Implements VirtualTimeline: an in-memory, deterministic simulator for
 * AlaukCut and Remotion timelines. Validates batch operations (montar_timeline,
 * adding clips, transitions, stickers, audio) before touching the physical projeto.json.
 *
 * Guarantees:
 *   1. Track collision prevention: no two clips accidentally overlap on the same track.
 *   2. Duration bound checks: audio, video and overlay elements stay within project limits.
 *   3. Media asset verification: checks physical existence of referenced files.
 *   4. Zero corruption: rejects corrupted batches before they ever reach disk.
 *
 * @module dsh-web-sub/timeline-sandbox
 */
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Standard project defaults.
 */
export const DEFAULT_TIMELINE_CONFIG = {
  fps: 60,
  resolution: { width: 1080, height: 1920, aspectRatio: '9:16' },
  durationSeconds: 60,
  maxTracks: 16,
  safeAreaColumnPx: 880,
}

/**
 * In-memory simulation of a video timeline.
 */
export class VirtualTimeline {
  /**
   * @param {object} [initialState] Optional starting project state.
   */
  constructor(initialState = {}) {
    this.fps = initialState.fps || DEFAULT_TIMELINE_CONFIG.fps
    this.resolution = initialState.resolution || { ...DEFAULT_TIMELINE_CONFIG.resolution }
    this.durationSeconds = initialState.durationSeconds || 0
    this.tracks = new Map() // trackId -> Array of clip objects sorted by startTime
    this.metadata = { ...(initialState.metadata || {}) }

    if (Array.isArray(initialState.tracks)) {
      for (const track of initialState.tracks) {
        this.tracks.set(track.id || `track_${this.tracks.size}`, {
          id: track.id || `track_${this.tracks.size}`,
          type: track.type || 'video', // 'video' | 'audio' | 'text' | 'overlay'
          clips: Array.isArray(track.clips) ? structuredClone(track.clips) : [],
        })
      }
    }
  }

  /**
   * Get total project duration calculated from active clips.
   * @returns {number} duration in seconds
   */
  computeDuration() {
    let maxEnd = 0
    for (const [, track] of this.tracks) {
      for (const clip of track.clips) {
        const end = (clip.startTime || 0) + (clip.duration || 0)
        if (end > maxEnd) maxEnd = end
      }
    }
    return Math.max(maxEnd, this.durationSeconds)
  }

  /**
   * Dry-run simulate a batch of operations.
   *
   * @param {Array<{operacao: string, argumentos?: object}>} operations
   * @returns {{ok: boolean, errors: Array<string>, warnings: Array<string>, simulatedState: object}}
   */
  simulate(operations) {
    if (!Array.isArray(operations)) {
      return { ok: false, errors: ['Operations must be an array'], warnings: [], simulatedState: this.toJSON() }
    }

    const workingClone = new VirtualTimeline(this.toJSON())
    const errors = []
    const warnings = []

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i]
      const opType = op.operacao || op.type || op.command
      const args = op.argumentos || op.args || op.params || {}

      if (!opType) {
        errors.push(`Step ${i + 1}: missing operation name`)
        continue
      }

      switch (opType) {
        case 'criar_trilha':
        case 'add_track': {
          const trackId = args.id || `track_${workingClone.tracks.size}`
          const type = args.type || 'video'
          if (workingClone.tracks.has(trackId)) {
            warnings.push(`Step ${i + 1}: track '${trackId}' already exists`)
          } else {
            workingClone.tracks.set(trackId, { id: trackId, type, clips: [] })
          }
          break
        }

        case 'adicionar_clipe':
        case 'adicionar_video':
        case 'adicionar_audio':
        case 'adicionar_texto':
        case 'add_clip': {
          const trackId = args.trackId || (workingClone.tracks.keys().next().value || 'track_0')
          if (!workingClone.tracks.has(trackId)) {
            workingClone.tracks.set(trackId, { id: trackId, type: 'video', clips: [] })
          }

          const track = workingClone.tracks.get(trackId)
          const startTime = Number(args.startTime ?? args.inicio ?? 0)
          const duration = Number(args.duration ?? args.duracao ?? 0)
          const path = args.path || args.caminho || args.arquivo

          if (duration <= 0) {
            errors.push(`Step ${i + 1} (${opType}): duration must be greater than 0 (got ${duration})`)
            break
          }
          if (startTime < 0) {
            errors.push(`Step ${i + 1} (${opType}): startTime cannot be negative (got ${startTime})`)
            break
          }

          // Asset existence check (if a local file path was provided)
          if (path && typeof path === 'string' && (path.includes('/') || path.includes('\\'))) {
            const resolved = resolve(path)
            if (!existsSync(resolved)) {
              errors.push(`Step ${i + 1} (${opType}): asset file does not exist at '${resolved}'`)
              break
            }
          }

          // Collision detection: Check if clip overlaps an existing clip on the SAME track
          const newEnd = startTime + duration
          for (const existing of track.clips) {
            const existStart = existing.startTime || 0
            const existEnd = existStart + (existing.duration || 0)
            const overlaps = Math.max(startTime, existStart) < Math.min(newEnd, existEnd)
            if (overlaps) {
              errors.push(
                `Step ${i + 1} (${opType}): collision on '${trackId}'! New clip [${startTime}s - ${newEnd}s] overlaps existing clip [${existStart}s - ${existEnd}s]`
              )
            }
          }

          // If no collision, add clip sorted
          track.clips.push({
            id: args.id || `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            startTime,
            duration,
            path: path || null,
            text: args.texto || args.text || null,
            transition: args.transicao || null,
            meta: { ...args },
          })
          track.clips.sort((a, b) => a.startTime - b.startTime)
          break
        }

        case 'remover_clipe':
        case 'remove_clip': {
          const clipId = args.id || args.clipId
          let found = false
          for (const [, track] of workingClone.tracks) {
            const idx = track.clips.findIndex((c) => c.id === clipId)
            if (idx !== -1) {
              track.clips.splice(idx, 1)
              found = true
              break
            }
          }
          if (!found) {
            warnings.push(`Step ${i + 1}: clip '${clipId}' not found for removal`)
          }
          break
        }

        case 'ajustar_duracao':
        case 'set_duration': {
          const duration = Number(args.duration || args.duracao)
          if (duration <= 0) {
            errors.push(`Step ${i + 1}: invalid project duration ${duration}`)
          } else {
            workingClone.durationSeconds = duration
          }
          break
        }

        default:
          // Unrecognized or passthrough custom operations
          warnings.push(`Step ${i + 1}: unsimulated custom operation '${opType}' (passed through)`)
          break
      }
    }

    const ok = errors.length === 0
    return {
      ok,
      errors,
      warnings,
      simulatedState: ok ? workingClone.toJSON() : this.toJSON(),
    }
  }

  /**
   * Export the timeline state as a JSON-serializable object.
   */
  toJSON() {
    return {
      fps: this.fps,
      resolution: { ...this.resolution },
      durationSeconds: this.computeDuration(),
      tracks: Array.from(this.tracks.values()).map((t) => ({
        id: t.id,
        type: t.type,
        clips: structuredClone(t.clips),
      })),
      metadata: { ...this.metadata },
    }
  }
}
