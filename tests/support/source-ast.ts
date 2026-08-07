import ts from 'typescript';

function parseTsx(source: string): ts.SourceFile {
  return ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

export function sourceImportsModule(source: string, moduleSpecifier: string): boolean {
  const sourceFile = parseTsx(source);
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === moduleSpecifier,
  );
}

export function hasTruthyJsxAttribute(source: string, tagName: string, attributeName: string): boolean {
  const sourceFile = parseTsx(source);
  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) return;

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const matchingAttribute = node.attributes.properties.find(
        (property) =>
          ts.isJsxAttribute(property) &&
          property.name.getText(sourceFile) === attributeName &&
          (property.initializer === undefined ||
            (ts.isJsxExpression(property.initializer) &&
              property.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword)),
      );

      if (node.tagName.getText(sourceFile) === tagName && matchingAttribute) {
        found = true;
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}
