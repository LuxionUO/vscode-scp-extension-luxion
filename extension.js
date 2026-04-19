const vscode = require('vscode');
const path = require('path');
const fs = require('fs/promises');

const SUPPORTED_SECTION_TYPES = new Map([
  ['function', 'FUNCTION'],
  ['item', 'ITEM'],
  ['itemdef', 'ITEM'],
  ['defname', 'DEFNAME'],
  ['areadef', 'AREADEF'],
  ['regiontype', 'REGIONTYPE'],
  ['type', 'TYPEDEF'],
  ['typedef', 'TYPEDEF'],
  ['dialog', 'DIALOG']
]);

function parseScriptDefinitions(content) {
  const lines = content.split(/\r?\n/);
  const definitions = [];

  let currentFunction = null;

  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\[([A-Za-z0-9_]+)\s*([^\]]*)\]/);

    if (sectionMatch) {
      if (currentFunction) {
        definitions.push(currentFunction);
        currentFunction = null;
      }

      const sectionType = sectionMatch[1].toLowerCase();
      const symbolType = SUPPORTED_SECTION_TYPES.get(sectionType);
      const sectionValue = sectionMatch[2].trim();

      if (!symbolType || !sectionValue) {
        continue;
      }

      const name = sectionValue.split(/\s+/)[0];

      if (!name) {
        continue;
      }

      if (symbolType === 'FUNCTION') {
        currentFunction = {
          type: symbolType,
          name,
          locals: []
        };
      } else {
        definitions.push({
          type: symbolType,
          name
        });
      }

      continue;
    }

    if (!currentFunction) {
      continue;
    }

    const localMatch = line.match(/^\s*local\.([A-Za-z0-9_]+).*<argv\[/i);

    if (localMatch) {
      currentFunction.locals.push(localMatch[1]);
    }
  }

  if (currentFunction) {
    definitions.push(currentFunction);
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

async function collectDefinitions(document) {
  const files = [];
  const seenPaths = new Set();
  const inMemoryDocuments = new Map();

  for (const openDocument of vscode.workspace.textDocuments) {
    if (openDocument.languageId !== 'scp' || openDocument.isClosed) {
      continue;
    }

    if (openDocument.uri.scheme !== 'file') {
      continue;
    }

    inMemoryDocuments.set(openDocument.uri.fsPath, openDocument.getText());
  }

  if (document.uri.scheme === 'file') {
    inMemoryDocuments.set(document.uri.fsPath, document.getText());
  }

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

  const symbols = [];
  const seenSymbols = new Set();

  for (const file of files) {
    try {
      const content = inMemoryDocuments.has(file)
        ? inMemoryDocuments.get(file)
        : (await fs.readFile(file)).toString();
      const definitions = parseScriptDefinitions(content);

      for (const definition of definitions) {
        const dedupeKey = `${definition.type}:${definition.name}`;

        if (seenSymbols.has(dedupeKey)) {
          continue;
        }

        seenSymbols.add(dedupeKey);

        symbols.push({
          ...definition,
          file: path.basename(file)
        });
      }
    } catch {
      // Ignore unreadable files and continue.
    }
  }

  return symbols;
}

function getCompletionKind(type) {
  switch (type) {
    case 'FUNCTION':
      return vscode.CompletionItemKind.Function;
    case 'ITEM':
      return vscode.CompletionItemKind.Field;
    case 'AREADEF':
    case 'REGIONTYPE':
      return vscode.CompletionItemKind.Module;
    case 'TYPEDEF':
      return vscode.CompletionItemKind.Class;
    case 'DIALOG':
      return vscode.CompletionItemKind.Interface;
    case 'DEFNAME':
      return vscode.CompletionItemKind.Constant;
    default:
      return vscode.CompletionItemKind.Text;
  }
}

function createCompletionItems(symbols) {
  return symbols.map((symbol) => {
    const params = symbol.type === 'FUNCTION' ? symbol.locals.join(', ') : '';
    const displayType = symbol.type === 'TYPEDEF' ? 'type' : symbol.type.toLowerCase();
    const shortName = symbol.name.split('.').pop() || symbol.name;

    const item = new vscode.CompletionItem(
      {
        label: symbol.name,
        detail: ` ${displayType}`
      },
      getCompletionKind(symbol.type)
    );
    item.insertText = symbol.name;
    item.filterText = [
      symbol.name,
      shortName,
      symbol.name.replace(/_/g, ' '),
      displayType,
      symbol.type
    ].join(' ');
    item.sortText = `0_${symbol.type}_${symbol.name}`;
    item.detail = `From ${symbol.file}`;
    item.documentation = new vscode.MarkdownString(
      symbol.type === 'FUNCTION'
        ? (params
            ? `\`${symbol.name}(${params})\`\n\nLocals found: ${symbol.locals.map((local) => `\`${local}\``).join(', ')}`
            : `\`${symbol.name}()\``)
        : `\`${symbol.type}: ${symbol.name}\``
    );

    return item;
  });
}

function shouldSuppressCompletionAtPosition(document, position) {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  const tokenMatch = linePrefix.match(/([A-Za-z_][A-Za-z0-9_]*)$/);

  return !tokenMatch;
}

function getTypedTokenAtPosition(document, position) {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  const tokenMatch = linePrefix.match(/([A-Za-z_][A-Za-z0-9_]*)$/);

  return tokenMatch ? tokenMatch[1].toLowerCase() : '';
}

function matchesTypedToken(symbol, typedToken) {
  if (!typedToken) {
    return true;
  }

  const fullName = symbol.name.toLowerCase();
  const shortName = (symbol.name.split('.').pop() || symbol.name).toLowerCase();

  return fullName.startsWith(typedToken) || shortName.startsWith(typedToken);
}

function createSignatureHelp(functionSymbol, activeParameter) {
  const locals = functionSymbol.locals || [];
  const parameters = (locals.length > 0 ? locals : ['arg1']).map(
    (local) => new vscode.ParameterInformation(local)
  );
  const signatureLabel = `${functionSymbol.name}(${parameters.map((parameter) => parameter.label).join(', ')})`;
  const signature = new vscode.SignatureInformation(signatureLabel);

  signature.parameters = parameters;

  const help = new vscode.SignatureHelp();
  help.signatures = [signature];
  help.activeSignature = 0;
  help.activeParameter = Math.min(activeParameter, Math.max(parameters.length - 1, 0));

  return help;
}

function getFunctionSymbolAtCursor(functionSymbols, linePrefix) {
  const invocationMatch = linePrefix.match(/([A-Za-z_][A-Za-z0-9_\.]*)\s+([^]*)$/);

  if (!invocationMatch) {
    return null;
  }

  const functionName = invocationMatch[1];
  const argsText = invocationMatch[2] || '';
  const activeParameter = argsText.trim() ? argsText.split(',').length - 1 : 0;
  const matchedFunction = functionSymbols.find(
    (symbol) => symbol.name.toLowerCase() === functionName.toLowerCase()
  );

  if (!matchedFunction) {
    return null;
  }

  return {
    functionSymbol: matchedFunction,
    activeParameter
  };
}

function activate(context) {
  const triggerCharacters = [
    ...'abcdefghijklmnopqrstuvwxyz',
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    ...'0123456789',
    '_',
    '[',
    '.',
    ' ',
    ',',
    '='
  ];

  const completionProvider = vscode.languages.registerCompletionItemProvider(
    { language: 'scp' },
    {
      async provideCompletionItems(document, position) {
        if (shouldSuppressCompletionAtPosition(document, position)) {
          return [];
        }

        const definitions = await collectDefinitions(document);
        const typedToken = getTypedTokenAtPosition(document, position);
        const matchingDefinitions = definitions.filter((definition) =>
          matchesTypedToken(definition, typedToken)
        );

        return createCompletionItems(matchingDefinitions);
      }
    },
    ...triggerCharacters
  );

  const signatureProvider = vscode.languages.registerSignatureHelpProvider(
    { language: 'scp' },
    {
      async provideSignatureHelp(document, position) {
        const definitions = await collectDefinitions(document);
        const functionSymbols = definitions.filter((symbol) => symbol.type === 'FUNCTION');
        const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
        const match = getFunctionSymbolAtCursor(functionSymbols, linePrefix);

        if (!match) {
          return null;
        }

        return createSignatureHelp(match.functionSymbol, match.activeParameter);
      }
    },
    ' ',
    ',',
    '='
  );

  context.subscriptions.push(completionProvider, signatureProvider);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
