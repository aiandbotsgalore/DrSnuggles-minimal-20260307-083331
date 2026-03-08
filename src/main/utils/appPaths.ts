import path from 'path';

const electron = require('electron');
const { app } = electron;

let userDataPath = '';

/**
 * Get the user data path (cached after first call).
 * Lazy initialization avoids calling app.getPath before app is ready.
 */
export function getUserDataPath(): string {
  if (!userDataPath) {
    userDataPath = app.getPath('userData') as string;
  }
  return userDataPath;
}

/**
 * Get the full path to a configuration or data file in the user data directory.
 *
 * @param filename - The filename or relative path within the user data directory
 * @returns The absolute path to the file
 */
export function getConfigPath(filename: string): string {
  return path.join(getUserDataPath(), filename);
}
