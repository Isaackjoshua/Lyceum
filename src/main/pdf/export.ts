import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog } from 'electron'
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

  try {
    const html = buildHtml(doc)
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    )
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
