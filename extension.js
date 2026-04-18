const vscode = require('vscode');
const path = require('path');
const fs = require('fs/promises');

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

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findProjectRoot(startDir) {
  let currentDir = startDir;
  let detectedRoot = null;

  while (true) {
    const hasGit = await pathExists(path.join(currentDir, '.git'));
    const hasPackageJson = await pathExists(path.join(currentDir, 'package.json'));

    if (hasGit || hasPackageJson) {
      detectedRoot = currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return detectedRoot || startDir;
}

async function collectScpFilesFromDirectory(rootDir) {
  const files = [];
  const ignoredDirectories = new Set(['.git', 'node_modules']);
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries;

    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          stack.push(path.join(currentDir, entry.name));
        }
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith('.scp')) {
        files.push(path.join(currentDir, entry.name));
      }
    }
  }

  return files;
}

async function collectFunctions(document) {
  const files = [];
  const seenPaths = new Set();

  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const workspaceUris = await vscode.workspace.findFiles('**/*.{scp,SCP}', '**/{.git,node_modules}/**');

    for (const uri of workspaceUris) {
      if (!seenPaths.has(uri.fsPath)) {
        seenPaths.add(uri.fsPath);
        files.push(uri.fsPath);
      }
    }
  }

  const projectRoot = await findProjectRoot(path.dirname(document.uri.fsPath));
  const localFiles = await collectScpFilesFromDirectory(projectRoot);

  for (const filePath of localFiles) {
    if (!seenPaths.has(filePath)) {
      seenPaths.add(filePath);
      files.push(filePath);
    }
  }

  const functions = [];

  for (const file of files) {
    try {
      const content = (await fs.readFile(file)).toString();
      const definitions = parseFunctionDefinitions(content);

      for (const definition of definitions) {
        functions.push({
          ...definition,
          file: path.basename(file)
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
        const functions = await collectFunctions(document);
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
