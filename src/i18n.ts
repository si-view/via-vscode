import * as vscode from "vscode";

export type ViaLanguage = "auto" | "en" | "zh";

type MessageKey =
  | "accessibility.statusLabel"
  | "codelens.runFile"
  | "codelens.runParagraph"
  | "config.languageDescription"
  | "display.current"
  | "display.custom"
  | "display.customPrompt"
  | "display.customRequired"
  | "display.customTitle"
  | "display.customValue"
  | "display.inherit"
  | "display.inheritDetail"
  | "display.modeTitle"
  | "display.unset"
  | "display.unsetDetail"
  | "error.customDisplayRequired"
  | "error.instanceNameRequired"
  | "error.linuxOnly"
  | "error.mustSaveFile"
  | "error.onlyIlFiles"
  | "error.openIlEditor"
  | "error.saveBeforeRun"
  | "info.connectionStatusRefreshed"
  | "info.selectionExecuted"
  | "info.workspaceAlreadyRunning"
  | "info.workspaceLoaded"
  | "info.workspaceSet"
  | "info.workspaceStarted"
  | "interactive.clear"
  | "interactive.empty"
  | "interactive.placeholder"
  | "interactive.run"
  | "interactive.running"
  | "interactive.subtitle"
  | "interactive.title"
  | "label.alreadySelected"
  | "label.autoStart"
  | "label.clickToSwitchWorkspace"
  | "label.checking"
  | "label.connected"
  | "label.connection"
  | "label.currentValue"
  | "label.editPath"
  | "label.detail"
  | "label.disabled"
  | "label.disconnected"
  | "label.display"
  | "label.enabled"
  | "label.error"
  | "label.instance"
  | "label.lastCommand"
  | "label.lastSelectionMode"
  | "label.notConfigured"
  | "label.selectionModeEval"
  | "label.selectionModeLoadTempFile"
  | "label.selectionModeNone"
  | "label.status"
  | "label.statusPrefix"
  | "label.unconfigured"
  | "label.workspace"
  | "message.noSkillCode"
  | "message.workspaceNotRunning"
  | "option.configureCurrentWorkspace"
  | "option.customizeInternalName"
  | "option.newWorkspace"
  | "option.onlySelect"
  | "option.onlySelectDetail"
  | "option.selectCurrentWorkspace"
  | "option.startNow"
  | "option.startWorkspace"
  | "option.useCurrentWorkspace"
  | "option.useDefaultInternalName"
  | "option.workspaceInstanceOverrideDetail"
  | "option.workspacePresetDetail"
  | "progress.runFile"
  | "progress.runSelection"
  | "progress.startWorkspace"
  | "prompt.instanceName"
  | "prompt.readOnlyDiagnostics"
  | "prompt.selectWorkspace"
  | "status.menu.configure.detail"
  | "status.menu.configure.label"
  | "status.menu.details.detail"
  | "status.menu.details.label"
  | "status.menu.refresh.detail"
  | "status.menu.refresh.label"
  | "status.menu.select.detail"
  | "status.menu.select.label"
  | "status.menu.start.detail"
  | "status.menu.start.label"
  | "status.menu.title"
  | "status.tooltip.unconfigured"
  | "statusBar.name"
  | "title.instanceName"
  | "title.statusDetails"
  | "title.workspaceAdvancedSettings"
  | "title.workspaceCreated"
  | "title.workspaceDisplayMode"
  | "title.workspacePicker"
  | "title.workspaceSelector";

type Messages = Record<MessageKey, string>;

const messages: Record<"en" | "zh", Messages> = {
  en: {
    "accessibility.statusLabel": "VIA Runner status",
    "codelens.runFile": "Run File",
    "codelens.runParagraph": "Run Paragraph",
    "config.languageDescription": "Language used by the VIA Runner runtime UI. auto follows the VS Code display language.",
    "display.current": "Current",
    "display.custom": "Use Custom DISPLAY",
    "display.customPrompt": "DISPLAY value used for via commands",
    "display.customRequired": "DISPLAY value is required.",
    "display.customTitle": "Custom DISPLAY",
    "display.customValue": "Current value: {value}",
    "display.inherit": "Inherit DISPLAY",
    "display.inheritDetail": "Use the extension host DISPLAY: {value}",
    "display.modeTitle": "Workspace DISPLAY Mode",
    "display.unset": "Unset DISPLAY",
    "display.unsetDetail": "Run via commands without DISPLAY in the environment",
    "error.customDisplayRequired": "via.displayValue must be set when via.displayMode is custom.",
    "error.instanceNameRequired": "Instance name is required.",
    "error.linuxOnly": "VIA Runner requires the extension host to run on Linux.",
    "error.mustSaveFile": "The file must be saved before running it with via.",
    "error.onlyIlFiles": "VIA Runner only supports .il files.",
    "error.openIlEditor": "Open a .il editor to run selected code.",
    "error.saveBeforeRun": "Save the .il file before running it with via.",
    "info.connectionStatusRefreshed": "VIA connection status refreshed.",
    "info.selectionExecuted": "VIA selection executed.",
    "info.workspaceAlreadyRunning": "VIA workspace is already running.",
    "info.workspaceLoaded": "VIA loaded {path}.",
    "info.workspaceSet": "VIA workspace set to {path}.",
    "info.workspaceStarted": "VIA workspace started.",
    "interactive.clear": "Clear",
    "interactive.empty": "Enter SKILL code before running it.",
    "interactive.placeholder": "Type interactive SKILL here. Ctrl/Cmd+Enter runs it.",
    "interactive.run": "Run SKILL",
    "interactive.running": "Running interactive SKILL via {instance}",
    "interactive.subtitle": "Interactive SKILL console for the current VIA workspace.",
    "interactive.title": "VIA SKILL",
    "label.alreadySelected": "Already selected",
    "label.autoStart": "Auto Start",
    "label.clickToSwitchWorkspace": "Click to switch workspace.",
    "label.checking": "Checking",
    "label.connected": "Connected",
    "label.connection": "Connection",
    "label.currentValue": "Current value: {value}",
    "label.editPath": "Edit {path}",
    "label.detail": "Detail",
    "label.disabled": "disabled",
    "label.disconnected": "Disconnected",
    "label.display": "DISPLAY",
    "label.enabled": "enabled",
    "label.error": "Error",
    "label.instance": "Instance",
    "label.lastCommand": "Last Command",
    "label.lastSelectionMode": "Last Selection Mode",
    "label.notConfigured": "Not configured",
    "label.selectionModeEval": "eval",
    "label.selectionModeLoadTempFile": "load-temp-file",
    "label.selectionModeNone": "none",
    "label.status": "Status",
    "label.statusPrefix": "status",
    "label.unconfigured": "Unconfigured",
    "label.workspace": "Workspace",
    "message.noSkillCode": "No SKILL code found in the current selection or paragraph.",
    "message.workspaceNotRunning": "The selected VIA workspace is not running.",
    "option.configureCurrentWorkspace": "Configure Current Workspace...",
    "option.customizeInternalName": "Customize Internal Name",
    "option.newWorkspace": "New Workspace...",
    "option.onlySelect": "Only Select",
    "option.onlySelectDetail": "Keep the workspace selected but do not start it now",
    "option.selectCurrentWorkspace": "Current VS Code workspace",
    "option.startNow": "Start Now",
    "option.startWorkspace": "Start Workspace",
    "option.useCurrentWorkspace": "Use the currently opened VS Code workspace",
    "option.useDefaultInternalName": "Use Default Internal Name",
    "option.workspaceInstanceOverrideDetail": "Only needed when you want to override via's internal instance naming",
    "option.workspacePresetDetail": "Create a new via workspace preset and select it",
    "progress.runFile": "Running {name} via {instance}",
    "progress.runSelection": "Running SKILL code via {instance}",
    "progress.startWorkspace": "Starting VIA workspace {name}",
    "prompt.instanceName": "Internal via instance name",
    "prompt.readOnlyDiagnostics": "Read-only diagnostics for the current VIA workspace",
    "prompt.selectWorkspace": "Choose a known workspace or create a new one",
    "status.menu.configure.detail": "Edit workspace, internal name, and DISPLAY settings",
    "status.menu.configure.label": "Configure Workspace",
    "status.menu.details.detail": "Display workspace, connection, DISPLAY, and recent command details",
    "status.menu.details.label": "Show Status Details",
    "status.menu.refresh.detail": "Re-check the current via workspace state",
    "status.menu.refresh.label": "Refresh Connection Status",
    "status.menu.select.detail": "Switch to another via workspace",
    "status.menu.select.label": "Select Workspace",
    "status.menu.start.detail": "Start the current via workspace",
    "status.menu.start.label": "Start Workspace",
    "status.menu.title": "VIA Status Bar",
    "status.tooltip.unconfigured": "Choose or create a via workspace.",
    "statusBar.name": "VIA Runner Status",
    "title.instanceName": "VIA Instance Name",
    "title.statusDetails": "VIA Status Details",
    "title.workspaceAdvancedSettings": "Workspace Advanced Settings",
    "title.workspaceCreated": "Workspace Created",
    "title.workspaceDisplayMode": "Workspace DISPLAY Mode",
    "title.workspacePicker": "Select VIA Workspace",
    "title.workspaceSelector": "Select VIA Workspace",
  },
  zh: {
    "accessibility.statusLabel": "VIA Runner 状态",
    "codelens.runFile": "运行文件",
    "codelens.runParagraph": "运行段落",
    "config.languageDescription": "VIA Runner 运行时界面语言。auto 表示跟随 VS Code 显示语言。",
    "display.current": "当前",
    "display.custom": "使用自定义 DISPLAY",
    "display.customPrompt": "via 命令使用的 DISPLAY 值",
    "display.customRequired": "必须填写 DISPLAY 值。",
    "display.customTitle": "自定义 DISPLAY",
    "display.customValue": "当前值：{value}",
    "display.inherit": "继承 DISPLAY",
    "display.inheritDetail": "使用扩展宿主的 DISPLAY：{value}",
    "display.modeTitle": "工作区 DISPLAY 模式",
    "display.unset": "不设置 DISPLAY",
    "display.unsetDetail": "执行 via 命令时不传入 DISPLAY 环境变量",
    "error.customDisplayRequired": "当 via.displayMode 为 custom 时，必须设置 via.displayValue。",
    "error.instanceNameRequired": "必须填写实例名。",
    "error.linuxOnly": "VIA Runner 要求扩展宿主运行在 Linux 上。",
    "error.mustSaveFile": "运行前必须先保存该文件。",
    "error.onlyIlFiles": "VIA Runner 仅支持 .il 文件。",
    "error.openIlEditor": "请先打开 .il 编辑器再运行选中的代码。",
    "error.saveBeforeRun": "使用 via 运行前请先保存 .il 文件。",
    "info.connectionStatusRefreshed": "VIA 连接状态已刷新。",
    "info.selectionExecuted": "VIA 选中代码已执行。",
    "info.workspaceAlreadyRunning": "VIA 工作区已经在运行中。",
    "info.workspaceLoaded": "VIA 已加载 {path}。",
    "info.workspaceSet": "VIA 工作区已设置为 {path}。",
    "info.workspaceStarted": "VIA 工作区已启动。",
    "interactive.clear": "清空",
    "interactive.empty": "请先输入要执行的 SKILL 代码。",
    "interactive.placeholder": "在这里输入交互式 SKILL。按 Ctrl/Cmd+Enter 执行。",
    "interactive.run": "执行 SKILL",
    "interactive.running": "通过 {instance} 执行交互式 SKILL",
    "interactive.subtitle": "当前 VIA 工作区的交互式 SKILL 控制台。",
    "interactive.title": "VIA SKILL",
    "label.alreadySelected": "已选中",
    "label.autoStart": "自动启动",
    "label.clickToSwitchWorkspace": "点击可切换工作区。",
    "label.checking": "检查中",
    "label.connected": "已连接",
    "label.connection": "连接状态",
    "label.currentValue": "当前值：{value}",
    "label.editPath": "编辑 {path}",
    "label.detail": "详情",
    "label.disabled": "关闭",
    "label.disconnected": "未连接",
    "label.display": "DISPLAY",
    "label.enabled": "开启",
    "label.error": "错误",
    "label.instance": "实例名",
    "label.lastCommand": "最近命令",
    "label.lastSelectionMode": "最近执行模式",
    "label.notConfigured": "未配置",
    "label.selectionModeEval": "eval",
    "label.selectionModeLoadTempFile": "临时文件加载",
    "label.selectionModeNone": "无",
    "label.status": "状态",
    "label.statusPrefix": "状态",
    "label.unconfigured": "未配置",
    "label.workspace": "工作区",
    "message.noSkillCode": "当前选择或段落中没有找到可执行的 SKILL 代码。",
    "message.workspaceNotRunning": "当前选择的 VIA 工作区尚未运行。",
    "option.configureCurrentWorkspace": "配置当前工作区...",
    "option.customizeInternalName": "自定义内部实例名",
    "option.newWorkspace": "新建工作区...",
    "option.onlySelect": "仅选择",
    "option.onlySelectDetail": "仅保留当前工作区选择，不立即启动",
    "option.selectCurrentWorkspace": "当前 VS Code 工作区",
    "option.startNow": "立即启动",
    "option.startWorkspace": "启动工作区",
    "option.useCurrentWorkspace": "使用当前打开的 VS Code 工作区",
    "option.useDefaultInternalName": "使用默认内部实例名",
    "option.workspaceInstanceOverrideDetail": "仅当你需要覆盖 via 内部实例命名时才需要修改",
    "option.workspacePresetDetail": "创建新的 via 工作区预设并选中",
    "progress.runFile": "通过 {instance} 运行 {name}",
    "progress.runSelection": "通过 {instance} 运行 SKILL 代码",
    "progress.startWorkspace": "正在启动 VIA 工作区 {name}",
    "prompt.instanceName": "via 内部实例名",
    "prompt.readOnlyDiagnostics": "当前 VIA 工作区的只读诊断信息",
    "prompt.selectWorkspace": "选择已有工作区，或新建一个工作区",
    "status.menu.configure.detail": "编辑工作区、内部实例名和 DISPLAY 设置",
    "status.menu.configure.label": "配置工作区",
    "status.menu.details.detail": "显示工作区、连接、DISPLAY 和最近命令详情",
    "status.menu.details.label": "查看状态详情",
    "status.menu.refresh.detail": "重新检查当前 via 工作区状态",
    "status.menu.refresh.label": "刷新连接状态",
    "status.menu.select.detail": "切换到其他 via 工作区",
    "status.menu.select.label": "选择工作区",
    "status.menu.start.detail": "启动当前 via 工作区",
    "status.menu.start.label": "启动工作区",
    "status.menu.title": "VIA 状态栏",
    "status.tooltip.unconfigured": "请选择或新建一个 via 工作区。",
    "statusBar.name": "VIA Runner 状态",
    "title.instanceName": "VIA 实例名",
    "title.statusDetails": "VIA 状态详情",
    "title.workspaceAdvancedSettings": "工作区高级设置",
    "title.workspaceCreated": "工作区已创建",
    "title.workspaceDisplayMode": "工作区 DISPLAY 模式",
    "title.workspacePicker": "选择 VIA 工作区",
    "title.workspaceSelector": "选择 VIA 工作区",
  },
};

export function getLanguage(): "en" | "zh" {
  const configured = vscode.workspace.getConfiguration("via").get<ViaLanguage>("language", "auto");
  if (configured === "en" || configured === "zh") {
    return configured;
  }

  return vscode.env.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function t(key: MessageKey, variables?: Record<string, string>): string {
  const language = getLanguage();
  const template = messages[language][key];
  if (!variables) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, name: string) => variables[name] ?? "");
}
