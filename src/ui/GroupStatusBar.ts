import * as vscode from 'vscode';
import { GroupStatusBarState } from './GroupStatusBarTypes';

/**
 * Status bar item showing `🔗 <group>` when this window belongs to a group.
 *
 *     const sb = GroupStatusBar.create();
 *     sb.color('#7aa2f7').update({ group: 'acme-app', branch: 'main' });
 *
 * When `group` is empty, the item hides itself.
 */
export class GroupStatusBar {
    private item: vscode.StatusBarItem;
    private _color: string | undefined;

    private constructor(item: vscode.StatusBarItem) {
        this.item = item;
    }

    static create(): GroupStatusBar {
        const item = vscode.window.createStatusBarItem(
            'branchBuddy.group',
            vscode.StatusBarAlignment.Left,
            1000,
        );
        item.name = 'Branch Sync group';
        item.command = 'branchBuddy.showStatus';
        return new GroupStatusBar(item);
    }

    color(v: string | undefined): this {
        this._color = v;
        this.item.color = v;
        return this;
    }

    update(state: GroupStatusBarState): this {
        if (!state.group) {
            this.item.hide();
            return this;
        }
        this.item.text = `$(link) ${state.group}`;
        const tooltip = new vscode.MarkdownString(
            `**Branch Sync group:** \`${state.group}\`\n\n` +
                `Current branch: \`${state.branch ?? '<unknown>'}\`\n\n` +
                `Click to see the status of every registered instance.`,
        );
        tooltip.isTrusted = false;
        this.item.tooltip = tooltip;
        this.item.color = this._color;
        this.item.show();
        return this;
    }

    dispose(): void {
        this.item.dispose();
    }
}
