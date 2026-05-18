export enum TrackingMode {
    FirstWorkspaceFolder = 'firstWorkspaceFolder',
    AllWorkspaceFolders = 'allWorkspaceFolders',
}

export interface ConfigOptions {
    group?: string;
    color?: string;
    foreground?: string;
    groupColor?: string;
    heartbeatMs?: number;
    staleMs?: number;
    trackingMode?: TrackingMode;
}
