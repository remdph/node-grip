import { registerAppIpc } from './app.js';
import { registerDatasourceIpc } from './datasource.js';
import { registerProjectIpc } from './project.js';
import { registerSettingsIpc } from './settings.js';
import { registerShellIpc } from './shell.js';
import { registerWindowIpc } from './window.js';

export function registerAllIpc(): void {
  registerAppIpc();
  registerWindowIpc();
  registerProjectIpc();
  registerDatasourceIpc();
  registerShellIpc();
  registerSettingsIpc();
}
