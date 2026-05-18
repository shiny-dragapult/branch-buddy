import type * as vscode from 'vscode';
import type { Config } from '../config/Config';

export interface LocalEntry {
    id: string;
    uri: vscode.Uri | undefined;
    workspace: string;
    branch: string | null;
    cfg: Config;
}
