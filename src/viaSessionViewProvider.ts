import { basename } from "node:path";
import * as vscode from "vscode";
import { t } from "./i18n";
import { ListedWorkspace, ViaRunner } from "./viaRunner";

export class ViaSessionViewProvider implements vscode.TreeDataProvider<ViaSessionTreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<ViaSessionTreeItem | undefined>();

  readonly onDidChangeTreeData: vscode.Event<ViaSessionTreeItem | undefined> = this.changeEmitter.event;

  constructor(private readonly runner: ViaRunner) {}

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  async getChildren(element?: ViaSessionTreeItem): Promise<ViaSessionTreeItem[]> {
    if (element) {
      if (element.session) {
        return [ViaSessionTreeItem.workspace(element.session)];
      }

      return [];
    }

    const sessions = await this.runner.listSessions();
    if (sessions.length === 0) {
      return [ViaSessionTreeItem.empty()];
    }

    const current = this.runner.getCurrentSession(sessions);
    return sessions.map((session) => ViaSessionTreeItem.session(
      session,
      Boolean(current && current.instanceName === session.instanceName),
    ));
  }

  getTreeItem(element: ViaSessionTreeItem): vscode.TreeItem {
    return element;
  }
}

export class ViaSessionTreeItem extends vscode.TreeItem {
  private constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    readonly session?: ListedWorkspace,
  ) {
    super(label, collapsibleState);
  }

  static session(session: ListedWorkspace, isCurrent: boolean): ViaSessionTreeItem {
    const label = session.instanceName;
    const item = new ViaSessionTreeItem(label, vscode.TreeItemCollapsibleState.Collapsed, session);
    item.description = [session.status, isCurrent ? t("label.current") : ""].filter(Boolean).join(" - ");
    item.tooltip = [
      `${t("label.instance")}: ${session.instanceName}`,
      `${t("label.workspace")}: ${session.workspacePath || t("session.workspaceUnavailable")}`,
      session.status ? `${t("label.status")}: ${session.status}` : "",
    ].filter(Boolean).join("\n");
    item.iconPath = new vscode.ThemeIcon(isCurrent ? "vm-active" : "vm");
    item.contextValue = "viaSession";
    item.command = {
      command: "via.selectSession",
      title: t("session.select"),
      arguments: [session],
    };
    return item;
  }

  static workspace(session: ListedWorkspace): ViaSessionTreeItem {
    const item = new ViaSessionTreeItem(t("label.workspace"), vscode.TreeItemCollapsibleState.None);
    item.description = session.workspacePath ? basename(session.workspacePath) : t("session.workspaceUnavailable");
    item.tooltip = session.workspacePath || t("session.workspaceUnavailable");
    item.iconPath = new vscode.ThemeIcon(session.workspacePath ? "folder" : "warning");
    item.contextValue = "viaSessionWorkspace";
    return item;
  }

  static empty(): ViaSessionTreeItem {
    const item = new ViaSessionTreeItem(t("session.empty"), vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon("circle-slash");
    item.contextValue = "viaSessionEmpty";
    return item;
  }
}
