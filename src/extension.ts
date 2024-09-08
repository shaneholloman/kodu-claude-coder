// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode"
import { ClaudeDevProvider, GlobalStateKey } from "./providers/ClaudeDevProvider"
import { amplitudeTracker } from "./utils/amplitude"

/*
Built using https://github.com/microsoft/vscode-webview-ui-toolkit

Inspired by
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/default/weather-webview
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/frameworks/hello-world-react-cra

*/

let outputChannel: vscode.OutputChannel
var creditFetchInterval: NodeJS.Timeout | null | number = null
var lastFetchedAt = 0

async function updateUserCredit(provider?: ClaudeDevProvider) {
	const now = Date.now()
	if (now - lastFetchedAt < 5000) {
		return
	}
	lastFetchedAt = now
	const user = await provider?.fetchKoduUser()
	if (user) {
		provider?.updateKoduCredits(user.credits)
		provider?.postMessageToWebview({
			type: "action",
			action: "koduCreditsFetched",
			user,
		})
	}
}

async function startCreditFetch(provider: ClaudeDevProvider) {
	const now = Date.now()
	if (now - lastFetchedAt > 500) {
		await updateUserCredit(provider)
	}
	lastFetchedAt = now
	if (!creditFetchInterval) {
		creditFetchInterval = setInterval(() => {
			updateUserCredit(provider)
		}, 5050)
	}
}

function stopCreditFetch() {
	if (creditFetchInterval) {
		clearInterval(creditFetchInterval)
		creditFetchInterval = null
	}
}

function handleFirstInstall(context: vscode.ExtensionContext) {
	const isFirstInstall = context.globalState.get("isFirstInstall", true)
	console.log(`Extension is first install (isFirstInstall=${isFirstInstall})`)
	if (isFirstInstall) {
		context.globalState.update("isFirstInstall", false)
		amplitudeTracker.extensionActivateSuccess(!!isFirstInstall)
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const getCurrentUser = () => {
		return context.globalState.get("user") as { email: string; credits: number; id: string } | undefined
	}

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	//console.log('Congratulations, your extension "claude-dev" is now active!')
	outputChannel = vscode.window.createOutputChannel("Claude Dev")
	const user = getCurrentUser()
	amplitudeTracker.initialize(!!user, user?.id || undefined)
	outputChannel.appendLine("Claude Dev extension activated")
	const sidebarProvider = new ClaudeDevProvider(context, outputChannel)
	context.subscriptions.push(outputChannel)
	console.log(`Claude Dev extension activated`)
	handleFirstInstall(context)

	// Set up the window state change listener
	context.subscriptions.push(
		vscode.window.onDidChangeWindowState((windowState) => {
			if (windowState.focused) {
				console.log("Window is now focused")
				startCreditFetch(sidebarProvider)
			} else {
				console.log("Window lost focus")
				stopCreditFetch()
			}
		})
	)

	// Start fetching if the window is already focused when the extension activates
	if (vscode.window.state.focused) {
		startCreditFetch(sidebarProvider)
	}

	// Make sure to stop fetching when the extension is deactivated
	context.subscriptions.push({ dispose: stopCreditFetch })
	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	// const disposable = vscode.commands.registerCommand("claude-dev-experimental.helloWorld", () => {
	// 	// The code you place here will be executed every time your command is executed
	// 	// Display a message box to the user
	// 	vscode.window.showInformationMessage("Hello World from claude-dev!")
	// })
	// context.subscriptions.push(disposable)

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ClaudeDevProvider.sideBarId, sidebarProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		})
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("claude-dev-experimental.plusButtonTapped", async () => {
			outputChannel.appendLine("Plus button tapped")
			await sidebarProvider.clearTask()
			await sidebarProvider.postStateToWebview()
			await sidebarProvider.postMessageToWebview({ type: "action", action: "chatButtonTapped" })
		})
	)

	const openClaudeDevInNewTab = () => {
		outputChannel.appendLine("Opening Claude Dev in new tab")
		// (this example uses webviewProvider activation event which is necessary to deserialize cached webview, but since we use retainContextWhenHidden, we don't need to use that event)
		// https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
		const tabProvider = new ClaudeDevProvider(context, outputChannel)
		//const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined
		const lastCol = Math.max(...vscode.window.visibleTextEditors.map((editor) => editor.viewColumn || 0))
		const targetCol = Math.max(lastCol + 1, 1)
		const panel = vscode.window.createWebviewPanel(ClaudeDevProvider.tabPanelId, "Claude Dev", targetCol, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [context.extensionUri],
		})
		// TODO: use better svg icon with light and dark variants (see https://stackoverflow.com/questions/58365687/vscode-extension-iconpath)
		panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "icon.png")
		tabProvider.resolveWebviewView(panel)

		// Lock the editor group so clicking on files doesn't open them over the panel
		new Promise((resolve) => setTimeout(resolve, 100)).then(() => {
			vscode.commands.executeCommand("workbench.action.lockEditorGroup")
		})
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("claude-dev-experimental.popoutButtonTapped", openClaudeDevInNewTab)
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("claude-dev-experimental.openInNewTab", openClaudeDevInNewTab)
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("claude-dev-experimental.settingsButtonTapped", () => {
			//const message = "claude-dev-experimental.settingsButtonTapped!"
			//vscode.window.showInformationMessage(message)
			sidebarProvider.postMessageToWebview({ type: "action", action: "settingsButtonTapped" })
		})
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("claude-dev-experimental.historyButtonTapped", () => {
			sidebarProvider.postMessageToWebview({ type: "action", action: "historyButtonTapped" })
		})
	)

	/*
	We use the text document content provider API to show a diff view for new files/edits by creating a virtual document for the new content.

	- This API allows you to create readonly documents in VSCode from arbitrary sources, and works by claiming an uri-scheme for which your provider then returns text contents. The scheme must be provided when registering a provider and cannot change afterwards.
	- Note how the provider doesn't create uris for virtual documents - its role is to provide contents given such an uri. In return, content providers are wired into the open document logic so that providers are always considered.
	https://code.visualstudio.com/api/extension-guides/virtual-documents
	*/
	const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return Buffer.from(uri.query, "base64").toString("utf-8")
		}
	})()
	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider("claude-dev-diff", diffContentProvider)
	)

	// URI Handler
	const handleUri = async (uri: vscode.Uri) => {
		const query = new URLSearchParams(uri.query.replace(/\+/g, "%2B"))
		const token = query.get("token")
		const email = query.get("email")
		if (token) {
			amplitudeTracker.authSuccess()
			await sidebarProvider.saveKoduApiKey(token, email || undefined)
		}
	}
	context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))
}

// This method is called when your extension is deactivated
export function deactivate() {
	outputChannel.appendLine("Claude Dev extension deactivated")
}
