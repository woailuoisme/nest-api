import ts from 'typescript';

interface DeprecatedFinding {
  file: string;
  line: number;
  col: number;
  symbol: string;
  message: string;
}

// 提取 AST 标识符节点上的 deprecated 标注信息
function getDeprecationInfo(node: ts.Node, checker: ts.TypeChecker): { symbol: string; message: string } | null {
  if (!ts.isIdentifier(node)) return null;

  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return null;

  const tag = symbol.getJsDocTags(checker).find((t) => t.name === 'deprecated');
  if (!tag) return null;

  const message = tag.text?.map((p) => p.text).join('') ?? '已废弃';
  return {
    symbol: symbol.getName(),
    message: message.trim().replace(/\n+/g, ' '),
  };
}

// 全项目 deprecated 符号与弃用函数一键自动化扫描器
// 基于 TypeScript Compiler API / TypeChecker，自动分析所有依赖库与业务代码中的弃用声明
function scanDeprecatedSymbols() {
  const configPath = ts.findConfigFile('./', ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    console.error('❌ 未找到 tsconfig.json');
    process.exit(1);
  }

  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, './');
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const checker = program.getTypeChecker();

  const findings: DeprecatedFinding[] = [];
  const seen = new Set<string>();

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || !sourceFile.fileName.includes('/src/')) {
      continue;
    }

    const relPath = sourceFile.fileName.replace(`${process.cwd()}/`, '');

    function visit(node: ts.Node) {
      const info = getDeprecationInfo(node, checker);
      if (info) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const key = `${relPath}:${line + 1}:${character + 1}:${info.symbol}`;

        if (!seen.has(key)) {
          seen.add(key);
          findings.push({
            file: relPath,
            line: line + 1,
            col: character + 1,
            symbol: info.symbol,
            message: info.message,
          });
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  if (findings.length === 0) {
    console.log('✅ 全库扫描完成：未发现任何已废弃 (deprecated) 的函数或符号调用！');
    return;
  }

  console.log(`\n⚠️  全库共发现 ${findings.length} 处已废弃 (deprecated) API 调用：\n`);
  for (const f of findings) {
    console.log(`     \x1b[33m${f.file}:${f.line}:${f.col}\x1b[0m`);
    console.log(`     符号: \x1b[31m${f.symbol}\x1b[0m`);
    console.log(`     建议: \x1b[36m${f.message}\x1b[0m\n`);
  }
}

scanDeprecatedSymbols();
