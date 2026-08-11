import { app } from 'electron'

/**
 * Pins the application name, and therefore `app.getPath('userData')`.
 *
 * Electron otherwise derives the name from whichever package.json it finds
 * first, which varies with how the process was launched. Anything that reads
 * userData — above all the database — would then resolve a different directory
 * and the learner's curricula would appear to vanish.
 *
 * This lives in its own module, imported for its side effect by both the app
 * entry point and the database layer, so the path is deterministic no matter
 * which one runs first. Setting it in the entry point alone was fragile: a
 * second entry point (a tool, a test harness) silently got its own database.
 */
export const APP_NAME = 'Lyceum'

// Guarded because this module is pulled in transitively by code under unit
// test, where `electron` resolves to a stub and there is no `app` object.
// Failing to set the name there is harmless; throwing would not be.
if (typeof app?.setName === 'function') app.setName(APP_NAME)
