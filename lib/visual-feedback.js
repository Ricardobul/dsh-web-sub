/**
 * visual-feedback.js — Pillar 1: Electronic Eye & Real-Time Visual Feedback Loop
 *
 * Implements low-latency viewport frame extraction and streaming for multimodal
 * agents (Gemini 4 Argon, Claude 3.7 / 3.5 Sonnet).
 *
 * Capabilities:
 *   1. Viewport snapshot extraction: captures active frame in compressed WebP / JPEG.
 *   2. Safe-area overlay injection: marks 880px central column (9:16) for visual inspection.
 *   3. Zero-delay feedback: embeds visual context directly into agent tool responses.
 *   4. Headless SVG/Canvas fallback: renders a synthetic preview when editor is minimized.
 *
 * @module dsh-web-sub/visual-feedback
 */

/**
 * Global cache of the latest viewport frame.
 */
let latestFrameCache = {
  timestamp: null,
  format: 'image/jpeg',
  width: 1080,
  height: 1920,
  base64Data: null,
  source: 'none',
}

/**
 * Update the latest cached viewport frame.
 *
 * @param {{
 *   base64Data: string,
 *   format?: 'image/jpeg' | 'image/webp' | 'image/png',
 *   width?: number,
 *   height?: number,
 *   source?: string
 * }} frame
 */
export function setLatestFrame({ base64Data, format = 'image/jpeg', width = 1080, height = 1920, source = 'viewport' }) {
  latestFrameCache = {
    timestamp: new Date().toISOString(),
    format,
    width,
    height,
    base64Data,
    source,
  }
}

/**
 * Get the latest cached viewport frame.
 * @returns {typeof latestFrameCache}
 */
export function getLatestFrame() {
  return { ...latestFrameCache }
}

/**
 * Generate a synthetic SVG preview frame based on timeline elements and safe areas.
 * Useful for headless or background execution when no physical GPU window is rendering.
 *
 * @param {object} timeline
 * @param {{includeSafeOverlay?: boolean}} [options]
 * @returns {string} base64 encoded JPEG or SVG data
 */
export function generateSyntheticPreview(timeline, options = {}) {
  const width = timeline?.resolution?.width || 1080
  const height = timeline?.resolution?.height || 1920
  const safeCol = 880
  const safeMarginX = (width - safeCol) / 2 // 100px for 1080px width
  const topSafe = 180
  const bottomSafe = 240

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <!-- Background -->
  <rect width="${width}" height="${height}" fill="#0f172a"/>
  
  <!-- Safe-Area Guide (880px central column) -->
  <rect x="${safeMarginX}" y="${topSafe}" width="${safeCol}" height="${height - topSafe - bottomSafe}" 
        fill="none" stroke="#38bdf8" stroke-width="2" stroke-dasharray="8 6" opacity="0.6"/>
  
  <!-- Safe-Area Header & Footer Warnings -->
  <rect x="0" y="0" width="${width}" height="${topSafe}" fill="#ef4444" opacity="0.08"/>
  <rect x="0" y="${height - bottomSafe}" width="${width}" height="${bottomSafe}" fill="#ef4444" opacity="0.08"/>
  
  <text x="${width / 2}" y="100" font-family="system-ui, sans-serif" font-size="28" font-weight="600" fill="#94a3b8" text-anchor="middle">
    HUD Danger Zone (Top ${topSafe}px)
  </text>
  <text x="${width / 2}" y="${height - 100}" font-family="system-ui, sans-serif" font-size="28" font-weight="600" fill="#94a3b8" text-anchor="middle">
    Native UI Danger Zone (Bottom ${bottomSafe}px)
  </text>
  
  <!-- Center Column Label -->
  <text x="${width / 2}" y="${height / 2}" font-family="system-ui, sans-serif" font-size="36" font-weight="bold" fill="#38bdf8" text-anchor="middle" opacity="0.5">
    Safe Column: ${safeCol}px
  </text>
</svg>`

  const base64 = Buffer.from(svg).toString('base64')
  return `data:image/svg+xml;base64,${base64}`
}

/**
 * Build a visual feedback payload ready to attach to an agent tool response.
 *
 * @param {object} [options]
 * @returns {object}
 */
export function buildVisualFeedbackPayload(options = {}) {
  const current = getLatestFrame()
  if (current.base64Data) {
    return {
      hasVisualFrame: true,
      timestamp: current.timestamp,
      format: current.format,
      dimensions: { width: current.width, height: current.height },
      safeAreaColumnPx: 880,
      frameUrl: `data:${current.format};base64,${current.base64Data}`,
    }
  }

  // Fallback to synthetic preview if no physical frame was captured yet
  const fallbackUrl = generateSyntheticPreview(options.timeline)
  return {
    hasVisualFrame: true,
    timestamp: new Date().toISOString(),
    format: 'image/svg+xml',
    dimensions: { width: 1080, height: 1920 },
    safeAreaColumnPx: 880,
    frameUrl: fallbackUrl,
    note: 'Synthetic safe-area preview guide (physical viewport pending)',
  }
}
