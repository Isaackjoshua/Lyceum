import { randomBytes } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import type { ExportResult } from '@shared/types.js'
import { buildHtml, escapeHtml, type PdfDocument } from './render.js'

/**
 * Renders a document in a hidden BrowserWindow and prints it to PDF.
 *
 * The window is fully isolated: no preload, no node, JavaScript disabled, and
 * the HTML is self-contained (fonts inlined), so nothing is fetched.
 */
async function printToPdf(doc: PdfDocument): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      javascript: false,
      images: true
    }
  })

  // Written to a scratch file rather than a data: URL. The document carries
  // ~250KB of inlined font data before any content, and percent-encoding it
  // inflates that further — long study guides would run into the navigation
  // size limit and fail as an unexplained blank page.
  const scratch = join(app.getPath('temp'), `lyceum-print-${randomBytes(8).toString('hex')}.html`)

  try {
    await writeFile(scratch, buildHtml(doc), { encoding: 'utf8', mode: 0o600 })
    await window.loadFile(scratch)
    // Give the layout engine a beat to settle the inlined webfonts.
    await new Promise((resolve) => setTimeout(resolve, 350))

    return await window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-size:8pt;color:#8a8a8a;
         font-family:ui-sans-serif,system-ui,sans-serif;padding:0 18mm;
         display:flex;justify-content:space-between;">
         <span>${escapeHtml(doc.title)}</span>
         <span class="pageNumber"></span>
       </div>`
    })
  } finally {
    window.destroy()
    await rm(scratch, { force: true }).catch(() => {
      // A leftover temp file is not worth failing an export over.
    })
  }
}

/** Prompts for a location and writes the PDF there. */
export async function savePdf(
  doc: PdfDocument,
  suggestedName: string,
  parent?: BrowserWindow
): Promise<ExportResult> {
  const buffer = await printToPdf(doc)

  const options = {
    title: 'Export study guide',
    defaultPath: suggestedName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  }
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)

  if (result.canceled || !result.filePath) return { saved: false, path: null }

  await writeFile(result.filePath, buffer)
  return { saved: true, path: result.filePath }
}

/** Filesystem-safe filename stem. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'lyceum-export'
  )
}
