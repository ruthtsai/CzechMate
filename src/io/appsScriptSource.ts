import scriptSource from './appsScript.gs?raw';
import { DEFAULT_IMAGE_FOLDER, normalizeFolderPath } from './sheetsClient';

// The Apps Script source is only needed on the Google 試算表 settings screen, so it stays out of the main bundle.

/** The script to paste into the spreadsheet, with this phone's secret and image folder filled in. */
export const buildAppsScript = (secret: string, imageFolder = DEFAULT_IMAGE_FOLDER) =>
  scriptSource
    .replace('__CZECHMATE_SECRET__', () => secret.replace(/\\/g, '\\\\').replace(/'/g, "\\'"))
    // The path goes inside a single-quoted string in the script.
    .replace('__CZECHMATE_IMAGE_FOLDER__', () => normalizeFolderPath(imageFolder).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
