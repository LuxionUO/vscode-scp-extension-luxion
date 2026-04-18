const vscode = require('vscode');
const path = require('path');

function parseFunctionDefinitions(content) {
  const lines = content.split(/\r?\n/);
  const definitions = [];

  let current = null;

  for (const line of lines) {
    const functionMatch = line.match(/^\s*\[FUNCTION\s+([^\]]+)\]/i);

    if (functionMatch) {
      if (current) {
        definitions.push(current);
      }

      current = {
        name: functionMatch[1].trim(),
        locals: []
      };

      continue;
    }

    if (!current) {
      continue;
    }

    // Another section starts; FUNCTION body ended.
    if (/^\s*\[[^\]]+\]/.test(line)) {
      definitions.push(current);
      current = null;
      continue;
    }

    const localMatch = line.match(/^\s*local\.([A-Za-z0-9_]+)/);

    if (localMatch) {
      current.locals.push(localMatch[1]);
    }
  }

  if (current) {
    definitions.push(current);
  }

  return definitions;
}

async function collectFunctionsInFolder(folderUri) {
  const pattern = new vscode.RelativePattern(folderUri, '**/*.scp');
  const files = await vscode.workspace.findFiles(pattern);
  const functions = [];

  for (const file of files) {
    try {
      const content = (await vscode.workspace.fs.readFile(file)).toString();
      const definitions = parseFunctionDefinitions(content);

      for (const definition of definitions) {
        functions.push({
          ...definition,
          file: path.basename(file.fsPath)
        });
      }
    } catch {
      // Ignore unreadable files and continue.
    }
  }

  return functions;
}

function createCompletionItems(functions) {
  return functions.map((fn) => {
    const params = fn.locals.join(', ');
    const signature = params ? `${fn.name} (${params})` : `${fn.name} ()`;
    const shortName = fn.name.split('.').pop() || fn.name;

    const item = new vscode.CompletionItem(signature, vscode.CompletionItemKind.Function);
    item.insertText = fn.name;
    item.filterText = `${fn.name} ${shortName}`;
    item.sortText = `0_${fn.name}`;
    item.detail = `From ${fn.file}`;
    item.documentation = new vscode.MarkdownString(
      params
        ? `\`${fn.name}(${params})\`\n\nLocals found: ${fn.locals.map((local) => `\`${local}\``).join(', ')}`
        : `\`${fn.name}()\``
    );

    return item;
  });
}

function activate(context) {
  const provider = vscode.languages.registerCompletionItemProvider(
    { language: 'scp' },
    {
      async provideCompletionItems(document) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
          return [];
        }

        const scriptsUri = vscode.Uri.joinPath(workspaceFolder.uri, 'scripts');
        let scanUri = workspaceFolder.uri;

        try {
          await vscode.workspace.fs.stat(scriptsUri);
          scanUri = scriptsUri;
        } catch {
          // Fallback to workspace root if /scripts doesn't exist.
        }

        const functions = await collectFunctionsInFolder(scanUri);
        return createCompletionItems(functions);
      }
    },
    '.'
  );

  context.subscriptions.push(provider);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
