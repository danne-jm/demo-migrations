import { Project, Node, SyntaxKind, Type, Block } from "ts-morph";
import * as path from "path";
import * as fs from "fs";

// Hard-coded migration params
// Equivalent to: mod run . --recipe=org.yourorg.javascript.AddMiddleware
//   -PmiddlewareSpec=koa-helmet:helmet
const MIDDLEWARE_SPEC = "koa-helmet:helmet";
const sep = MIDDLEWARE_SPEC.lastIndexOf(":");
const MODULE_SPEC = MIDDLEWARE_SPEC.slice(0, sep);  // "koa-helmet"
const EXPORT_NAME = MIDDLEWARE_SPEC.slice(sep + 1); // "helmet"
const TARGET_NAME = EXPORT_NAME;

const targetDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd();

console.log(`Scanning: ${targetDir}`);
console.log(`Adding middleware: ${MODULE_SPEC}#${EXPORT_NAME} → app.use(${TARGET_NAME}())\n`);

// Walk up from targetDir to find the nearest tsconfig.json.
// This loads koa's type declarations from node_modules, enabling type-attributed
// matching equivalent to OpenRewrite's appUsePattern.match() semantic check.
function findTsConfig(dir: string): string | undefined {
  let current = dir;
  while (true) {
    const candidate = path.join(current, "tsconfig.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

const tsConfigPath = findTsConfig(targetDir);
const project = tsConfigPath
  ? new Project({ tsConfigFilePath: tsConfigPath })
  : new Project({ skipAddingFilesFromTsConfig: true });

if (!tsConfigPath) {
  project.addSourceFilesAtPaths([
    `${targetDir}/**/*.ts`,
    `${targetDir}/**/*.tsx`,
    `!${targetDir}/**/node_modules/**`,
  ]);
}

// Type-attributed check: is this type a Koa Application instance?
// Equivalent to OpenRewrite's appUsePattern context:
//   context: [`import Koa from 'koa'`, `const app = new Koa()`]
// The symbol's declaration must come from the koa package in node_modules.
function isKoaInstance(type: Type): boolean {
  const symbol = type.getSymbol() ?? type.getApparentType().getSymbol();
  if (!symbol) return false;
  return symbol.getDeclarations().some((d) => {
    const fp = d.getSourceFile().getFilePath();
    // Match both POSIX and Windows paths
    return fp.includes("/koa/") || fp.includes(`${path.sep}koa${path.sep}`);
  });
}

// Per-block state — mirrors OpenRewrite's per-block Frame stack.
type BlockEntry = {
  statements: Node[];  // confirmed Koa app.use() ExpressionStatements
  receiverName: string;
  idempotent: boolean; // target middleware already registered in this block
};

const changedFiles: string[] = [];

for (const sourceFile of project.getSourceFiles()) {
  // Only transform files inside the target directory
  if (!sourceFile.getFilePath().startsWith(targetDir)) continue;

  // Collect all ExpressionStatements in this file that are confirmed Koa .use() calls,
  // grouped by their immediate parent Block.
  // Equivalent to visitMethodInvocation writing into the innermost frame.
  const byBlock = new Map<Block, BlockEntry>();

  for (const stmt of sourceFile.getDescendantsOfKind(SyntaxKind.ExpressionStatement)) {
    const expr = stmt.getExpression();
    if (!Node.isCallExpression(expr)) continue;

    const callee = expr.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    if (callee.getName() !== "use") continue;

    const receiver = callee.getExpression();

    // Type-attributed match — bail if receiver is not a Koa instance
    if (!isKoaInstance(receiver.getType())) continue;

    const parentBlock = stmt.getParentIfKind(SyntaxKind.Block);
    if (!parentBlock) continue;

    let entry = byBlock.get(parentBlock);
    if (!entry) {
      entry = { statements: [], receiverName: receiver.getText(), idempotent: false };
      byBlock.set(parentBlock, entry);
    }

    // Idempotency check: is TARGET_NAME already the argument of this .use() call?
    // Equivalent to OpenRewrite's argName(method) === targetName check.
    const args = expr.getArguments();
    const alreadyRegistered = args.some((arg) => {
      // app.use(helmet())  — call expression
      if (Node.isCallExpression(arg)) {
        const argCallee = arg.getExpression();
        return Node.isIdentifier(argCallee) && argCallee.getText() === TARGET_NAME;
      }
      // app.use(helmet)  — identifier reference (uncommon but handled)
      return Node.isIdentifier(arg) && arg.getText() === TARGET_NAME;
    });

    if (alreadyRegistered) {
      entry.idempotent = true;
    } else {
      entry.statements.push(stmt);
    }
  }

  let fileChanged = false;

  // Process each block — equivalent to visitBlock (post-super) reading the frame.
  byBlock.forEach((entry, block) => {
    // "If not sure, don't execute" — mirrors OpenRewrite's guard.
    if (entry.idempotent || entry.statements.length === 0) return;

    const lastStmt = entry.statements[entry.statements.length - 1];
    const idx = lastStmt.getChildIndex();

    // Insert app.use(helmet()); after the last confirmed Koa .use() call.
    // ts-morph handles indentation — no manual prefix copying needed.
    block.insertStatements(idx + 1, `${entry.receiverName}.use(${TARGET_NAME}());`);

    // Emit: import { helmet } from 'koa-helmet'
    // Equivalent to maybeAddImport(this, { module, member, onlyIfReferenced: false })
    const existingImport = sourceFile.getImportDeclaration(
      (d) => d.getModuleSpecifierValue() === MODULE_SPEC
    );
    if (existingImport) {
      const alreadyImported = existingImport
        .getNamedImports()
        .some((ni) => ni.getName() === EXPORT_NAME);
      if (!alreadyImported) {
        existingImport.addNamedImport(EXPORT_NAME);
      }
    } else {
      sourceFile.addImportDeclaration({
        moduleSpecifier: MODULE_SPEC,
        namedImports: [EXPORT_NAME],
      });
    }

    fileChanged = true;
  });

  if (fileChanged) {
    changedFiles.push(sourceFile.getFilePath());
  }
}

project.saveSync();

for (const filePath of changedFiles) {
  console.log(`Updated: ${filePath}`);
}

console.log(`\nDone. ${changedFiles.length} file(s) updated.`);
